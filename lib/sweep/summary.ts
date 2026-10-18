import { OUTPUT_ASSETS } from "@/lib/utils/constants";
import { totalOutputRaw } from "@/lib/solana/compose";
import { sumForMints } from "@/lib/sweep/totals";
import type {
  OutputAsset,
  PackedTransaction,
  PlanResponse,
  SimulationOutcome,
  SweepSummary,
  TokenOutcome,
} from "@/types/sweep";

/**
 * Aggregate a sweep's numbers for the success screen.
 *
 * Every figure here is derived from what actually happened — confirmed
 * transaction results and the simulation's fee data — not from the optimistic
 * quote. Showing the quote would be more flattering and less honest.
 */
export function buildSummary(params: {
  plan: PlanResponse;
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  outcomes: TokenOutcome[];
  outputAsset: OutputAsset;
  estimatedFeeLamports: number;
  /**
   * The deposit each close returns, per mint, as the planner read it from the
   * chain.
   *
   * Per mint rather than one per-account figure: deposits differ, and the screen
   * has to report what the closes actually hand back. Passed in rather than
   * derived here for the same reason the fee always was — the planner already
   * resolved it, and the success screen must not invent a second opinion.
   */
  rentByMint: ReadonlyMap<string, number>;
  /** The Spacedust fee charged on each of those deposits, per mint. */
  feeByMint: ReadonlyMap<string, number>;
  dryRun: boolean;
}): SweepSummary {
  const {
    plan,
    packed,
    simulations,
    outcomes,
    outputAsset,
    estimatedFeeLamports,
    rentByMint,
    feeByMint,
    dryRun,
  } = params;

  const config = OUTPUT_ASSETS[outputAsset];
  const divisor = 10 ** config.decimals;

  // ── Which closes actually returned rent ───────────────────────────────────
  // A dry run has no outcomes, so it reports what the plan intends — that is what
  // "you would receive" means. A real sweep counts only the closes that landed:
  // a failed transaction closes nothing, and counting its mints (which this used
  // to) credited the user with rent the wallet never saw.
  //
  // Distinct mints, not transactions: one mint can only appear once, but counting
  // per transaction would double-count if a mint were ever split.
  const settledRentMints = dryRun
    ? new Set(packed.flatMap((tx) => tx.rentReclaimMints))
    : new Set(
        outcomes
          .filter(
            (outcome) => outcome.status === "success" && outcome.rentReclaimed,
          )
          .map((outcome) => outcome.mint),
      );

  // Summed from each account's own deposit. Multiplying one figure by a count was
  // what made this screen disagree with the chain on any account larger than a
  // 165-byte legacy one.
  const grossRentLamports = sumForMints(rentByMint, settledRentMints);
  const reclaimFeeLamports = sumForMints(feeByMint, settledRentMints);

  const landedOutcomes = outcomes.filter((o) => o.status === "success");
  const successCount = landedOutcomes.length;
  const failedCount = outcomes.filter((o) => o.status === "failed").length;

  // Prefer the fee the simulation actually reported; fall back to the estimate
  // when the user only ran a Dry Run.
  const simulatedFee = simulations.reduce(
    (sum, simulation) => sum + (simulation.feeLamports ?? 0),
    0,
  );
  const feeLamports = simulatedFee > 0 ? simulatedFee : estimatedFeeLamports;

  // ── What landed, not what was quoted ──────────────────────────────────────
  // A real run reports only the outcomes that succeeded. The quote describes
  // every build the server returned — including tokens that failed on chain and
  // units the packer dropped — so using it here made "You received" disagree
  // with the "N failed" line beside it, and wrote the overstated figure into the
  // local history. A dry run has no outcomes, so the plan's own intended totals
  // are exactly what "You would receive" means.
  const totalOutput = dryRun
    ? Number(totalOutputRaw(plan.builds)) / divisor
    : landedOutcomes.reduce(
        (sum, outcome) => sum + (outcome.outputAmountFormatted ?? 0),
        0,
      );

  // For a real sweep, value is measured from what landed, not from the quote.
  // The same rule as the output figure above: a failed swap recovered nothing.
  const totalValueUsd = dryRun
    ? plan.totalExpectedOutUsd
    : landedOutcomes.reduce((sum, outcome) => sum + outcome.valueUsd, 0);

  return {
    totalOutput,
    totalOutputSymbol: config.symbol,
    totalValueUsd,
    tokenCount: outcomes.length > 0 ? outcomes.length : plan.builds.length,
    successCount,
    failedCount,
    // What the user actually receives, not the gross rent: showing the pre-fee
    // figure would overstate every number on the success screen.
    rentReclaimedLamports: grossRentLamports - reclaimFeeLamports,
    reclaimFeeLamports,
    feeLamports,
    signatures: Array.from(
      new Set(
        outcomes
          .map((outcome) => outcome.signature)
          .filter((signature): signature is string => Boolean(signature)),
      ),
    ),
    routeLabels: Array.from(
      new Set(plan.builds.flatMap((build) => build.routeLabels)),
    ).slice(0, 8),
    // Every refusal the plan returned, verbatim. These never become outcomes —
    // there is no transaction to attribute them to — which is exactly why they
    // used to disappear from the screen that reports what happened.
    notSent: plan.failures.map((failure) => ({
      mint: failure.mint,
      symbol: failure.symbol,
      reason: failure.reason,
    })),
    dryRun,
  };
}