import "server-only";

import type {
  JupiterBuildResponse,
  JupiterPriceEntry,
} from "@/types/jupiter";
import {
  getJupiterApiKey,
  JUPITER_PRICE_BASE,
  JUPITER_SWAP_BASE,
} from "@/lib/config/env";
import { UpstreamError } from "@/lib/utils/errors";
import { runWithConcurrency } from "@/lib/utils/concurrency";
import { PRICE_BATCH_SIZE } from "@/lib/utils/constants";

/**
 * Server-side Jupiter client.
 *
 * Two reasons this lives on the server rather than in the browser:
 *  1. Your Jupiter API key is never exposed, even a free one.
 *  2. `api.jup.ag` does not send permissive CORS headers for every route, so a
 *     browser-only integration fails intermittently. Proxying removes that
 *     entire class of bug.
 *
 * Importing this from a Client Component is a build error by design: it reads
 * `process.env` values that are not `NEXT_PUBLIC_`, so the values would be
 * `undefined` in the browser bundle anyway.
 */

const REQUEST_TIMEOUT_MS = 20_000;

function requestHeaders(): Record<string, string> {
  const base: Record<string, string> = { Accept: "application/json" };
  const apiKey = getJupiterApiKey();
  // Keyless access is allowed; without a key Jupiter rate-limits hard, which is
  // why buildSwapsSerial below also paces its requests.
  if (apiKey) base["x-api-key"] = apiKey;
  return base;
}

async function jupiterFetch<T>(url: string, attempt = 0): Promise<T> {
  const MAX_ATTEMPTS = 3;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: requestHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "timed out"
        : error instanceof Error
          ? error.message
          : "network error";
    throw new UpstreamError(`Jupiter ${reason}`, "jupiter");
  }

  // Keyless Jupiter is rate-limited aggressively, and a busy wallet scan issues
  // several price batches back to back. Retry with backoff before giving up —
  // this is the difference between a working app and a random 502.
  if (response.status === 429 && attempt < MAX_ATTEMPTS - 1) {
    await new Promise((resolve) =>
      setTimeout(resolve, 400 * 2 ** attempt + Math.random() * 250),
    );
    return jupiterFetch<T>(url, attempt + 1);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new UpstreamError(
      `Jupiter responded ${response.status}: ${text.slice(0, 200) || response.statusText}`,
      "jupiter",
      response.status,
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new UpstreamError("Jupiter returned malformed JSON", "jupiter");
  }
}

// ── Price API v3 ────────────────────────────────────────────────────────────

/**
 * Fetch USD prices for these mints, in Jupiter-sized batches.
 *
 * Jupiter deliberately *omits* mints it cannot price rather than returning
 * `null`, so callers must treat "absent from the result" as "no reliable
 * price" — that is exactly how our Smart Filter decides what to hide.
 *
 * Results are cached briefly in memory. A wallet with thousands of dust mints
 * needs dozens of batches, and users rescan constantly while adjusting the
 * threshold — this removes most repeat traffic. A missing price is remembered
 * separately (and for longer), because one unpriceable token must not turn a
 * whole batch into a refetch.
 */
export async function fetchPrices(
  mints: string[],
): Promise<Record<string, JupiterPriceEntry>> {
  if (mints.length === 0) return {};

  // De-duplicate defensively; DAS can repeat a mint across page boundaries.
  const unique = Array.from(new Set(mints));
  const { fresh, missing } = readPriceCache(unique);
  if (missing.length === 0) return fresh;

  // Jupiter caps one `ids` query at `PRICE_BATCH_SIZE`. Chunk rather than
  // truncate: the old `.slice(0, PRICE_BATCH_SIZE)` silently dropped every mint
  // after the fiftieth for any caller that did not pre-batch.
  const clean: Record<string, JupiterPriceEntry> = {};
  for (let start = 0; start < missing.length; start += PRICE_BATCH_SIZE) {
    const batch = missing.slice(start, start + PRICE_BATCH_SIZE);
    const url = `${JUPITER_PRICE_BASE}?ids=${encodeURIComponent(batch.join(","))}`;
    const data = await jupiterFetch<Record<string, JupiterPriceEntry>>(url);

    // Defensive normalisation: a price that is not a positive finite number is
    // useless for valuation and must be treated as missing.
    for (const [mint, entry] of Object.entries(data ?? {})) {
      if (!entry) continue;
      const { usdPrice, decimals, blockId, priceChange24h } = entry;
      if (
        typeof usdPrice !== "number" ||
        !Number.isFinite(usdPrice) ||
        usdPrice < 0
      ) {
        continue;
      }
      clean[mint] = {
        usdPrice,
        decimals: Number.isInteger(decimals) ? decimals : 0,
        blockId: Number.isFinite(blockId) ? blockId : 0,
        priceChange24h: Number.isFinite(priceChange24h) ? priceChange24h : 0,
      };
    }
  }

  writePriceCache(missing, clean);
  return { ...fresh, ...clean };
}

// ── Short-lived price cache ────────────────────────────────────────────────
// Process-local on purpose: no Redis, no cost, and it disappears on cold start.

const PRICE_CACHE_TTL_MS = 20_000;
/**
 * How long a mint Jupiter did not price is remembered as unpriceable.
 *
 * Longer than a price's TTL on purpose. The 20-second cache exists so a rescan
 * sees a current price; a *missing* price is a fact about the token rather than
 * about this second. Without this, one unpriced mint in a batch made every batch
 * a full miss, so every scan refetched the wallet's whole price list — which is
 * what the cache was added to avoid.
 */
const UNPRICED_TTL_MS = 60_000;

const priceCache = new Map<string, { entry: JupiterPriceEntry; at: number }>();
const unpricedCache = new Map<string, number>();

/**
 * The entries still fresh, and the mints that need asking for.
 *
 * Deliberately partial: a batch with one unpriceable token used to return a
 * full miss, so the other forty-nine prices were refetched too.
 */
function readPriceCache(mints: string[]): {
  fresh: Record<string, JupiterPriceEntry>;
  missing: string[];
} {
  const now = Date.now();
  const fresh: Record<string, JupiterPriceEntry> = {};
  const missing: string[] = [];

  for (const mint of mints) {
    const hit = priceCache.get(mint);
    if (hit && now - hit.at <= PRICE_CACHE_TTL_MS) {
      fresh[mint] = hit.entry;
      continue;
    }
    const unpricedAt = unpricedCache.get(mint);
    if (unpricedAt !== undefined && now - unpricedAt <= UNPRICED_TTL_MS) {
      // Known unpriceable in this window. Treat as answered, with no entry.
      continue;
    }
    missing.push(mint);
  }

  return { fresh, missing };
}

function writePriceCache(
  mints: string[],
  prices: Record<string, JupiterPriceEntry>,
): void {
  const now = Date.now();
  // Bound both maps so a long-lived server cannot grow without limit.
  if (priceCache.size > 20_000 || unpricedCache.size > 20_000) {
    priceCache.clear();
    unpricedCache.clear();
  }
  for (const mint of mints) {
    const entry = prices[mint];
    if (entry) {
      priceCache.set(mint, { entry, at: now });
      unpricedCache.delete(mint);
    } else {
      // Absent means "Jupiter cannot price this one", not "zero".
      unpricedCache.set(mint, now);
    }
  }
}

// ── Swap API v2 — /build ────────────────────────────────────────────────────

export interface BuildParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  /** User's wallet address. Jupiter derives the ATAs from it. */
  taker: string;
  slippageBps: number;
  /** Cap on route accounts, 1–64. Lower = smaller tx = more swaps per tx. */
  maxAccounts?: number;
}

/**
 * Ask Jupiter for the raw instructions of one swap.
 *
 * `/build` returns *instructions* rather than an assembled transaction
 * specifically so integrators can compose their own. That is what lets us pack
 * many dust swaps and their `closeAccount` calls into one signed transaction.
 *
 * Throws `UpstreamError` when Jupiter has no route. Callers catch per-token so
 * a single unroutable token cannot abort an entire sweep.
 */
export async function buildSwap(
  params: BuildParams,
): Promise<JupiterBuildResponse> {
  const query = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    taker: params.taker,
    slippageBps: String(params.slippageBps),
  });
  // Dust routes are simple. Capping accounts keeps each swap's instruction
  // list short, which is what allows more swaps to fit in one 1232-byte packet.
  query.set("maxAccounts", String(params.maxAccounts ?? 32));

  const data = await jupiterFetch<JupiterBuildResponse>(
    `${JUPITER_SWAP_BASE}/build?${query.toString()}`,
  );

  // Defensive normalisation: `/build` has serialised the blockhash as a byte
  // array in some responses and as base58 in others. We always want base58.
  const raw = data?.blockhashWithMetadata?.blockhash;
  if (Array.isArray(raw)) {
    data.blockhashWithMetadata.blockhash = bytesToBase58(raw as number[]);
  }
  return data;
}

/** Base58-encode a byte array without pulling web3.js into the server bundle. */
function bytesToBase58(bytes: number[]): string {
  const ALPHABET =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const buffer = Uint8Array.from(bytes);
  if (buffer.length === 0) return "";

  // Count leading zero bytes; each becomes a literal '1'.
  let zeros = 0;
  while (zeros < buffer.length && buffer[zeros] === 0) zeros += 1;

  // Repeated division of the big-endian byte string by 58.
  const digits: number[] = [];
  for (let i = zeros; i < buffer.length; i += 1) {
    let carry = buffer[i] ?? 0;
    for (let j = 0; j < digits.length; j += 1) {
      carry += (digits[j] ?? 0) << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    out += ALPHABET[digits[i] ?? 0];
  }
  return out;
}

export interface SerialBuildResult {
  result?: JupiterBuildResponse;
  error?: string;
}

/**
 * Run several `/build` calls with bounded concurrency and a polite gap.
 *
 * Jupiter's keyless tier allows roughly 0.5 req/s, so an unbounded
 * `Promise.all` across 30 tokens would trip 429s. A small lane pool plus a
 * short delay keeps us well inside the limit without feeling slow.
 */
export async function buildSwapsSerial<T>(
  items: T[],
  worker: (item: T) => Promise<JupiterBuildResponse>,
  options: { concurrency?: number; gapMs?: number } = {},
): Promise<Array<{ item: T; result?: JupiterBuildResponse; error?: string }>> {
  const { concurrency = 4, gapMs = 120 } = options;
  return runWithConcurrency(items, worker, { concurrency, gapMs });
}