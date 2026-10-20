import "server-only";

import {
  getServerRpcUrl,
  hasHelius,
} from "@/lib/config/env";
import { UpstreamError } from "@/lib/utils/errors";
import { DAS_MAX_PAGES, DAS_PAGE_SIZE, TOKEN_2022_PROGRAM_ID } from "@/lib/utils/constants";
import {
  sanitizeImageUri,
  sanitizeLogoUri,
  sanitizeSymbol,
  sanitizeText,
  isValidSolanaAddress,
  parseBaseAmount,
} from "@/lib/utils/sanitize";
import {
  MERKLE_TREE_HEADER_SIZE,
  canopyDepthFromSpace,
  parseMerkleTreeHeader,
  truncateProofToCanopy,
} from "@/lib/solana/canopy";

/**
 * Server-side Helius DAS client.
 *
 * DAS returns one unified index of every NFT, fungible SPL token and
 * Token-2022 account a wallet owns. That means a single paginated call covers
 * both token programs — no guessing program ids, no manual account decoding,
 * and no risk of silently missing a Token-2022 mint.
 */

/** The slice of a DAS asset we care about for a fungible token. */
interface DasTokenInfo {
  symbol?: string;
  price_info?: { price_per_token?: number | null } | null;
  organic_score?: number | null;
  holder_count?: number | null;
  /** Raw balance in base units. DAS moved this here from a top-level `amount`. */
  balance?: number | string | null;
  token_accounts?: Array<{ address?: string; balance?: number | string }> | null;
  /**
   * Which token program owns the mint. Present on NFTs as well as fungibles,
   * and it is what decides which program a burn and a close must go through.
   */
  token_program?: string | null;
  /**
   * The account holding a **non-fungible** token.
   *
   * DAS reports an NFT's token account here and nowhere else: `token_accounts`
   * below is only populated for fungibles. Missing this field meant every SPL
   * NFT and pNFT was scanned with no account, and every burn was refused for a
   * reason that blamed the wallet.
   */
  associated_token_address?: string | null;
}

interface DasAsset {
  id: string;
  interface: string;
  content?: {
    metadata?: {
      name?: string;
      symbol?: string;
      uri?: string;
      /** Some responses nest decimals here instead of on the mint. */
      token_info?: { decimals?: number | string } | null;
    } | null;
    links?: { image?: string };
    /**
     * The asset's media, with MIME types. Preferred over `links.image` for
     * NFTs, because it tells us whether the file is actually an image: plenty
     * of collections store an mp4 or glb and would otherwise render as a
     * broken still.
     */
    files?: Array<{ uri?: string; mime?: string }> | null;
  } | null;
  token_info?: DasTokenInfo | null;
  token_accounts?: string[] | null;
  /** Legacy top-level balance, kept as a fallback. */
  amount?: string | number | null;
  /**
   * Compressed-asset bookkeeping. `compressed: true` marks a cNFT — a merkle
   * leaf, not a token account — and the rest is what a Bubblegum burn needs in
   * order to find and prove that leaf.
   */
  /**
   * Helius's own record that a burn reached this asset.
   *
   * Not a documented DAS parameter or filter — requesting one is rejected — but
   * it is present on every asset and it is right. See `indexFlagsBurnt`.
   */
  burnt?: boolean;
  compression?: {
    compressed?: boolean;
    /** The merkle tree holding the leaf. */
    tree?: string;
    /** The leaf's index within that tree. */
    leaf_id?: number;
    /** The two hashes the leaf commits to. */
    data_hash?: string;
    creator_hash?: string;
    /** Bubblegum V2 leaves commit to these as well. Absent on a V1 leaf. */
    asset_data_hash?: string;
    flags?: number;
  } | null;
  /** Collection membership. Names only arrive when collection metadata is on. */
  grouping?: Array<{
    group_key?: string;
    group_value?: string;
    collection_metadata?: { name?: string } | null;
  }> | null;
  ownership?: {
    owner?: string;
    frozen?: boolean;
    delegated?: boolean;
    /** The delegate itself, which a delegated leaf's burn has to name. */
    delegate?: string | null;
  } | null;
}

interface DasResult {
  items?: DasAsset[];
  total?: number;
  limit?: number;
  page?: number;
  /** Present when `showNativeBalance: true`. */
  nativeBalance?: { lamports?: number; price_per_sol?: number } | null;
}

interface DasResponse {
  result?: DasResult;
  error?: { message?: string; code?: number };
}

// Shared scanner contract, also produced by the free core-RPC scanner.
import { assetIsGone, indexFlagsBurnt } from "@/lib/solana/liveness";
import type { ScanResult, ScannedHolding } from "@/lib/token-source/types";
import type { NonFungibleAsset, CompressedLeaf } from "@/types/token";

export type { ScanResult, ScannedHolding };

async function dasRequest(
  body: Record<string, unknown>,
): Promise<DasResult> {
  // DAS is only called when the premium source is configured; otherwise the
  // caller uses the free core-RPC scanner instead.
  if (!hasHelius()) {
    throw new UpstreamError("Helius DAS is not configured", "helius");
  }
  const url = getServerRpcUrl();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "1", ...body }),
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new UpstreamError(
      `Helius request failed: ${
        error instanceof Error ? error.message : "network error"
      }`,
      "helius",
    );
  }

  const json = (await response.json().catch(() => null)) as DasResponse | null;

  if (!response.ok) {
    throw new UpstreamError(
      `Helius responded ${response.status}. Check that HELIUS_API_KEY is valid.`,
      "helius",
      response.status,
    );
  }
  if (json?.error) {
    throw new UpstreamError(
      `Helius error: ${json.error.message ?? "unknown"}`,
      "helius",
      json.error.code,
    );
  }
  if (!json?.result) {
    throw new UpstreamError("Helius returned an empty result", "helius");
  }
  return json.result;
}

// MARKER_DAS
/** What a Bubblegum burn needs from the indexer, beyond the leaf's own hashes. */
export interface AssetProof {
  /** The tree's root at the moment the indexer computed this proof. */
  root: string;
  /** Sibling hashes connecting the leaf to that root. */
  proof: string[];
  /**
   * The leaf's position in the tree's *node array*.
   *
   * Recorded because the indexer offers it, and *not* the number a burn takes:
   * a burn wants the leaf's index, which is `compression.leaf_id`. Kept here so
   * the difference is visible rather than something a caller rediscovers.
   */
  nodeIndex: number;
}

/**
 * Cache of canopy facts, keyed by tree. A tree's canopy is fixed at creation.
 * `maxDepth` is kept so the proof helper can tell a full proof apart from an
 * indexer that already trimmed the canopy tail.
 */
interface TreeCanopy {
  canopyDepth: number;
  maxDepth: number;
}
const canopyDepthCache = new Map<string, TreeCanopy>();

/**
 * How many proof nodes a tree's canopy already stores on chain.
 *
 * DAS `getAssetProof` returns the full proof, including the tail that lives in
 * the canopy. Sending that tail as transaction accounts is what makes deep
 * proofs too large, so we read the tree header and derive the canopy depth,
 * exactly as Metaplex's `getAssetWithProof({ truncateCanopy: true })` does.
 *
 * The header slice is 56 bytes, which is cheap even on a tree account that is
 * hundreds of kilobytes. Any failure is cached as zero so a flaky RPC cannot
 * turn every proof in a batch into another lookup; the caller then keeps the
 * full proof, which is the safe fallback.
 */
async function fetchTreeCanopy(treeId: string): Promise<TreeCanopy> {
  const cached = canopyDepthCache.get(treeId);
  if (cached !== undefined) return cached;

  let canopy: TreeCanopy = { canopyDepth: 0, maxDepth: 0 };
  try {
    const response = await fetch(getServerRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "getAccountInfo",
        params: [
          treeId,
          {
            encoding: "base64",
            dataSlice: { offset: 0, length: MERKLE_TREE_HEADER_SIZE },
          },
        ],
      }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });

    const json = (await response.json().catch(() => null)) as {
      result?: {
        value?: { space?: number; data?: [string, string] } | null;
      } | null;
    } | null;

    const value = json?.result?.value;
    const encoded = value?.data?.[0];
    if (value?.space && typeof encoded === "string") {
      const header = parseMerkleTreeHeader(
        new Uint8Array(Buffer.from(encoded, "base64")),
      );
      if (header) {
        canopy = {
          canopyDepth: canopyDepthFromSpace(value.space, header),
          maxDepth: header.maxDepth,
        };
      }
    }
  } catch {
    // Keep the full proof if the tree cannot be read.
  }

  canopyDepthCache.set(treeId, canopy);
  return canopy;
}

/**
 * The merkle proof for one compressed asset.
 *
 * Only an indexer can produce this: it needs every other leaf in the tree. That
 * also makes it perishable — the tree can gain a leaf at any moment, and a proof
 * older than the tree's current root is worthless — which is why callers fetch
 * it at plan time rather than carrying it around from the scan.
 *
 * Returns `null` rather than throwing: one asset without a usable proof should
 * be a row that says why, never a scan or a plan that fails outright.
 */
export async function fetchAssetProof(id: string): Promise<AssetProof | null> {
  if (!isValidSolanaAddress(id)) return null;

  try {
    const result = (await dasRequest({
      method: "getAssetProof",
      params: { id },
    })) as unknown as {
      root?: string;
      proof?: string[];
      node_index?: number;
      /** The tree this leaf belongs to; needed to find its canopy depth. */
      tree_id?: string;
    };

    if (
      typeof result?.root !== "string" ||
      !isValidSolanaAddress(result.root) ||
      !Array.isArray(result.proof) ||
      result.proof.some((node) => !isValidSolanaAddress(node))
    ) {
      return null;
    }

    // DAS returns the full proof, including nodes that are already on chain in
    // the tree's canopy. Removing those is the difference between a 24-account
    // burn that cannot fit and a 7-account one that does.
    let proof = result.proof;
    if (
      typeof result.tree_id === "string" &&
      isValidSolanaAddress(result.tree_id)
    ) {
      const canopy = await fetchTreeCanopy(result.tree_id);
      proof = truncateProofToCanopy(
        proof,
        canopy.canopyDepth,
        canopy.maxDepth || undefined,
      );
    }

    return {
      root: result.root,
      proof,
      nodeIndex:
        typeof result.node_index === "number" ? result.node_index : 0,
    };
  } catch {
    // Not configured, rate limited, tree unknown to the index — all the same
    // answer to the caller, and all reported downstream in plain words.
    return null;
  }
}

/** Details we need from each mint account, resolved on-chain. */
interface MintDetails {
  program: "legacy" | "token2022";
  decimals: number;
  /** Token-2022 `transferFeeConfig` — the ATA will keep a residue after a swap. */
  hasTransferFee: boolean;
  /** Token-2022 `transferHook` — transfers can invoke arbitrary code. */
  hasTransferHook: boolean;
}

interface JsonParsedMint {
  owner?: string;
  data?: {
    parsed?: {
      info?: {
        decimals?: number;
        extensions?: Array<{ extension?: string }>;
      };
    };
  };
}

/**
 * Resolve each mint's owning program, decimals and Token-2022 extensions.
 *
 * DAS does not reliably return `decimals`, and getting it wrong makes balances
 * display as absurd numbers. Decoding the mint account itself is authoritative.
 *
 * We also inspect extensions, because two of them change whether a dust sweep is
 * safe at all:
 *  - `transferHook` can run arbitrary code on transfer, so we never sweep one.
 *  - `transferFeeConfig` leaves a balance residue in the source ATA, which means
 *    `closeAccount` would fail — the caller uses this to skip rent reclaim.
 */
async function resolveMintDetails(
  rpcUrl: string,
  mints: string[],
): Promise<Map<string, MintDetails>> {
  const result = new Map<string, MintDetails>();
  if (mints.length === 0) return result;

  // getMultipleAccounts caps out at 100 keys per call.
  const CHUNK = 100;
  const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

  for (let i = 0; i < mints.length; i += CHUNK) {
    const chunk = mints.slice(i, i + CHUNK);
    let accounts: JsonParsedMint[] = [];
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          method: "getMultipleAccounts",
          params: [chunk, { encoding: "jsonParsed" }],
        }),
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      const json = (await response.json()) as {
        result?: { value?: JsonParsedMint[] };
        error?: { message?: string };
      };
      if (json.error) {
        throw new Error(json.error.message ?? "RPC error");
      }
      // The account array lives at `result.value`, not `result` — reading
      // `result` directly yields a single `{ context, value }` object, which
      // silently produces decimals=0 for every mint.
      accounts = json.result?.value ?? [];
    } catch (error) {
      // Non-fatal, but never silent: a failed chunk means every mint in it
      // keeps decimals=0, which renders absurd balances and USD values.
      console.warn(
        `[spacedust] resolveMintDetails chunk ${i / CHUNK + 1} failed:`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }

    chunk.forEach((mint, index) => {
      const account = accounts[index];
      const isToken2022 = account?.owner === TOKEN_2022_PROGRAM;
      const parsed = account?.data?.parsed?.info;
      const decimals = parsed?.decimals;
      const extensions = new Set(
        (parsed?.extensions ?? [])
          .map((ext) => ext?.extension)
          .filter((name): name is string => typeof name === "string"),
      );

      result.set(mint, {
        program: isToken2022 ? "token2022" : "legacy",
        decimals:
          typeof decimals === "number" &&
          Number.isInteger(decimals) &&
          decimals >= 0 &&
          decimals <= 30
            ? decimals
            : 0,
        hasTransferFee: extensions.has("transferFeeConfig"),
        hasTransferHook: extensions.has("transferHook"),
      });
    });
  }
  return result;
}

/**
 * Read decimals from DAS metadata, falling back to a fixed value.
 *
 * DAS does not always surface `token_info.decimals`, so we default to 0 and the
 * client corrects it from on-chain data when the value matters for display.
 */
function parseDecimals(metadata: unknown, fallback: number): number {
  if (metadata && typeof metadata === "object") {
    const record = metadata as Record<string, unknown>;
    const tokenInfo = record.token_info as
      | { decimals?: number | string }
      | undefined;
    const value = tokenInfo?.decimals;
    const parsed = typeof value === "string" ? Number(value) : value;
    if (
      typeof parsed === "number" &&
      Number.isInteger(parsed) &&
      parsed >= 0 &&
      parsed <= 30
    ) {
      return parsed;
    }
  }
  return fallback;
}

/**
 * Fetch every fungible token (SPL + Token-2022) owned by `owner`.
 *
 * Paginates with page numbers and stops as soon as a short page comes back,
 * which is how DAS signals "no more results".
 */
export async function scanWalletTokens(owner: string): Promise<ScanResult> {
  const rpcUrl = getServerRpcUrl();
  const holdings: ScannedHolding[] = [];
  const nonFungibles: NonFungibleAsset[] = [];
  let nativeLamports = 0;
  let pages = 0;
  let truncated = false;

  for (let page = 1; page <= DAS_MAX_PAGES; page += 1) {
    const result = await dasRequest({
      method: "getAssetsByOwner",
      params: {
        ownerAddress: owner,
        page,
        limit: DAS_PAGE_SIZE,
        options: {
          // DAS dropped the old top-level `tokenType: "fungible"` in favour of
          // these booleans. `showZeroBalance: false` keeps dead accounts out
          // of the result entirely, which is a large win on messy wallets.
          showFungible: true,
          showNativeBalance: true,
          showZeroBalance: false,
          // Collection names, so NFT rows can show "Pixel Guild" rather than a
          // bare address. Names are the one thing DAS does not include by
          // default.
          showCollectionMetadata: true,
        },
        // NOTE: `displayOptions` and `options` cannot both be supplied — the
        // endpoint rejects the request with "duplicate field" if they are.
      },
    });
    pages += 1;

    if (result.nativeBalance && Number.isFinite(result.nativeBalance.lamports)) {
      nativeLamports = result.nativeBalance.lamports ?? nativeLamports;
    }

    const items = result.items ?? [];
    for (const item of items) {
      const holding = normaliseAsset(item);
      if (holding) {
        holdings.push(holding);
        continue;
      }
      // Not fungible. Anything else DAS can describe — NFT, pNFT, Core asset,
      // cNFT — is listed separately so it is visible and, later, burnable, but
      // it never enters the sweepable set. See `WalletScan.nonFungibles`.
      const nonFungible = normaliseNonFungible(item);
      if (nonFungible) nonFungibles.push(nonFungible);
    }

    if (items.length < DAS_PAGE_SIZE) break;
    if (page === DAS_MAX_PAGES) truncated = true;
  }

  // Resolve each mint's program, decimals and Token-2022 extensions on-chain.
  const details = await resolveMintDetails(
    rpcUrl,
    holdings.map((holding) => holding.mint),
  );
  for (const holding of holdings) {
    const info = details.get(holding.mint);
    if (!info) continue;
    holding.program = info.program;
    // DAS decimals are a guess; the mint account is authoritative.
    holding.decimals = info.decimals;
    holding.hasTransferFee = info.hasTransferFee;
    holding.hasTransferHook = info.hasTransferHook;
  }

  return {
    holdings,
    nonFungibles:
      nonFungibles.length > 0
        ? await liveNonFungibles(rpcUrl, nonFungibles)
        : nonFungibles,
    nativeLamports,
    pages,
    truncated,
    source: "helius-das" as const,
  };
}

/**
 * The assets whose accounts still exist and are not burned husks.
 *
 * Only the ones that have an account *by nature* are checked at all: a cNFT's
 * id is a merkle leaf, so asking about it would get nothing back and — the first
 * time this shipped — every live cNFT was quietly dropped. One batched call per
 * hundred, over the rest.
 *
 * Unreadable is not burned: a failed call returns everything, because hiding a
 * live asset would be the worse mistake.
 */
async function liveNonFungibles(
  rpcUrl: string,
  assets: NonFungibleAsset[],
): Promise<NonFungibleAsset[]> {
  const checked = assets.filter((asset) => !asset.compressed);
  if (checked.length === 0) return assets;

  const gone = new Set<string>();

  for (let start = 0; start < checked.length; start += 100) {
    const batch = checked.slice(start, start + 100);
    let accounts: Array<{ data?: [string, string] } | null> | null = null;

    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          method: "getMultipleAccounts",
          params: [batch.map((asset) => asset.id), { encoding: "base64" }],
        }),
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      const json = (await response.json().catch(() => null)) as {
        result?: { value?: Array<{ data?: [string, string] } | null> };
      } | null;
      accounts = json?.result?.value ?? null;
    } catch {
      // Unreadable is unknown, and unknown is not burned.
    }

    if (accounts === null || accounts.length !== batch.length) continue;

    batch.forEach((asset, index) => {
      if (assetIsGone(asset, accounts?.[index] ?? null)) gone.add(asset.id);
    });
  }

  return assets.filter((asset) => !gone.has(asset.id));
}

/**
 * Is this a fungible token, as opposed to an NFT of any flavour?
 *
 * DAS states the answer in `interface`, and this check has to be explicit
 * because nothing else in this file excludes an NFT. An uncompressed NFT
 * arrives with `token_info.balance = 1` and its own token account, so it passes
 * the balance check below and lands in the dust list as a zero-priced "token".
 * The Void pre-selects unpriced tokens for burning — so without this, an NFT is
 * one click from being destroyed for the ~0.0015 SOL of rent locked in its
 * token account.
 *
 * Unknown interfaces count as non-fungible deliberately. Refusing to sweep
 * something we do not understand is the safe failure: a dust token we skip
 * costs the user nothing, while an NFT we misread costs them the NFT.
 */
function isFungibleInterface(iface: string | undefined): boolean {
  return typeof iface === "string" && iface.startsWith("Fungible");
}

/** Convert one DAS asset into a holding, or drop it if it is not sweepable. */
function normaliseAsset(item: DasAsset): ScannedHolding | null {
  const mint = item?.id;
  if (!mint) return null;

  // Fungibles only — see `isFungibleInterface`. NFTs and cNFTs are collected
  // separately so they can be listed and burned explicitly, never swept as dust.
  if (!isFungibleInterface(item.interface)) return null;

  // Require a real, non-zero balance. DAS used to return this as a top-level
  // `amount`; it now lives at `token_info.balance`. Accept either so a future
  // shape change degrades to a warning rather than an empty scan.
  const amount = item.token_info?.balance ?? item.amount;
  const rawAmount =
    typeof amount === "string"
      ? amount
      : typeof amount === "number" && Number.isFinite(amount)
        ? String(Math.trunc(amount))
        : null;
  if (!rawAmount || rawAmount === "0") return null;

  const metadata = item.content?.metadata;
  const symbol = sanitizeSymbol(metadata?.symbol ?? item.token_info?.symbol);
  const name = sanitizeText(
    metadata?.name,
    48,
    symbol === "???" ? "Unknown token" : symbol,
  );
  const logoUri = sanitizeLogoUri(
    metadata?.uri ?? item.content?.links?.image ?? null,
  );

  const dasPriceRaw = item.token_info?.price_info?.price_per_token;
  const dasPriceUsd =
    typeof dasPriceRaw === "number" &&
    Number.isFinite(dasPriceRaw) &&
    dasPriceRaw > 0
      ? dasPriceRaw
      : null;

  const organic = item.token_info?.organic_score;
  const holders = item.token_info?.holder_count;

  return {
    mint,
    symbol,
    name,
    logoUri,
    rawAmount,
    decimals: parseDecimals(metadata, 0),
    dasPriceUsd,
    organicScore: typeof organic === "number" ? organic : null,
    holderCount: typeof holders === "number" ? holders : null,
    program: "legacy",
    tokenAccount: pickTokenAccount(item),
    // Corrected by resolveMintDetails.
    hasTransferFee: false,
    hasTransferHook: false,
    // DAS states this on `ownership` for token-backed assets. A frozen holding
    // can be neither moved nor closed, so it must not be counted as recoverable
    // — see `summariseRecoverable`.
    frozen: item.ownership?.frozen === true,
  };
}

/**
 * The token account DAS says holds this balance.
 *
 * Usually the canonical ATA, but not guaranteed: old airdrops and some tooling
 * create token accounts at arbitrary addresses. When DAS lists several, take
 * the richest one — that is the account whose rent is actually worth reclaiming.
 * Returns `null` when DAS gave us nothing usable, and callers fall back to the
 * derived ATA.
 */
function pickTokenAccount(item: DasAsset): string | null {
  const detailed = item.token_info?.token_accounts;
  if (Array.isArray(detailed)) {
    let best: string | null = null;
    let bestBalance = -1n;
    for (const entry of detailed) {
      const address = entry?.address;
      if (typeof address !== "string" || !isValidSolanaAddress(address)) continue;
      const balance = parseBaseAmount(entry?.balance ?? "0") ?? 0n;
      if (balance > bestBalance) {
        bestBalance = balance;
        best = address;
      }
    }
    if (best) return best;
  }

  // An NFT or a pNFT: DAS names its account here and nowhere else. There is no
  // `token_accounts` for a non-fungible, and no bare list either — so without
  // this, every SPL NFT and pNFT arrived with no account at all and was refused
  // with "its token account could not be located", which read like a scanner
  // failure because it was one.
  //
  // Taken as given: the burn is simulated before anyone signs, so a stale
  // address surfaces as a clear error rather than a surprise.
  const associated = item.token_info?.associated_token_address;
  if (typeof associated === "string" && isValidSolanaAddress(associated)) {
    return associated;
  }

  // Older DAS responses only list bare addresses, in no particular order.
  const bare = item.token_accounts;
  if (Array.isArray(bare)) {
    return bare.find((address) => isValidSolanaAddress(address)) ?? null;
  }

  return null;
}

/**
 * Convert one non-fungible DAS asset into a listed asset, or drop it.
 *
 * Display metadata, plus the one piece of execution data a later burn needs —
 * the token account — so nothing has to re-fetch the asset or guess an ATA at
 * burn time.
 *
 * `token_info.associated_token_address` is where DAS exposes that address for a
 * non-fungible — not `token_info.token_accounts`, which it fills only for
 * fungibles. Believing the opposite is what made every SPL NFT reject as "its
 * token account could not be located". Deriving the canonical ATA instead would
 * be wrong for the reason it is wrong for dust: non-canonical holdings exist,
 * and closing an address that holds no account
 * fails on-chain with `InvalidAccountData`.
 */
function normaliseNonFungible(item: DasAsset): NonFungibleAsset | null {
  const id = item?.id;
  if (!id || !isValidSolanaAddress(id)) return null;

  // The index says it was burned, so it is not something anyone owns. This is
  // the only signal that covers every asset class: a closed mint, a Core husk
  // and — the case nothing else can reach — a cNFT leaf, which leaves no
  // account behind for the liveness pass to inspect. Without this a destroyed
  // asset returns on the next scan and reads as a burn that never happened.
  if (indexFlagsBurnt(item)) return null;

  // A collection is not an asset a wallet holds — it is an account, and DAS
  // surfaces them once collection metadata is requested. Listing one in the
  // grid as something you own (and might burn) would simply be wrong.
  if (typeof item.interface === "string" && item.interface.endsWith("Collection")) {
    return null;
  }

  const compressed = item.compression?.compressed === true;

  const collectionEntry = item.grouping?.find(
    (group) => group?.group_key === "collection" && group?.group_value,
  );
  const collectionValue = collectionEntry?.group_value;
  // Name only when the index actually gave us one. Inventing "Untitled
  // collection" would hide the fact that we do know the collection address,
  // which is the useful thing to show when the name is missing.
  const rawCollectionName = collectionEntry?.collection_metadata?.name;
  const collection =
    collectionValue && isValidSolanaAddress(collectionValue)
      ? {
          address: collectionValue,
          name:
            typeof rawCollectionName === "string" && rawCollectionName.trim()
              ? sanitizeText(rawCollectionName, 48, "Untitled collection")
              : null,
        }
      : null;

  // Prefer `files` over `links.image`: it carries a MIME type, so we can tell
  // artwork from the mp4s and 3D payloads that would render as broken stills.
  const files = item.content?.files ?? [];
  const imageFile = files.find((file) =>
    typeof file?.mime === "string" ? file.mime.startsWith("image/") : false,
  );
  const imageUri = sanitizeImageUri(
    imageFile?.uri ?? item.content?.links?.image ?? null,
  );
  const imageMime =
    typeof imageFile?.mime === "string" ? imageFile.mime.slice(0, 64) : null;

  // A compressed asset has no token account at all. For an uncompressed one,
  // `null` from `pickTokenAccount` means "unknown" — the burn path must read
  // that as "cannot burn", never as "derive the ATA".
  const tokenAccount = compressed ? null : pickTokenAccount(item);
  const tokenProgram = item.token_info?.token_program;

  return {
    id,
    name: sanitizeText(item.content?.metadata?.name, 64, "Untitled NFT"),
    imageUri,
    imageMime,
    collection,
    compressed,
    interface: typeof item.interface === "string" ? item.interface : "Unknown",
    tokenAccount,
    // The mint's own program, which the burn and the close must both use.
    program: tokenProgram === TOKEN_2022_PROGRAM_ID ? "token2022" : "legacy",
    frozen: item.ownership?.frozen === true,
    // Read only when the index says this is compressed: on an uncompressed
    // asset these fields are absent anyway, and half a leaf is worse than none.
    merkle: compressed ? readCompressedLeaf(item) : null,
    delegate: item.ownership?.delegate ?? null,
  };
}

/**
 * The four facts a compressed asset's burn is built from, if the index gave us
 * all of them.
 *
 * All-or-nothing on purpose. A burn built from three of the four encodes
 * perfectly and then fails on chain, so a partial read has to come back as "we
 * do not know this leaf" and be refused upstream, where it can say so.
 *
 * The two hashes are validated the same way as an address, because that is the
 * same check: base58 that decodes to exactly 32 bytes. A hash is not an
 * address, but it is the same shape, and a truncated one must not get through.
 */
function readCompressedLeaf(item: DasAsset): CompressedLeaf | null {
  const tree = item.compression?.tree;
  const leafId = item.compression?.leaf_id;
  const dataHash = item.compression?.data_hash;
  const creatorHash = item.compression?.creator_hash;
  const assetDataHash = item.compression?.asset_data_hash;
  const flags = item.compression?.flags;

  if (
    typeof tree !== "string" ||
    typeof dataHash !== "string" ||
    typeof creatorHash !== "string" ||
    !isValidSolanaAddress(tree) ||
    !isValidSolanaAddress(dataHash) ||
    !isValidSolanaAddress(creatorHash) ||
    typeof leafId !== "number" ||
    !Number.isInteger(leafId) ||
    leafId < 0
  ) {
    return null;
  }

  // V2 extras are read *separately*, because their absence is what makes a V1
  // leaf a V1 leaf: the indexer gives `asset_data_hash` and `flags` only for a
  // V2 asset, and a V2 asset is refused upstream if either is missing. Read
  // leniently here so a V1 leaf stays burnable, and strictly there so a V2 leaf
  // never is.
  const v2Hash =
    typeof assetDataHash === "string" && isValidSolanaAddress(assetDataHash)
      ? assetDataHash
      : null;
  const v2Flags =
    typeof flags === "number" && Number.isInteger(flags) && flags >= 0
      ? flags
      : null;

  return {
    tree,
    leafId,
    dataHash,
    creatorHash,
    assetDataHash: v2Hash,
    flags: v2Flags,
  };
}