import { describe, expect, it } from "vitest";
import { buildSummary } from "@/lib/sweep/summary";
import type {
  PackedTransaction,
  PlanResponse,
  SwapBuild,
  TokenOutcome,
} from "@/types/sweep";

/**
 * Two numbers on the success screen were wrong in the same direction, and both
 * came from reading a constant instead of the plan:
 *
 *  - rent reclaimed was inflated ~37%, because the token-account rent was
 *    assumed rather than fetched;
 *  - the integrator fee was reported from the configured rate rather than the
 *    one actually applied, so a sweep that collected nothing still claimed a
 *    charge.
 */

function build(overrides: Partial<PlanResponse> = {}): PlanResponse {
  return {
    builds: [] as SwapBuild[],
    failures: [],
    totalInValueUsd: 0,
    totalExpectedOutUsd: 0,
    estimatedRentReclaimLamports: 0,
    tokenAccountRentLamports: 1_488_440,
    feeBps: 0,
    feeAccount: null,
    warnings: [],
    estimatedFeeLamports: 5_000,
    createdAt: 0,
    ...overrides,
  };
}

function closedTx(mint: string): PackedTransaction {
  return {
    index: 0,
    base64: "",
    mints: [mint],
    sizeBytes: 0,
    instructionCount: 0,
    includesRentReclaim: true,
    rentReclaimMints: [mint],
  };
}

const noOutcomes: TokenOutcome[] = [];

describe("buildSummary rent", () => {
  it("prices reclaimed rent from the plan's fetched value", () => {
    const summary = buildSummary({
      plan: build(),
      packed: [closedTx("A"), closedTx("B")],
      simulations: [],
      outcomes: noOutcomes,
      outputAsset: "SOL",
      estimatedFeeLamports: 5_000,
      dryRun: false,
    });

    expect(summary.rentReclaimedLamports).toBe(2 * 1_488_440);
    // And specifically not the stale constant this used to hardcode.
    expect(summary.rentReclaimedLamports).not.toBe(2 * 2_039_280);
  });

  it("tracks a changed rent rather than pinning one", () => {
    const summary = buildSummary({
      plan: build({ tokenAccountRentLamports: 3_000_000 }),
      packed: [closedTx("A")],
      simulations: [],
      outcomes: noOutcomes,
      outputAsset: "SOL",
      estimatedFeeLamports: 5_000,
      dryRun: false,
    });

    expect(summary.rentReclaimedLamports).toBe(3_000_000);
  });

  it("counts distinct mints, so a repeated close cannot double-count", () => {
    const summary = buildSummary({
      plan: build(),
      packed: [closedTx("A"), closedTx("A")],
      simulations: [],
      outcomes: noOutcomes,
      outputAsset: "SOL",
      estimatedFeeLamports: 5_000,
      dryRun: false,
    });

    expect(summary.rentReclaimedLamports).toBe(1_488_440);
  });
});

describe("buildSummary fee", () => {
  it("reports the fee that was actually applied, not the configured rate", () => {
    // feeBps 0 means the fee account was missing, so nothing was collected —
    // the screen must not claim otherwise.
    const summary = buildSummary({
      plan: build({ feeBps: 0 }),
      packed: [closedTx("A")],
      simulations: [],
      outcomes: noOutcomes,
      outputAsset: "SOL",
      estimatedFeeLamports: 5_000,
      dryRun: false,
    });

    expect(summary.spacedustFeeBps).toBe(0);
    expect(summary.spacedustFeeAmount).toBe(0);
  });

  it("reports 0.5% of the output when the fee did apply", () => {
    const swap: SwapBuild = {
      mint: "A",
      symbol: "A",
      logoUri: null,
      inAmount: "1000",
      tokenAccount: null,
      outAmount: "1000000000", // 1 SOL at 9 decimals
      otherAmountThreshold: "0",
      outputMint: "So11111111111111111111111111111111111111112",
      priceImpactPct: null,
      routeLabels: [],
      computeBudgetInstructions: [],
      bundle: {} as SwapBuild["bundle"],
      addressesByLookupTableAddress: null,
      lastValidBlockHeight: 0,
      error: null,
    };

    const summary = buildSummary({
      plan: build({ builds: [swap], feeBps: 50 }),
      packed: [closedTx("A")],
      simulations: [],
      outcomes: noOutcomes,
      outputAsset: "SOL",
      estimatedFeeLamports: 5_000,
      dryRun: false,
    });

    expect(summary.spacedustFeeBps).toBe(50);
    expect(summary.spacedustFeeAmount).toBeCloseTo(0.005, 9);
  });
});
