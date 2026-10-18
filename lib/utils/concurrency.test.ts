import { describe, expect, it } from "vitest";
import { runWithConcurrency } from "./concurrency";

/**
 * The pool that replaced two sequential loops.
 *
 * Three properties matter, and each one has a failure that is invisible in
 * production until it is expensive: work being done twice (wasted quota), work
 * being skipped (a token silently unpriced), and the limit being exceeded (a
 * 429 that looks like an outage).
 */
describe("runWithConcurrency", () => {
  it("does every piece of work exactly once, in order", async () => {
    const seen: number[] = [];
    const results = await runWithConcurrency(
      [5, 1, 4, 2, 3],
      async (item) => {
        seen.push(item);
        return item * 10;
      },
      { concurrency: 2 },
    );

    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    // Results line up with the input, not with completion order.
    expect(results.map((entry) => entry.result)).toEqual([50, 10, 40, 20, 30]);
  });

  it("never puts more than the limit in flight", async () => {
    let inFlight = 0;
    let peak = 0;

    await runWithConcurrency(
      Array.from({ length: 20 }, (_, index) => index),
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
      },
      { concurrency: 3 },
    );

    expect(peak).toBe(3);
    expect(inFlight).toBe(0);
  });

  it("captures a failure without abandoning the rest", async () => {
    const results = await runWithConcurrency(
      ["ok", "boom", "ok2"],
      async (item) => {
        if (item === "boom") throw new Error("upstream said no");
        return item.toUpperCase();
      },
      { concurrency: 2 },
    );

    expect(results[0]?.result).toBe("OK");
    expect(results[1]?.error).toBe("upstream said no");
    expect(results[2]?.result).toBe("OK2");
  });

  it("names a non-Error rejection rather than losing it", async () => {
    const [entry] = await runWithConcurrency([1], async () => {
      throw "a string";
    });

    expect(entry?.error).toBe("Unknown error");
  });

  it("returns immediately for an empty list", async () => {
    await expect(runWithConcurrency([], async () => 1)).resolves.toEqual([]);
  });

  it("runs a single item on a single lane", async () => {
    const results = await runWithConcurrency([7], async (item) => item, {
      concurrency: 4,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.result).toBe(7);
  });
});
