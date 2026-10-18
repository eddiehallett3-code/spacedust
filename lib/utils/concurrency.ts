/**
 * A small lane pool, with results in the order the work was given.
 *
 * Two shapes of this problem already exist in the app, and they pull in opposite
 * directions. `Promise.all` over hundreds of requests is how a free-tier API key
 * gets rate-limited; a plain `for` loop is how a wallet scan takes 49 seconds
 * because it prices three thousand mints fifty at a time, one after another.
 * Lanes are the middle: at most `concurrency` items in flight, and a lane that
 * finishes takes the next unclaimed item rather than waiting for its neighbours.
 *
 * Failures are captured **per item**, never thrown out of the pool. Callers
 * decide whether an error is fatal (a swap that could not be quoted is reported
 * on its row) or benign (a price batch that fails leaves those tokens unpriced
 * instead of failing the scan). The alternative — aborting the pool on the first
 * rejection — throws away every result that did succeed.
 */

export interface LaneResult<T, R> {
  item: T;
  result?: R;
  error?: string;
}

export async function runWithConcurrency<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  options: { concurrency?: number; gapMs?: number } = {},
): Promise<Array<LaneResult<T, R>>> {
  const { concurrency = 4, gapMs = 0 } = options;
  const results: Array<LaneResult<T, R>> = new Array(items.length);
  let cursor = 0;

  async function runLane(): Promise<void> {
    while (cursor < items.length) {
      // Claimed synchronously, before the first `await`, so two lanes can never
      // take the same index — JS runs this block to completion.
      const index = cursor;
      cursor += 1;

      const item = items[index];
      if (item === undefined) continue;

      try {
        results[index] = { item, result: await worker(item, index) };
      } catch (error) {
        results[index] = {
          item,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }

      if (gapMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, gapMs));
      }
    }
  }

  // At least one lane, and never more lanes than there is work: an empty list
  // returns immediately, and a one-item list does not spin up four idle lanes.
  const laneCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: laneCount }, () => runLane()));

  return results;
}
