import { describe, expect, it } from "vitest";
import { deleteComputeBudget } from "./plan-delete";

/**
 * The one piece of the delete planner that needs no chain.
 *
 * Worth asserting because of how it was measured: a real SNS delete simulates at
 * **1,801 CU**, so a budget sized like a swap's would overpay for headroom nobody
 * uses — and the priority fee is billed on the budget that is *requested*, not the
 * units that get consumed. That lesson cost a revoke 600,000 CU of budget once.
 */
describe("deleteComputeBudget", () => {
  it("floors a single delete rather than asking for the measured 1,801", () => {
    expect(deleteComputeBudget(1)).toBe(50_000);
  });

  it("keeps the floor while a batch is still small", () => {
    // 8 × 5,000 = 40,000, which is below the floor — a delete is cheap enough that
    // the floor, not the count, is what matters until the batch is large.
    expect(deleteComputeBudget(8)).toBe(50_000);
  });

  it("scales once the count gets past the floor", () => {
    expect(deleteComputeBudget(20)).toBe(100_000);
    expect(deleteComputeBudget(60)).toBe(300_000);
  });

  it("still stays below the sweep's fixed budget for any sane batch", () => {
    expect(deleteComputeBudget(100)).toBeLessThan(800_000);
  });

  it("never exceeds Solana's own ceiling", () => {
    expect(deleteComputeBudget(100_000)).toBe(1_400_000);
  });

  it("answers sanely for zero, which is what an empty selection looks like", () => {
    expect(deleteComputeBudget(0)).toBe(50_000);
  });
});
