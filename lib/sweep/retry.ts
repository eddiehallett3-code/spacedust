import type { DustToken } from "@/types/token";
import type { TokenOutcome } from "@/types/sweep";

/**
 * What is worth running again after a partial sweep.
 *
 * A reverted transaction moves nothing: the balances it would have swapped are
 * still in the wallet and the rent is still locked in their accounts. What
 * usually failed is the *timing* — a quote that moved between simulation and
 * landing, or a blockhash that expired while the wallet was waiting for a
 * signature — and both are fixed by building the same tokens again.
 *
 * **Only `failed` outcomes come back.** A token Jupiter declined to route never
 * became an outcome at all (it is a `plan.failures` entry, and the app points it
 * at The Void instead), so a retry cannot hand the planner a token it has already
 * refused. Likewise `skipped`, which the packer uses for a token that fit in no
 * transaction.
 *
 * Pure, and separate from the hook, because the interesting part is *which*
 * tokens come back: scan order is preserved so a retry looks like the run it
 * repeats, a partial amount survives, and a failure whose token is no longer in
 * the wallet is dropped rather than planned against a balance we no longer have.
 */
export interface RetryPlan {
  /** The tokens to plan again, in the order the scan lists them. */
  tokens: DustToken[];
  /** Only the retried mints' amounts. A missing entry still means "in full". */
  amounts: ReadonlyMap<string, string>;
}

export function planRetry({
  outcomes,
  tokens,
  amounts,
}: {
  outcomes: readonly TokenOutcome[];
  tokens: readonly DustToken[];
  amounts?: ReadonlyMap<string, string>;
}): RetryPlan | null {
  const failed = new Set(
    outcomes
      .filter((outcome) => outcome.status === "failed")
      .map((outcome) => outcome.mint),
  );
  if (failed.size === 0) return null;

  // Scan order, not outcome order: the retry is the same run with fewer tokens,
  // and the plan reads more coherently for it.
  const retryTokens = tokens.filter((token) => failed.has(token.mint));
  if (retryTokens.length === 0) return null;

  const retryAmounts = new Map<string, string>();
  for (const [mint, amount] of amounts ?? []) {
    if (failed.has(mint)) retryAmounts.set(mint, amount);
  }

  return { tokens: retryTokens, amounts: retryAmounts };
}
