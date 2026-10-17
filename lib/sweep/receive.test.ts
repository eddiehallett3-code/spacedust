import { describe, expect, it } from "vitest";
import { receiveFigures } from "./receive";

/**
 * The largest number on the Slingshot panel.
 *
 * Two rules, and both are about not promising money that arrives differently:
 *
 *  - rent joins the headline only when the payout is SOL, because rent is always
 *    SOL and adding it to a USDC figure would be adding dollars to euros;
 *  - nothing is subtracted for a swap fee, because there is no swap fee any more.
 *    The only fee left is the 1.5% on reclaimed rent, and the caller passes rent
 *    already net of it.
 */
describe("receiveFigures", () => {
  it("adds net rent to the headline when the payout is SOL", () => {
    const figures = receiveFigures({
      expectedOutput: 1,
      rentLamports: 3_000_000, // 0.003 SOL, already net of the 1.5%
      outputAsset: "SOL",
    });

    expect(figures.swapOutput).toBe(1);
    expect(figures.netRentSol).toBeCloseTo(0.003, 9);
    expect(figures.headline).toBeCloseTo(1.003, 9);
  });

  it("keeps rent out of a non-SOL headline", () => {
    const figures = receiveFigures({
      expectedOutput: 12.5,
      rentLamports: 3_000_000,
      outputAsset: "USDC",
    });

    expect(figures.headline).toBe(12.5);
    // Still reported, just on its own line.
    expect(figures.netRentSol).toBeCloseTo(0.003, 9);
  });

  it("takes nothing off the swap output", () => {
    // The number the user signs for is the number they see. A subtraction here
    // would be a fee the app no longer charges.
    const figures = receiveFigures({
      expectedOutput: 99.5,
      rentLamports: 0,
      outputAsset: "SOL",
    });

    expect(figures.swapOutput).toBe(99.5);
    expect(figures.headline).toBe(99.5);
  });

  it("is zero when there is nothing to receive", () => {
    const figures = receiveFigures({
      expectedOutput: 0,
      rentLamports: 0,
      outputAsset: "SOL",
    });

    expect(figures.headline).toBe(0);
  });
});
