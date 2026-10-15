/**
 * How many tokens to offer The Void for, after a real sweep.
 *
 * "Left behind" has to mean left behind **by this sweep**. The first version of
 * this counted every unroutable token in the wallet, which produced the message
 * "1 token the sweeper left behind" after a sweep where nothing had been left
 * behind at all — the token in question merely had no price and was never part
 * of the selection. Accurate wording on a false trigger is still a false
 * message, and it reads as a failure report on a clean sweep.
 *
 * So a token now qualifies only if the sweep actually attempted it and did not
 * land it:
 *
 *   - it is unroutable — no price, or Jupiter refused a route — because a
 *     token that *could* be sold must never be nudged toward a burn that
 *     destroys value, and
 *   - its outcome is not "success" — it was in the batch and did not make it.
 *
 * Intersecting the two keeps the card's copy honest. A token that failed for a
 * transient reason but is still routable belongs in the per-token failure list,
 * where "try again" is the right advice rather than "burn it".
 */
export function countTokensLeftBehind(input: {
  /** Null until a sweep has finished. */
  summary: { dryRun: boolean } | null;
  /** Mints with no price, or that Jupiter refused to route. */
  unroutableMints: readonly string[];
  /** Per-token results of the sweep — only the tokens it attempted. */
  outcomes: readonly {
    mint: string;
    status: "success" | "failed" | "skipped";
  }[];
}): number {
  const { summary, unroutableMints, outcomes } = input;
  if (!summary || summary.dryRun) return 0;

  const leftBehind = new Set(
    outcomes
      .filter((outcome) => outcome.status !== "success")
      .map((outcome) => outcome.mint),
  );
  return unroutableMints.filter((mint) => leftBehind.has(mint)).length;
}
