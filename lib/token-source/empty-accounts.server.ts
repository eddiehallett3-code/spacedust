import "server-only";

import { isValidSolanaAddress } from "@/lib/utils/sanitize";
import { rpcCall } from "./rpc.server";
import type { EmptyTokenAccount, TokenProgramKind } from "@/types/token";

/**
 * Read the wallet's already-empty token accounts.
 *
 * Both token scanners deliberately drop a zero balance, so these accounts never
 * reach the dust list — and that is correct for a sweep, which can only sell or
 * burn something that exists. But their rent is real, and a `closeAccount` is
 * the only way to get it back. This read exists solely for that.
 *
 * Why it is its own read rather than something the scanners hand back:
 * closeability is a property of the *account* — its close authority and its
 * withheld fees — and DAS reports neither. `getTokenAccountsByOwner` with
 * `jsonParsed` gives both for one extra pair of calls, whatever the scan source
 * was, so this is the one path both share.
 */

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Token-2022 extensions as jsonParsed reports them on a token account. */
type ParsedExtensions = Array<{
  extension?: string;
  state?: { withheldAmount?: number | string } | null;
}>;

/** The jsonParsed shape of a token account, as far as we rely on it. */
interface ParsedTokenAccount {
  pubkey?: string;
  account?: {
    lamports?: number;
    data?: {
      parsed?: {
        info?: {
          mint?: string;
          owner?: string;
          state?: string;
          closeAuthority?: string | null;
          tokenAmount?: { amount?: string } | null;
          extensions?: ParsedExtensions;
        };
      };
    };
  };
}

/**
 * The withheld transfer fee on one account, if it has the extension.
 *
 * `0` means there is no extension at all, which is the common case. A present
 * but unreadable amount is reported as `1`, not `0`: the rule is "close only
 * when the withheld balance is zero", so failing to read a zero must never be
 * mistaken for reading a zero.
 */
function withheldFeesOn(extensions: ParsedExtensions | undefined): number {
  const entry = extensions?.find((ext) => ext?.extension === "transferFeeAmount");
  if (!entry) return 0;

  const value = Number(entry.state?.withheldAmount ?? Number.NaN);
  if (!Number.isFinite(value) || value < 0) return 1;
  return Math.trunc(value);
}

/**
 * Every empty account for one owner under one token program.
 *
 * One request. `getTokenAccountsByOwner` has no page parameter, so this used to
 * re-send the identical read up to ten times — appending the same accounts each
 * time, and never reaching one the first response did not contain. De-duplicating
 * by address is the only page-like behaviour available, and it is the one that
 * matters: a duplicate row would become a second `closeAccount` for the same
 * account, and the second one fails the whole transaction.
 */
async function fetchEmptyAccounts(
  owner: string,
  programId: string,
  program: TokenProgramKind,
): Promise<EmptyTokenAccount[]> {
  const empty: EmptyTokenAccount[] = [];
  const seen = new Set<string>();

  const result = await rpcCall<{ value?: ParsedTokenAccount[] }>(
    "getTokenAccountsByOwner",
    [owner, { programId }, { encoding: "jsonParsed" }],
  );

  for (const entry of result.value ?? []) {
    const info = entry.account?.data?.parsed?.info;
    const mint = info?.mint;
    if (!mint || !isValidSolanaAddress(mint)) continue;

    // Only a zero balance. Anything with a balance belongs to the token list,
    // where it is valued and can be sold or burned.
    if ((info?.tokenAmount?.amount ?? null) !== "0") continue;

    // `uninitialized` accounts have no owner recorded, so nothing can
    // authorise a close for them. `frozen` is kept: freezing blocks a
    // transfer, a burn and a revoke, but it does not block a close.
    const state = info?.state;
    if (state !== "initialized" && state !== "frozen") continue;

    // Defensive: `getTokenAccountsByOwner` filters on this field already, so
    // a mismatch means we misread the response and should not act on it.
    if (info?.owner !== owner) continue;

    const address = entry.pubkey;
    if (typeof address !== "string" || !isValidSolanaAddress(address)) continue;
    if (seen.has(address)) continue;
    seen.add(address);

    const lamports = entry.account?.lamports;
    if (typeof lamports !== "number" || !Number.isFinite(lamports)) continue;

    const closeAuthority = info?.closeAuthority;
    empty.push({
      address,
      mint,
      program,
      lamports: Math.trunc(lamports),
      frozen: state === "frozen",
      closeAuthority:
        typeof closeAuthority === "string" && isValidSolanaAddress(closeAuthority)
          ? closeAuthority
          : null,
      withheldFees: withheldFeesOn(info?.extensions),
    });
  }

  return empty;
}

/**
 * Every empty token account this wallet still pays rent on.
 *
 * Sequential, not parallel: the public endpoint throttles
 * `getTokenAccountsByOwner` hardest, and firing both programs at once reliably
 * trips it from a shared IP.
 */
export async function listEmptyTokenAccounts(
  owner: string,
): Promise<EmptyTokenAccount[]> {
  const legacy = await fetchEmptyAccounts(owner, TOKEN_PROGRAM, "legacy");
  const token2022 = await fetchEmptyAccounts(owner, TOKEN_2022_PROGRAM, "token2022");

  // Deterministic order — largest rent first, then address — so the same wallet
  // always produces the same list, and a preview can be compared against it.
  return [...legacy, ...token2022].sort(
    (a, b) => b.lamports - a.lamports || a.address.localeCompare(b.address),
  );
}
