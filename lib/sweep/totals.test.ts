import { describe, expect, it } from "vitest";
import { sumForMints } from "./totals";

/**
 * Summing per-account rent.
 *
 * The rule this replaced multiplied one figure by a count, which is only correct
 * while every account holds exactly the same deposit. These lock the two cases
 * where that assumption is false — and the one where a mint is missing entirely.
 */
describe("sumForMints", () => {
  it("adds each mint's own figure", () => {
    const byMint = new Map([
      ["a", 1_488_440],
      ["b", 2_039_280],
      ["c", 1_707_200],
    ]);

    expect(sumForMints(byMint, new Set(["a", "b", "c"]))).toBe(5_234_920);
  });

  it("counts only the mints it was asked for", () => {
    // A sweep that closed two of its three accounts reports two, not three.
    const byMint = new Map([
      ["a", 1_488_440],
      ["b", 1_488_440],
      ["c", 1_488_440],
    ]);

    expect(sumForMints(byMint, new Set(["a", "b"]))).toBe(2_976_880);
  });

  it("treats a mint with no reading as zero rather than NaN", () => {
    expect(sumForMints(new Map(), new Set(["a", "b"]))).toBe(0);
  });

  it("is zero for an empty set", () => {
    expect(sumForMints(new Map([["a", 999]]), new Set())).toBe(0);
  });
});
