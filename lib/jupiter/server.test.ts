import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPrices } from "./server";

/**
 * The price cache is the only thing standing between a busy wallet and one
 * Jupiter request per fifty mints on every scan.
 *
 * It used to miss completely whenever a batch held a single unpriceable mint:
 * `readPriceCache` returned null unless *every* requested mint was cached, and
 * absent mints were never stored at all (despite the comment saying they were).
 * Jupiter omits tokens it cannot price, which is the common case in a dust
 * wallet, so the cache was effectively dead.
 *
 * These also lock two smaller promises: a partial hit fetches only what is
 * missing, and a caller with more than fifty mints is chunked rather than having
 * the tail silently dropped.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A price body for whichever requested ids the answer function allows. */
function stubPricing(
  answer: (ids: string[]) => Record<string, unknown>,
): string[][] {
  const calls: string[][] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
      calls.push(ids);
      return new Response(JSON.stringify(answer(ids)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}

function priced(): Record<string, unknown> {
  return { usdPrice: 2, decimals: 6, blockId: 1, priceChange24h: 0 };
}

describe("fetchPrices cache", () => {
  it("fetches only the mints it does not already have", async () => {
    const [a, b, c] = ["cache-hit-a", "cache-hit-b", "cache-hit-c"];
    const calls = stubPricing((ids) =>
      Object.fromEntries(ids.map((id) => [id, priced()])),
    );

    const first = await fetchPrices([a, b]);
    expect(Object.keys(first).sort()).toEqual([a, b]);
    expect(calls).toHaveLength(1);

    // A and B are fresh; only C should be asked for.
    const second = await fetchPrices([a, b, c]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual([c]);
    expect(Object.keys(second).sort()).toEqual([a, b, c]);

    // And now all three are a pure cache hit.
    await fetchPrices([a, b, c]);
    expect(calls).toHaveLength(2);
  });

  it("remembers a mint Jupiter could not price, instead of refetching the batch", async () => {
    const [pricedMint, unpricedMint] = ["unpriced-a", "unpriced-b"];
    const calls = stubPricing((ids) =>
      Object.fromEntries(
        ids.filter((id) => id === pricedMint).map((id) => [id, priced()]),
      ),
    );

    const first = await fetchPrices([pricedMint, unpricedMint]);
    expect(Object.keys(first)).toEqual([pricedMint]);

    const again = await fetchPrices([pricedMint, unpricedMint]);
    expect(calls).toHaveLength(1);
    expect(Object.keys(again)).toEqual([pricedMint]);
  });

  it("chunks a request larger than Jupiter's per-call limit instead of truncating", async () => {
    const ids = Array.from({ length: 120 }, (_, index) => `chunk-mint-${index}`);
    const calls = stubPricing((batch) =>
      Object.fromEntries(batch.map((id) => [id, priced()])),
    );

    const prices = await fetchPrices(ids);

    expect(calls.map((batch) => batch.length)).toEqual([50, 50, 20]);
    expect(Object.keys(prices)).toHaveLength(120);
  });
});
