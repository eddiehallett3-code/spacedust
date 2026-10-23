import "server-only";

import { isValidSolanaAddress } from "@/lib/utils/sanitize";
import { rpcCall } from "@/lib/token-source/rpc.server";
import {
  TOKEN_2022_PROGRAM_ID,
  computeExcessLamports,
} from "./excess-rent";
import type { ExcessRentAccount } from "@/types/salvage";

/**
 * Read Token-2022 accounts that hold more lamports than their rent-exempt
 * minimum.
 *
 * A token account's deposit is set by its data size. If it has more than that —
 * an old deposit, a program credit, or a manual transfer — Token-2022 lets the
 * owner withdraw the difference without closing the account or moving the
 * tokens. This read finds those accounts; the planner re-reads them before
 * building anything.
 *
 * Legacy SPL Token has no withdraw instruction, so only the Token-2022 program
 * is queried. Native (wrapped-SOL) accounts are excluded: their lamports are
 * the wrapped balance, not spare rent.
 */

interface ParsedTokenAccount {
  pubkey?: string;
  account?: {
    lamports?: number;
    owner?: string;
    space?: number;
    data?: {
      space?: number;
      parsed?: {
        info?: {
          mint?: string;
          owner?: string;
          state?: string;
          isNative?: boolean;
          tokenAmount?: { amount?: string };
        };
      };
    };
  };
}

export async function readExcessRentAccounts(
  owner: string,
): Promise<ExcessRentAccount[]> {
  const result = await rpcCall<{ value?: ParsedTokenAccount[] }>(
    "getTokenAccountsByOwner",
    [owner, { programId: TOKEN_2022_PROGRAM_ID }, { encoding: "jsonParsed" }],
  );

  const rentBySpace = new Map<number, number>();
  const accounts: ExcessRentAccount[] = [];
  const seen = new Set<string>();

  for (const entry of result.value ?? []) {
    const info = entry.account?.data?.parsed?.info;
    if (!info) continue;

    const mint = info.mint;
    const address = entry.pubkey;
    if (!mint || !isValidSolanaAddress(mint)) continue;
    if (!address || !isValidSolanaAddress(address)) continue;
    if (seen.has(address)) continue;
    seen.add(address);
    if (info.owner !== owner) continue;
    if (info.isNative === true) continue;

    const state = info.state;
    if (state !== "initialized" && state !== "frozen") continue;
    // A zero-balance account belongs to the empty-account close flow, which
    // returns the whole deposit. Listing it here as well would offer two actions
    // for the same lamports and only one of them is the better one.
    if (info.tokenAmount?.amount === "0") continue;

    const lamports = entry.account?.lamports;
    const space = entry.account?.data?.space ?? entry.account?.space;
    if (typeof lamports !== "number" || !Number.isFinite(lamports)) continue;
    if (typeof space !== "number" || !Number.isFinite(space) || space <= 0) {
      continue;
    }

    let rentLamports = rentBySpace.get(space);
    if (rentLamports === undefined) {
      rentLamports = await rpcCall<number>("getMinimumBalanceForRentExemption", [
        space,
      ]);
      if (!Number.isFinite(rentLamports) || rentLamports <= 0) continue;
      rentBySpace.set(space, rentLamports);
    }

    const excessLamports = computeExcessLamports(lamports, rentLamports);
    if (excessLamports <= 0) continue;

    accounts.push({
      address,
      mint,
      lamports: Math.trunc(lamports),
      rentLamports: Math.trunc(rentLamports),
      excessLamports,
      space: Math.trunc(space),
    });
  }

  return accounts.sort(
    (a, b) =>
      b.excessLamports - a.excessLamports || a.address.localeCompare(b.address),
  );
}
