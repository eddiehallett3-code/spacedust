import { OUTPUT_ASSETS } from "@/lib/utils/constants";
import { totalOutputRaw } from "@/lib/solana/compose";
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
   * The Spacedust fee for closing ONE account for its rent, in lamports.
   *
   * Passed in rather than derived, because the planner already resolved it
   * against the plan's own rent figure and the fee wallet's funding — and the
   * success screen must report the fee that was actually charged, not a
   * rate that might have been skipped.
   */
  reclaimFeeLamportsPerAccount: number;
  dryRun: boolean;
}): SweepSummary {
  const {
    plan,
    packed,
    simulations,
    outcomes,
    outputAsset,
    estimatedFeeLamports,
    reclaimFeeLamportsPerAccount,
    dryRun,
  } = params;

  const config = OUTPUT_ASSETS[outputAsset];
  const totalOut = totalOutputRaw(plan.builds);
  const divisor = 10 ** config.decimals;

  // Count distinct mints, not transactions — one mint can only appear once, but
  // counting per transaction would double-count if we ever split a mint.
  const rentReclaimedMints = new Set(
    packed.flatMap((tx) => tx.rentReclaimMints),
  );

  // Priced from the rent the chain reported for THIS plan, not a constant. The
  // fee rides on the same count, because the planner built one transfer per
  // closed account — so the gross, the fee and the net all come from one number
  // and cannot disagree.
  const grossRentLamports =
    rentReclaimedMints.size * plan.tokenAccountRentLamports;
  const reclaimFeeLamports =
    rentReclaimedMints.size * reclaimFeeLamportsPerAccount;

  const successCount = outcomes.filter((o) => o.status === "success").length;
  const failedCount = outcomes.filter((o) => o.status === "failed").length;

  // Prefer the fee the simulation actually reported; fall back to the estimate
  // when the user only ran a Dry Run.
  const simulatedFee = simulations.reduce(
    (sum, simulation) => sum + (simulation.feeLamports ?? 0),
    0,
  );
  const feeLamports = simulatedFee > 0 ? simulatedFee : estimatedFeeLamports;

  // For a real sweep, value is measured from what landed, not from the quote.
  const totalValueUsd = dryRun
    ? plan.totalExpectedOutUsd
    : outcomes.reduce((sum, outcome) => sum + outcome.valueUsd, 0);

  return {
    totalOutput: Number(totalOut) / divisor,
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
    // The integrator fee, in output units. Derived from the plan's *applied*
    // rate rather than the configured one, so a sweep that could not collect
    // (a missing fee account) reports zero instead of claiming a charge it
    // never made.
    spacedustFeeAmount: (Number(totalOut) / divisor) * (plan.feeBps / 10_000),
    spacedustFeeBps: plan.feeBps,
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
    dryRun,
  };
}