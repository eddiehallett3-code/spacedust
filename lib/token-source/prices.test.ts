import { describe, expect, it } from "vitest";
import { PRICE_BATCH_SIZE } from "@/lib/utils/constants";
import { priceAllMints } from "./prices";

/**
 * Pricing a whole wallet without losing or double-paying for a mint.
 *
 * The batching moved from a sequential loop to a lane pool, so the property worth
 * pinning is coverage: every mint is requested **exactly once**, no batch exceeds
 * Jupiter's cap, and a failed batch costs only its own mints. The old loop got
 * that right and was slow; a careless parallel version would be fast and wrong.
 */

const priceOfEveryMint = (batch: string[]): Record<string, { usdPrice: number; priceChange24h: number }> =>
  Object.fromEntries(batch.map((mint) => [mint, { usdPrice: 1, priceChange24h: 0 }]));

describe("priceAllMints", () => {
  it("prices every mint exactly once, in batches no larger than the cap", async () => {
    const calls: string[][] = [];
    const mints = Array.from({ length: 205 }, (_, index) => `mint-${index}`);

    const prices = await priceAllMints(mints, async (batch) => {
      calls.push([...batch]);
      return priceOfEveryMint(batch);
    });

    const requested = calls.flat();
    expect(requested).toHaveLength(205);
    expect(new Set(requested).size).toBe(205);
    expect(Object.keys(prices)).toHaveLength(205);
    expect(Math.max(...calls.map((batch) => batch.length))).toBeLessThanOrEqual(
      PRICE_BATCH_SIZE,
    );
  });

  it("asks once for a mint that appears twice", async () => {
    // DAS repeats mints across page boundaries; paying twice is pure waste.
    const calls: string[][] = [];
    await priceAllMints(["A", "A", "B"], async (batch) => {
      calls.push([...batch]);
      return priceOfEveryMint(batch);
    });

    expect(calls.flat().sort()).toEqual(["A", "B"]);
  });

  it("leaves a failed batch unpriced without losing the others", async () => {
    const mints = Array.from({ length: 120 }, (_, index) => `mint-${index}`);

    const prices = await priceAllMints(mints, async (batch) => {
      // Fail whichever batch contains the first mint, so the assertion is not
      // dependent on lane scheduling.
      if (batch.includes("mint-0")) throw new Error("429");
      return priceOfEveryMint(batch);
    });

    expect(prices["mint-0"]).toBeUndefined();
    expect(prices["mint-119"]).toBeDefined();
  });

  it("returns nothing for an empty wallet", async () => {
    await expect(priceAllMints([], async () => ({}))).resolves.toEqual({});
  });
});
