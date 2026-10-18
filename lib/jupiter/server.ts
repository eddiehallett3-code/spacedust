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
 * Fetch USD prices for up to `PRICE_BATCH_SIZE` mints.
 *
 * Jupiter deliberately *omits* mints it cannot price rather than returning
 * `null`, so callers must treat "absent from the result" as "no reliable
 * price" — that is exactly how our Smart Filter decides what to hide.
 *
 * Results are cached briefly in memory. A wallet with thousands of dust mints
 * needs dozens of batches, and users rescan constantly while adjusting the
 * threshold — this removes most repeat traffic.
 */
export async function fetchPrices(
  mints: string[],
): Promise<Record<string, JupiterPriceEntry>> {
  if (mints.length === 0) return {};

  // De-duplicate defensively; DAS can repeat a mint across page boundaries.
  const unique = Array.from(new Set(mints)).slice(0, PRICE_BATCH_SIZE);
  const cached = readPriceCache(unique);
  if (cached) return cached;

  const url = `${JUPITER_PRICE_BASE}?ids=${encodeURIComponent(unique.join(","))}`;
  const data = await jupiterFetch<Record<string, JupiterPriceEntry>>(url);

  // Defensive normalisation: a price that is not a positive finite number is
  // useless for valuation and must be treated as missing.
  const clean: Record<string, JupiterPriceEntry> = {};
  for (const [mint, entry] of Object.entries(data ?? {})) {
    if (!entry) continue;
    const { usdPrice, decimals, blockId, priceChange24h } = entry;
    if (typeof usdPrice !== "number" || !Number.isFinite(usdPrice) || usdPrice < 0) {
      continue;
    }
    clean[mint] = {
      usdPrice,
      decimals: Number.isInteger(decimals) ? decimals : 0,
      blockId: Number.isFinite(blockId) ? blockId : 0,
      priceChange24h: Number.isFinite(priceChange24h) ? priceChange24h : 0,
    };
  }

  writePriceCache(unique, clean);
  return clean;
}

// ── Short-lived price cache ────────────────────────────────────────────────
// Process-local on purpose: no Redis, no cost, and it disappears on cold start.

const PRICE_CACHE_TTL_MS = 20_000;
const priceCache = new Map<string, { entry: JupiterPriceEntry; at: number }>();

/** Returns a full cache hit, or null if any mint is missing/expired. */
function readPriceCache(
  mints: string[],
): Record<string, JupiterPriceEntry> | null {
  const now = Date.now();
  const out: Record<string, JupiterPriceEntry> = {};
  for (const mint of mints) {
    const hit = priceCache.get(mint);
    if (!hit || now - hit.at > PRICE_CACHE_TTL_MS) return null;
    out[mint] = hit.entry;
  }
  return out;
}

function writePriceCache(
  mints: string[],
  prices: Record<string, JupiterPriceEntry>,
): void {
  const now = Date.now();
  // Bound the map so a long-lived server cannot grow without limit.
  if (priceCache.size > 20_000) priceCache.clear();
  for (const mint of mints) {
    const entry = prices[mint];
    // Absent mints are cached as a sentinel too, so we do not refetch
    // unpriceable junk on every scan.
    if (entry) priceCache.set(mint, { entry, at: now });
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