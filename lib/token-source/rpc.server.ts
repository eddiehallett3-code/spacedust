import "server-only";

import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getServerRpcUrl } from "@/lib/config/env";
import { UpstreamError } from "@/lib/utils/errors";
import { FALLBACK_SYMBOL, FALLBACK_NAME, isValidSolanaAddress } from "@/lib/utils/sanitize";
import type { ScanResult, ScannedHolding } from "./types";
import type { NonFungibleAsset } from "@/types/token";

/**
 * Token scanner built on **core Solana RPC only** — no API key, no paid indexer.
 *
 * How it replaces Helius DAS:
 *
 * | Need | DAS gave us | Here we use |
 * |---|---|---|
 * | List holdings | one indexed call | `getTokenAccountsByOwner` × 2 programs |
 * | Balance + decimals | `amount` | `info.tokenAmount` (jsonParsed) |
 * | Which token program | `resolveMintDetails` | which program returned the account |
 * | Token-2022 extensions | mint account | `info.extensions` on the token account |
 * | Name / symbol / logo | `content.metadata` | Jupiter `/tokens/v2/search` |
 * | USD price | Jupiter Price API | Jupiter Price API (unchanged) |
 *
 * Token-2022 is covered by querying the Token-2022 program id separately —
 * `getTokenAccountsByOwner` filters by program, so two calls cover both.
 */

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Mints per `getMultipleAccounts` call. The RPC caps this at 100. */
const MINT_BATCH = 100;

/**
 * Minimum spacing between calls to the throttled methods.
 *
 * `getTokenAccountsByOwner` is rate-limited per method per IP on the public
 * endpoint (roughly 10 calls / 10s). A scan makes several calls — two token
 * programs, a native balance, then batched mint reads — and firing them
 * back-to-back reliably trips the limit. Every call is therefore funnelled
 * through a single queue with a small gap.
 */
const MIN_INTERVAL_MS = 350;

let queueTail: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

/** Serialise every RPC call and keep at least `MIN_INTERVAL_MS` between them. */
function pace<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await task();
    } finally {
      lastCallAt = Date.now();
    }
  });
  // Keep the chain alive even if this task rejects.
  queueTail = run.catch(() => undefined);
  return run;
}

interface ParsedTokenAccount {
  pubkey?: string;
  account?: {
    lamports?: number;
    data?: {
      program?: string;
      parsed?: {
        info?: {
          mint?: string;
          state?: string;
          owner?: string;
          extensions?: Array<{ extension?: string }>;
          tokenAmount?: { amount?: string; decimals?: number };
        };
      };
    };
  };
}

/**
 * Core JSON-RPC call with retry and exponential backoff.
 *
 * Exported because everything server-side that talks to the RPC should share
 * this one queue: the public endpoint throttles per method per IP, so a second
 * unthrottled caller would defeat the pacing it exists to provide.
 *
 * The public Solana endpoint throttles `getTokenAccountsByOwner` per method per
 * IP quite aggressively, and reports it as a **JSON-RPC error inside a 200
 * response** rather than an HTTP 429 — so status-code checks alone miss it.
 * Both shapes are handled here.
 */
export async function rpcCall<T>(
  method: string,
  params: unknown[],
  attempt = 0,
): Promise<T> {
  const MAX_ATTEMPTS = 5;

  const send = async (): Promise<Response> => {
    // Paced: all RPC traffic shares one rate-limited queue.
    return pace(() =>
      fetch(getServerRpcUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "1", method, params }),
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      }),
    );
  };

  let response: Response;
  try {
    response = await send();
  } catch (error) {
    // Network-level failure: worth retrying, it is often transient.
    if (attempt < MAX_ATTEMPTS - 1) {
      await backoff(attempt);
      return rpcCall<T>(method, params, attempt + 1);
    }
    throw new UpstreamError(
      `RPC request failed: ${error instanceof Error ? error.message : "network error"}`,
      "helius",
    );
  }

  const json = (await response.json().catch(() => null)) as {
    result?: T;
    error?: { message?: string; code?: number };
  } | null;

  const errorMessage = json?.error?.message ?? "";

  const isRateLimited =
    response.status === 429 ||
    /too many requests|rate limit|429/i.test(errorMessage);

  if (isRateLimited && attempt < MAX_ATTEMPTS - 1) {
    await backoff(attempt);
    return rpcCall<T>(method, params, attempt + 1);
  }

  if (!response.ok || json?.error) {
    throw new UpstreamError(
      json?.error?.message ??
        `RPC responded ${response.status}. The endpoint may be rate-limiting you.`,
      "helius",
      response.status,
    );
  }
  if (json?.result === undefined || json?.result === null) {
    throw new UpstreamError("RPC returned no result", "helius");
  }
  return json.result;
}

/** Exponential backoff with jitter, so concurrent clients do not sync up. */
function backoff(attempt: number): Promise<void> {
  // Generous, because the public endpoint's limit is a sliding window rather
  // than an instantaneous burst allowance.
  const base = Math.min(750 * 2 ** attempt, 6000);
  const jitter = Math.random() * 400;
  return new Promise((resolve) => setTimeout(resolve, base + jitter));
}

/**
 * Fetch every token account for one owner under one token program.
 *
 * **One request, not a page loop.** `getTokenAccountsByOwner` has no page or
 * offset parameter — its config carries only a commitment and a minimum slot —
 * so a loop over `page` sends the identical request again. That is what this
 * used to do, up to ten times: the same accounts came back each time, duplicate
 * rows were appended, and ten times the RPC budget was spent without ever seeing
 * an account the first response did not contain. A provider that caps the
 * response caps it for all ten calls just the same.
 *
 * Duplicates are still dropped defensively by token-account address: the
 * downstream ranking can legitimately see one mint in two accounts, but it must
 * never see the same account twice.
 */
async function fetchProgramAccounts(
  owner: string,
  programId: string,
  kind: "legacy" | "token2022",
): Promise<ScannedHolding[]> {
  const holdings: ScannedHolding[] = [];

  const result = await rpcCall<{ value?: ParsedTokenAccount[] }>(
    "getTokenAccountsByOwner",
    // Three params, as the method defines them. This call used to pass a
    // fourth — a `dataSlice` of length zero, presumably to trim the payload —
    // which the endpoint silently ignores: verified by sending both shapes and
    // getting byte-identical results. It was a no-op that read like the
    // extension data below was unavailable, which it is not.
    [owner, { programId }, { encoding: "jsonParsed" }],
  );

  const seen = new Set<string>();

  for (const entry of result.value ?? []) {
    const info = entry.account?.data?.parsed?.info;
    const amount = info?.tokenAmount?.amount;
    const mint = info?.mint;
    if (!mint || !amount || amount === "0") continue;
    if (info?.state && info.state !== "initialized") continue;

    const extensions = new Set(
      (info?.extensions ?? [])
        .map((ext) => ext?.extension)
        .filter((name): name is string => typeof name === "string"),
    );

    // The address the chain actually returned for this balance. It is not
    // always the canonical ATA, so the sweep must close this one rather than
    // re-deriving and closing the wrong (possibly non-existent) ATA.
    const tokenAccount =
      typeof entry.pubkey === "string" && isValidSolanaAddress(entry.pubkey)
        ? entry.pubkey
        : null;

    if (tokenAccount !== null) {
      if (seen.has(tokenAccount)) continue;
      seen.add(tokenAccount);
    }

    holdings.push({
      mint,
      // Filled in by the metadata pass below.
      symbol: FALLBACK_SYMBOL,
      name: FALLBACK_NAME,
      logoUri: null,
      rawAmount: amount,
      decimals: info?.tokenAmount?.decimals ?? 0,
      dasPriceUsd: null,
      organicScore: null,
      holderCount: null,
      program: kind,
      tokenAccount,
      hasTransferFee: extensions.has("transferFeeConfig"),
      hasTransferHook: extensions.has("transferHook"),
      // Never true on this path: this read discards any account whose state is
      // not `initialized`, and a frozen account's state is `frozen`. Stated
      // explicitly rather than left out, because a missing flag here would
      // silently read as "closable" downstream.
      frozen: false,
    });
  }

  return holdings;
}

/**
 * Score which of several token accounts for the same mint is worth reporting.
 *
 * The canonical ATA always wins — it is the only account Jupiter's swap can
 * drain. Ties and non-ATA accounts fall back to the larger balance.
 */
function rankAccount(owner: string, holding: ScannedHolding): bigint {
  const program =
    holding.program === "token2022" ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM;
  const canonical = getAssociatedTokenAddressSync(
    new PublicKey(holding.mint),
    new PublicKey(owner),
    true,
    new PublicKey(program),
  ).toBase58();

  const balance = (() => {
    try {
      return BigInt(holding.rawAmount);
    } catch {
      return 0n;
    }
  })();

  // A canonical ATA outranks any balance; otherwise the bigger balance wins.
  return holding.tokenAccount === canonical
    ? 1n << 200n
    : balance;
}

/** Native SOL balance. */
async function fetchNativeBalance(owner: string): Promise<number> {
  try {
    const result = await rpcCall<{ value?: number }>("getBalance", [owner]);
    return result.value ?? 0;
  } catch {
    // Cosmetic: the sweep does not depend on knowing the SOL balance.
    return 0;
  }
}
/**
 * Scan a wallet using only core RPC + Jupiter.
 *
 * Deliberately does **not** fetch token metadata here. A dust wallet can hold
 * thousands of mostly-worthless mints, and Jupiter's token endpoint is
 * rate-limited on the keyless tier. Metadata is fetched later, for the handful
 * of tokens that actually have a price — see `app/api/tokens/route.ts`.
 */
export async function scanWalletViaRpc(owner: string): Promise<ScanResult> {
  // Sequential, not parallel: the public endpoint throttles per method per IP,
  // and `getTokenAccountsByOwner` is exactly the method it limits hardest.
  // Firing both at once reliably trips the limit on a shared/datacenter IP.
  const legacy = await fetchProgramAccounts(owner, TOKEN_PROGRAM, "legacy");
  const token2022 = await fetchProgramAccounts(
    owner,
    TOKEN_2022_PROGRAM,
    "token2022",
  );
  const nativeLamports = await fetchNativeBalance(owner);

  // One mint can appear in several token accounts at once: the canonical ATA
  // plus older, non-canonical accounts (common for old airdrops). Jupiter can
  // only ever route the canonical ATA, so that is the row we keep — otherwise
  // we would advertise a balance the swap cannot actually reach, and hand the
  // instruction builder an account the swap never drains.
  //
  // `rawAmount` always belongs to the `tokenAccount` we report, which the
  // instruction builders rely on.
  const byMint = new Map<string, ScannedHolding>();
  for (const holding of [...legacy, ...token2022]) {
    const existing = byMint.get(holding.mint);
    if (!existing) {
      byMint.set(holding.mint, holding);
      continue;
    }
    if (rankAccount(owner, holding) > rankAccount(owner, existing)) {
      byMint.set(holding.mint, {
        ...holding,
        hasTransferFee: existing.hasTransferFee || holding.hasTransferFee,
        hasTransferHook: existing.hasTransferHook || holding.hasTransferHook,
      });
    } else {
      byMint.set(holding.mint, {
        ...existing,
        hasTransferFee: existing.hasTransferFee || holding.hasTransferFee,
        hasTransferHook: existing.hasTransferHook || holding.hasTransferHook,
      });
    }
  }

  // ── Split out the non-fungibles ───────────────────────────────────────────
  // `getTokenAccountsByOwner` cannot tell an NFT from a fungible: an NFT is just
  // a token account with `amount: "1"` and `decimals: 0`, which satisfies every
  // check above. Left in, an NFT lands in the dust list — where the Smart Filter
  // cannot price it and The Void pre-selects it for burning.
  //
  // The mint is what distinguishes them: an NFT is minted exactly once, so its
  // supply is 1. Only 0-decimal holdings need checking, which keeps this to one
  // extra batched call and only for wallets that hold any.
  const zeroDecimal = Array.from(byMint.values())
    .filter((holding) => holding.decimals === 0)
    .map((holding) => holding.mint);
  const oneOfOne = await findOneOfOneMints(zeroDecimal);

  const holdings: ScannedHolding[] = [];
  const nonFungibles: NonFungibleAsset[] = [];

  for (const holding of byMint.values()) {
    if (!oneOfOne.has(holding.mint)) {
      holdings.push(holding);
      continue;
    }

    nonFungibles.push({
      id: holding.mint,
      // No metadata source on this path: Jupiter indexes tokens, not NFTs, so
      // there is no name or artwork to show. The row says so rather than
      // inventing one, and the UI is told to expect it.
      name: `${holding.mint.slice(0, 4)}…${holding.mint.slice(-4)}`,
      imageUri: null,
      imageMime: null,
      collection: null,
      compressed: false,
      interface: "core-rpc:supply-1",
      tokenAccount: holding.tokenAccount,
      program: holding.program,
      // Frozen accounts never reach here — `fetchProgramAccounts` already skips
      // any account whose state is not `initialized`.
      frozen: false,
      // Never compressed on this path: a cNFT is a merkle leaf, so it has no
      // token account for `getProgramAccounts` to find at all. The free scanner
      // cannot see cNFTs, which is why the cNFT tab needs a metadata index.
      merkle: null,
      delegate: null,
    });
  }

  return {
    holdings,
    nonFungibles,
    nativeLamports,
    pages: 1,
    truncated: false,
    source: "core-rpc",
  };
}

/**
 * Mints that are 1-of-1: `decimals === 0` and a total supply of exactly 1.
 *
 * Read straight from the mint account's bytes rather than through
 * `jsonParsed`, because the parsed shape for mint accounts is not guaranteed —
 * the SPL mint layout is, and indexing into it cannot silently return
 * `undefined` that we would then treat as "not an NFT".
 *
 * A failure returns an empty set, so the scan degrades to its previous
 * behaviour instead of failing. That is a deliberate trade: we may miss an NFT
 * on a flaky RPC, but we never *guess* one into the burnable list.
 */
async function findOneOfOneMints(mints: string[]): Promise<Set<string>> {
  const found = new Set<string>();

  for (let offset = 0; offset < mints.length; offset += MINT_BATCH) {
    const batch = mints.slice(offset, offset + MINT_BATCH);
    let accounts: Array<{ data?: unknown } | null>;
    try {
      const result = await rpcCall<{
        value?: Array<{ data?: unknown } | null>;
      }>("getMultipleAccounts", [
        batch,
        { encoding: "base64", commitment: "confirmed" },
      ]);
      accounts = result.value ?? [];
    } catch {
      continue;
    }

    batch.forEach((mint, index) => {
      const data = accounts[index]?.data;
      const base64 = Array.isArray(data) ? data[0] : null;
      if (typeof base64 !== "string") return;

      const bytes = Buffer.from(base64, "base64");
      // SPL mint layout: mintAuthority(COption, 36 bytes) · supply(u64 LE at
      // 36) · decimals(u8 at 44) · isInitialized(45) · freezeAuthority(46..82)
      if (bytes.length < 45) return;
      const supply = bytes.readBigUInt64LE(36);
      const decimals = bytes.readUInt8(44);
      if (supply === 1n && decimals === 0) found.add(mint);
    });
  }

  return found;
}