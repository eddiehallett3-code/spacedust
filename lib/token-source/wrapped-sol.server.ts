import "server-only";

import { isValidSolanaAddress } from "@/lib/utils/sanitize";
import { rpcCall } from "./rpc.server";
import type { WrappedSolAccount } from "@/types/salvage";

/**
 * Read the wallet's non-empty wrapped-SOL accounts.
 *
 * A wSOL balance is not dust: it is SOL the user wrapped for a swap, a program
 * deposit or a marketplace bid. The token scanners drop the wSOL mint because it
 * is the native asset, and the empty-account reader drops it because its balance
 * is not zero — so without this read the position is invisible in Salvage.
 *
 * Closing the account is the unwrap: the token program returns the account's
 * whole lamport balance, wrapped amount and rent deposit alike, to the owner.
 * This module only reads; the planner decides what can actually be closed.
 */

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

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
        };
      };
    };
  };
}

/** One lamport amount from the RPC, or null when it is not a safe integer. */
function safeLamports(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/** Every non-empty wrapped-SOL account this wallet owns. */
export async function listWrappedSolAccounts(
  owner: string,
): Promise<WrappedSolAccount[]> {
  const result = await rpcCall<{ value?: ParsedTokenAccount[] }>(
    "getTokenAccountsByOwner",
    [owner, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }],
  );

  const accounts: WrappedSolAccount[] = [];
  const seen = new Set<string>();

  for (const entry of result.value ?? []) {
    const info = entry.account?.data?.parsed?.info;
    if (info?.mint !== WSOL_MINT) continue;
    if (info.owner !== owner) continue;

    // An empty wSOL account belongs to the ordinary rent-reclaim list, not here.
    const amountText = info.tokenAmount?.amount;
    if (typeof amountText !== "string" || !/^\d+$/.test(amountText)) continue;
    if (amountText === "0") continue;

    const amountLamports = Number(amountText);
    if (!Number.isSafeInteger(amountLamports) || amountLamports <= 0) continue;

    const address = entry.pubkey;
    if (typeof address !== "string" || !isValidSolanaAddress(address)) continue;
    if (seen.has(address)) continue;
    seen.add(address);

    const lamports = safeLamports(entry.account?.lamports);
    if (lamports === null || lamports < amountLamports) continue;

    const closeAuthority = info.closeAuthority;
    accounts.push({
      address,
      amountLamports,
      lamports,
      // A native account's amount is its lamports minus the rent deposit. The
      // subtraction is done here rather than assumed from a rent constant, so a
      // fee can never be charged on the SOL the user wrapped.
      rentLamports: lamports - amountLamports,
      closeAuthority:
        typeof closeAuthority === "string" && isValidSolanaAddress(closeAuthority)
          ? closeAuthority
          : null,
    });
  }

  return accounts.sort(
    (a, b) => b.amountLamports - a.amountLamports || a.address.localeCompare(b.address),
  );
}
