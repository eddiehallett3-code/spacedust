import { describe, expect, it } from "vitest";
import { buildSummary } from "@/lib/sweep/summary";
import type {
  PackedTransaction,
  PlanResponse,
  SwapBuild,
  TokenOutcome,
} from "@/types/sweep";

/**
 * The success screen's rent lines.
 *
 * Two numbers were wrong in the same direction, and both came from asserting
 * something about a batch instead of reading what happened:
 *
 *  - rent was one per-account figure multiplied by a count, which understates any
 *    account funded before the network's rent change (or larger than 165 bytes);
 *  - it counted every mint in a **packed** transaction, including transactions
 *    that failed — so a partial sweep reported rent the wallet never saw.
 *
 * Every figure here is now summed from each close's own deposit, and only from
 * closes that landed.
 */

const RENT = 1_488_440;
const OLD_RATE_RENT = 2_039_280;

function build(overrides: Partial<PlanResponse> = {}): PlanResponse {
  return {
    builds: [] as SwapBuild[],
    failures: [],
    totalInValueUsd: 0,
    totalExpectedOutUsd: 0,
    estimatedRentReclaimLamports: 0,
    tokenAccountRentLamports: RENT,
    emptyAccountRentLamports: 650_240,
    warnings: [],
    estimatedFeeLamports: 5_000,
    createdAt: 0,
    ...overrides,
  };
}

function closedTx(mint: string, index = 0): PackedTransaction {
  return {
    index,
    base64: "",
    mints: [mint],
    sizeBytes: 0,
    instructionCount: 0,
    includesRentReclaim: true,
    rentReclaimMints: [mint],
  };
}

/** The only part of a build `buildSummary` reads: its quoted output. */
function quotedBuild(mint: string, outAmount: string): SwapBuild {
  return {
    mint,
    symbol: mint,
    logoUri: null,
    inAmount: "1",
    tokenAccount: null,
    outAmount,
    otherAmountThreshold: "0",
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    priceImpactPct: null,
    routeLabels: [],
    computeBudgetInstructions: [],
    bundle: {
      setup: [],
      swap: {
        programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
        accounts: [],
        data: "",
      },
      cleanup: null,
      other: [],
    },
    addressesByLookupTableAddress: null,
    lastValidBlockHeight: 0,
    error: null,
  };
}

function outcome(
  mint: string,
  status: TokenOutcome["status"],
  rentReclaimed: boolean,
): TokenOutcome {
  return {
    mint,
    symbol: mint,
    logoUri: null,
    status,
    signature: status === "success" ? "sig" : null,
    valueUsd: 1,
    inputAmount: "1",
    outputAmount: status === "success" ? "1" : null,
    outputAmountFormatted: status === "success" ? 1 : null,
    priceImpactPct: null,
    routeLabels: [],
    error: status === "failed" ? "failed" : null,
    rentReclaimed,
  };
}

const summaryFor = (
  overrides: Partial<Parameters<typeof buildSummary>[0]> = {},
): ReturnType<typeof buildSummary> =>
  buildSummary({
    plan: build(),
    packed: [],
    simulations: [],
    outcomes: [],
    outputAsset: "SOL",
    estimatedFeeLamports: 5_000,
    rentByMint: new Map(),
    feeByMint: new Map(),
    dryRun: false,
    ...overrides,
  });

describe("buildSummary rent", () => {
  it("sums each account's own deposit", () => {
    // The whole point of the change: a fresh account and one funded at the old
    // rate hold different deposits, and the screen has to total them.
    const summary = summaryFor({
      packed: [closedTx("A"), closedTx("B")],
      outcomes: [outcome("A", "success", true), outcome("B", "success", true)],
      rentByMint: new Map([
        ["A", RENT],
        ["B", OLD_RATE_RENT],
      ]),
    });

    expect(summary.rentReclaimedLamports).toBe(RENT + OLD_RATE_RENT);
  });

  it("counts only the closes that landed", () => {
    // A failed transaction closes nothing. This used to read the *packed* mints,
    // so a partial sweep credited the user with rent that never arrived.
    const summary = summaryFor({
      packed: [closedTx("A"), closedTx("B")],
      outcomes: [outcome("A", "success", true), outcome("B", "failed", false)],
      rentByMint: new Map([
        ["A", RENT],
        ["B", RENT],
      ]),
    });

    expect(summary.rentReclaimedLamports).toBe(RENT);
  });

  it("ignores a success whose account was not closed", () => {
    // A partial sale empties nothing, so there is no close and no rent.
    const summary = summaryFor({
      packed: [closedTx("A")],
      outcomes: [outcome("A", "success", false)],
      rentByMint: new Map([["A", RENT]]),
    });

    expect(summary.rentReclaimedLamports).toBe(0);
  });

  it("counts a mint once even if two transactions close it", () => {
    const summary = summaryFor({
      packed: [closedTx("A", 0), closedTx("A", 1)],
      dryRun: true,
      rentByMint: new Map([["A", RENT]]),
    });

    expect(summary.rentReclaimedLamports).toBe(RENT);
  });

  it("reports the plan's estimate on a dry run", () => {
    // Nothing was signed, so "you would receive" is what the plan intends.
    const summary = summaryFor({
      packed: [closedTx("A"), closedTx("B")],
      dryRun: true,
      rentByMint: new Map([
        ["A", RENT],
        ["B", RENT],
      ]),
    });

    expect(summary.rentReclaimedLamports).toBe(2 * RENT);
  });

  it("treats a mint with no reading as zero, not NaN", () => {
    const summary = summaryFor({
      packed: [closedTx("A")],
      outcomes: [outcome("A", "success", true)],
    });

    expect(summary.rentReclaimedLamports).toBe(0);
  });
});

describe("buildSummary reclaim fee", () => {
  it("reports rent net of each account's fee, and the fee itself", () => {
    const summary = summaryFor({
      packed: [closedTx("A"), closedTx("B")],
      outcomes: [outcome("A", "success", true), outcome("B", "success", true)],
      rentByMint: new Map([
        ["A", RENT],
        ["B", OLD_RATE_RENT],
      ]),
      feeByMint: new Map([
        ["A", 22_326],
        ["B", 30_589],
      ]),
    });

    expect(summary.reclaimFeeLamports).toBe(22_326 + 30_589);
    expect(summary.rentReclaimedLamports).toBe(RENT + OLD_RATE_RENT - 52_915);
  });

  it("charges nothing when the planner charged nothing", () => {
    const summary = summaryFor({
      packed: [closedTx("A")],
      outcomes: [outcome("A", "success", true)],
      rentByMint: new Map([["A", RENT]]),
    });

    expect(summary.reclaimFeeLamports).toBe(0);
    expect(summary.rentReclaimedLamports).toBe(RENT);
  });
});

describe("buildSummary — what actually landed", () => {
  const usdcPlan = build({
    builds: [
      quotedBuild("A", "1000000"), // 1 USDC at 6 decimals
      quotedBuild("B", "5000000"), // 5 USDC, never sold
    ],
    totalExpectedOutUsd: 6,
  });

  it("reports successful output, not the quote, when part of the batch failed", () => {
    // This is the bug the screen shipped with: "You received" was the sum of the
    // plan's quotes, so a batch that said "1 succeeded, 1 failed" beside it still
    // claimed the failed token's output — and wrote the same overstatement into
    // the local history.
    const summary = summaryFor({
      plan: usdcPlan,
      outputAsset: "USDC",
      outcomes: [
        {
          ...outcome("A", "success", false),
          outputAmount: "1000000",
          outputAmountFormatted: 1,
          valueUsd: 1,
        },
        {
          ...outcome("B", "failed", false),
          outputAmount: null,
          outputAmountFormatted: null,
          valueUsd: 1,
          error: "Not submitted",
        },
      ],
    });

    expect(summary.totalOutput).toBe(1); // not 6
    expect(summary.totalValueUsd).toBe(1); // the failed token recovered nothing
    expect(summary.successCount).toBe(1);
    expect(summary.failedCount).toBe(1);
  });

  it("excludes a skipped outcome from both totals as well", () => {
    const summary = summaryFor({
      plan: usdcPlan,
      outputAsset: "USDC",
      outcomes: [
        {
          ...outcome("A", "success", false),
          outputAmount: "1000000",
          outputAmountFormatted: 1,
          valueUsd: 1,
        },
        {
          ...outcome("B", "skipped", false),
          valueUsd: 1,
        },
      ],
    });

    expect(summary.totalOutput).toBe(1);
    expect(summary.totalValueUsd).toBe(1);
  });

  it("keeps the plan's intended totals on a dry run, where there are no outcomes", () => {
    const summary = summaryFor({
      plan: usdcPlan,
      outputAsset: "USDC",
      dryRun: true,
    });

    expect(summary.totalOutput).toBe(6);
    expect(summary.totalValueUsd).toBe(6);
  });
});

describe("buildSummary — tokens that were never sent", () => {
  it("lists every refusal the planner returned, with its reason", () => {
    // These never become outcomes — there is no transaction to attribute them to
    // — which is why they used to vanish from the screen that reports what
    // happened, leaving "2 failed" with no cause.
    const summary = summaryFor({
      plan: build({
        failures: [
          {
            mint: "APES",
            symbol: "APES",
            reason: 'Jupiter responded 400: {"error":"No routes found"}',
          },
          {
            mint: "BAD",
            symbol: "BAD",
            reason: "Held in a non-standard token account, which a swap cannot drain",
          },
        ],
      }),
    });

    expect(summary.notSent).toEqual([
      {
        mint: "APES",
        symbol: "APES",
        reason: 'Jupiter responded 400: {"error":"No routes found"}',
      },
      {
        mint: "BAD",
        symbol: "BAD",
        reason: "Held in a non-standard token account, which a swap cannot drain",
      },
    ]);
  });

  it("has nothing to report when every token was built", () => {
    expect(summaryFor({}).notSent).toEqual([]);
  });
});
