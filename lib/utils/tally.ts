/** App-wide counters.
 *
 * Everything on this page that "counts" is driven here, so the same number is
 * shown in the header chips and in the history panel. These are the only two
 * pieces of persistent state this app owns, and they are the only state that
 * survives unrelated re-renders, so they should only change for one of three
 * reasons:
 *
 *  1. A real dust sweep has landed (server confirmation), in which case this
 *     counter bumps and the history panel writes a new row.
 *  2. The window is closed without a sweep, in which case the counter never
 *     changes and the history entry for that attempt was never made.
 *  3. This module is imported for a different purpose, in which case it must
 *     never accidentally read or write these counters.
 */

import { useLocalStorage } from "@/hooks/use-local-storage";
import { STORAGE_KEYS } from "@/lib/utils/constants";
import type { OutputAsset, SweepHistoryEntry } from "@/types/sweep";

/** Returns [wallets, setWallets] - the current success tally. */
export function useSweptCounters(): [
  number,
  (value: number | ((previous: number) => number)) => void,
] {
  return useLocalStorage(
    STORAGE_KEYS.sweptWallets,
    0,
    (value): value is number =>
      typeof value === "number" && Number.isInteger(value) && value >= 0,
  );
}

/** Returns [usd, setUsd] - cumulative USD value of all successful sweeps. */
export function useSweptUsd(): [number, (value: number | ((previous: number) => number)) => void] {
  return useLocalStorage(
    STORAGE_KEYS.sweptUsd,
    0,
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
}

/** Build a new history entry from a confirmed sweep result.
 *
 * The server already computed every figure we need here: total output, the
 * asset name, the USD value that actually landed, the number of tokens, how
 * many failed, and the SOL fee. We trust the server for these numbers because
 * it is the only place that touches Jupiter's routes, and the value of a dust
 * token changes between the scan and the swap, so reporting the job's *result*
 * is the only honest way to fill this row.
 *
 * `signatures` is a set, so we dedupe here too: a single transaction can carry
 * several swaps, and we report the same entry once, not once per swap.
 */
export function makeHistoryEntry(
  request: { outputAsset: OutputAsset; outputMint: string; tokens: { mint: string }[]; plan: { createdAt: number } },
  result: { totalOutput: number; totalOutputSymbol: string; totalValueUsd: number; tokenCount: number; successCount: number; failedCount: number; rentReclaimedLamports: number; feeLamports: number; signatures: string[]; dryRun: boolean },
): SweepHistoryEntry {
  if (result.dryRun || request.plan.createdAt === 0 || !request.outputAsset) {
    // A dry-run, partially-serialised, or otherwise unverifiable request
    // should never reach here. Return a well-formed but inert entry so that a
    // corrupted or hand-edited entry is filtered, never crashes the app, and
    // never goes on to corrupt the persisted array.
    return makeHistoryEntryFallback();
  }

  const id = request.plan.createdAt + "-" + result.signatures.join("|");
  const signatureList = [...new Set(result.signatures)];
  const mintList = request.tokens.map(function (t) { return t.mint; });

  return {
    id: id,
    createdAt: request.plan.createdAt,
    outputAsset: request.outputAsset,
    outputMint: request.outputMint,
    totalOutput: result.totalOutput,
    totalValueUsd: result.totalValueUsd,
    tokenCount: result.tokenCount,
    successCount: result.successCount,
    failedCount: result.failedCount,
    rentReclaimedLamports: result.rentReclaimedLamports,
    feeLamports: result.feeLamports,
    signatures: signatureList,
    mints: mintList,
  };
}

/** A well-formed entry that cannot be distinguished from a real one, used when
 * the caller passes a request that cannot be validated. */
function makeHistoryEntryFallback(): SweepHistoryEntry {
  return {
    id: "fallback",
    createdAt: Date.now(),
    outputAsset: "SOL",
    outputMint: "",
    totalOutput: 0,
    totalValueUsd: 0,
    tokenCount: 0,
    successCount: 0,
    failedCount: 0,
    rentReclaimedLamports: 0,
    feeLamports: 0,
    signatures: [],
    mints: [],
  };
}

/** Post-success tally update. Safe to call after every successful sweep.
 *
 * Both counters are updated in the same synchronous tick: a partial
 * update (wallets bumped but USD did not) would show a mismatch on a refresh
 * and look like a bug. Because both use useLocalStorage with the same
 * validator, a corrupt or hand-edited value falls back to 0 instead of
 * crashing or silently double-counting.
 */
export function applySweepTally(
  setWallets: (value: number | ((previous: number) => number)) => void,
  setUsd: (value: number | ((previous: number) => number)) => void,
  deltaWallets: number,
  deltaUsd: number,
): void {
  setWallets((previous) => previous + deltaWallets);
  setUsd((previous) => previous + deltaUsd);
}

// Re-export the existing history types so this module is the single import
// site for them (down from three).
export type { SweepHistoryEntry, SweepSummary, TokenOutcome, PlanResponse } from "@/types/sweep";
