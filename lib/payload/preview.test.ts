import { describe, expect, it } from "vitest";
import { previewFigures } from "./preview";
import type { PlanSendResult } from "./plan-send";

/**
 * The one mapping that decides what a Payload preview displays.
 *
 * It exists because the figures were previously written out by hand in two
 * places, and the second — the rebuild `execute` does when a blockhash ages out —
 * stored the new plan without updating them. The panel then described the old
 * plan's rent, fee and transaction count while the wallet was asked to sign a
 * different one.
 *
 * Every money field is given a distinct value here: a mapping that swapped two of
 * them would otherwise look correct.
 */

const result: PlanSendResult = {
  packed: [],
  simulations: [],
  warnings: [],
  blockhash: "11111111111111111111111111111111",
  lastValidBlockHeight: 1,
  estimatedFeeLamports: 5_000,
  outcomes: [],
  estimatedRentLamports: 11_111,
  estimatedFeeOnRentLamports: 22_222,
  estimatedRecipientAccountLamports: 33_333,
  estimatedNetLamports: 44_444,
  netIsNegative: true,
  hasFailures: false,
};

describe("previewFigures", () => {
  it("takes every figure from the plan it was given", () => {
    const figures = previewFigures(result);

    expect(figures.rentLamports).toBe(11_111);
    expect(figures.feeLamports).toBe(22_222);
    expect(figures.recipientAccountLamports).toBe(33_333);
    expect(figures.netLamports).toBe(44_444);
    expect(figures.networkFeeLamports).toBe(5_000);
    expect(figures.netIsNegative).toBe(true);
  });

  it("carries the plan's own arrays, not copies and not stale state", () => {
    const figures = previewFigures(result);

    // Identity matters: these are the bytes about to be signed, and a rebuild must
    // replace them rather than merge into whatever was on screen before.
    expect(figures.packed).toBe(result.packed);
    expect(figures.simulations).toBe(result.simulations);
    expect(figures.outcomes).toBe(result.outcomes);
    expect(figures.warnings).toBe(result.warnings);
  });
});
