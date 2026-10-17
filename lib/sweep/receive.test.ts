import { describe, expect, it } from "vitest";
import { receiveFigures } from "./receive";

/**
 * The headline on the Slingshot panel.
 *
 * Worth pinning because it is now the biggest number on the screen and two of
 * its three inputs are easy to get wrong: the fee comes *out* of the swap's own
 * output, and rent is SOL whether or not the sweep was into SOL.
 */

describe("receiveFigures", () => {
  it("takes the swap fee out of the swap output", () => {
    const figures = receiveFigures({
      expectedOutput: 100,
      feeBps: 50,
      rentLamports: 0,
      outputAsset: "SOL",
    });

    // 0.5% of 100 is 0.5, and the user never sees it.
    expect(figures.netSwapOutput).toBeCloseTo(99.5, 9);
  });

  it("adds rent to the headline when the output asset is SOL", () => {
    const figures = receiveFigures({
      expectedOutput: 1,
      feeBps: 0,
      rentLamports: 4_410_000, // three accounts, net of a 1.5% fee
      outputAsset: "SOL",
    });

    expect(figures.netRentSol).toBeCloseTo(0.00441, 9);
    expect(figures.headline).toBeCloseTo(1.00441, 9);
  });

  it("keeps rent out of a USDC headline, but still reports it", () => {
    const figures = receiveFigures({
      expectedOutput: 12.5,
      feeBps: 50,
      rentLamports: 4_410_000,
      outputAsset: "USDC",
    });

    // The swaps are USDC; rent is SOL. Adding them would be a number in no unit.
    expect(figures.headline).toBeCloseTo(12.4375, 9);
    expect(figures.netRentSol).toBeCloseTo(0.00441, 9);
  });

  it("leaves the figure alone when fees are off", () => {
    const figures = receiveFigures({
      expectedOutput: 7,
      feeBps: 0,
      rentLamports: 0,
      outputAsset: "JUP",
    });

    expect(figures.netSwapOutput).toBe(7);
    expect(figures.headline).toBe(7);
  });

  it("is zero rather than NaN before a plan exists", () => {
    const figures = receiveFigures({
      expectedOutput: 0,
      feeBps: 0,
      rentLamports: 0,
      outputAsset: "SOL",
    });

    expect(figures.headline).toBe(0);
    expect(Number.isNaN(figures.headline)).toBe(false);
  });
});
