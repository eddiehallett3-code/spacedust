import { PRICE_BATCH_SIZE } from "@/lib/utils/constants";
import { runWithConcurrency } from "@/lib/utils/concurrency";

/** One mint's price, as the scan reports it. */
export interface MintPrice {
  usdPrice: number;
  priceChange24h: number | null;
}

/**
 * Price every mint in a wallet, in batches, on a small pool.
 *
 * The batching is not optional: Jupiter caps a price call at `PRICE_BATCH_SIZE`
 * ids, and a dust wallet can hold thousands. What *was* optional is doing them
 * one after another — 3,000 mints is sixty sequential HTTP calls, which measured
 * as most of a 49-second scan. Four lanes keep the same batch size and the same
 * politeness gap while cutting the wall time by roughly four.
 *
 * A failed batch is left unpriced rather than failing the scan: those holdings
 * fall back to the price the scanner already had, and the Smart Filter treats
 * them as it treats any unpriced token. Errors are not swallowed silently here —
 * the caller never sees them because a scan has no per-mint error surface, but
 * the consequence is bounded and deliberate.
 */
export async function priceAllMints(
  mints: readonly string[],
  fetchBatch: (batch: string[]) => Promise<Record<string, MintPrice>>,
  options: { concurrency?: number; gapMs?: number } = {},
): Promise<Record<string, MintPrice>> {
  // DAS can repeat a mint across page boundaries, and paying twice for the same
  // price is the one waste this function can still avoid.
  const unique = Array.from(new Set(mints));
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += PRICE_BATCH_SIZE) {
    batches.push(unique.slice(i, i + PRICE_BATCH_SIZE));
  }

  const results = await runWithConcurrency(batches, fetchBatch, {
    concurrency: 4,
    gapMs: 40,
    ...options,
  });

  const prices: Record<string, MintPrice> = {};
  for (const entry of results) {
    if (!entry.result) continue;
    Object.assign(prices, entry.result);
  }
  return prices;
}
