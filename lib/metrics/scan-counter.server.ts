import "server-only";

import { resolveCounterStore } from "@/lib/api/rate-limit-store";

/**
 * How many wallet scans ran — a number, not a record.
 *
 * The app ships with no analytics on purpose, and the privacy page says so. The
 * consequence was that nobody could tell whether the thing was being used at
 * all: Reown's dashboard only counts WalletConnect sessions (AppKit analytics is
 * switched off anyway), and the read-only scan — the lowest-friction way in, and
 * the one the landing page pushes — touches no wallet and so produced no event
 * anywhere.
 *
 * This is the smallest thing that answers "did anyone get value today": one
 * integer per day, incremented when a scan succeeds.
 *
 * **What it deliberately does not store:** no IP, no wallet address, no user
 * agent, no referrer, no session, no id of any kind. There is nothing to join
 * two scans together with, and nothing that identifies a person. It is a
 * tally-mark, which is why it can live alongside a promise of no analytics
 * without contradicting it.
 *
 * Storage is the same optional shared store the rate limiter uses. With nothing
 * configured it is a no-op that costs one null check.
 */

/** Short: this sits at the end of a request that has already done real work. */
const TIMEOUT_MS = 1_200;

const DAY_PREFIX = "spacedust:scans:v1:";
const TOTAL_KEY = "spacedust:scans:v1:total";

/** Daily buckets expire; the running total does not. */
const DAY_TTL_SECONDS = 60 * 60 * 24 * 400;

/** UTC, so "today" is the same day for every instance and every caller. */
function dayKey(now: Date = new Date()): string {
  return `${DAY_PREFIX}${now.toISOString().slice(0, 10)}`;
}

interface StoreEndpoint {
  url: string;
  token: string;
  source: string;
}

/**
 * One round trip for several commands.
 *
 * Separate from the limiter's own pipeline on purpose: that one insists on a
 * numeric result and throws otherwise, while `GET` comes back as a string.
 */
async function pipeline(
  endpoint: StoreEndpoint,
  commands: unknown[][],
): Promise<unknown[]> {
  const response = await fetch(`${endpoint.url}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${endpoint.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`counter store answered ${response.status}`);

  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error("counter store answered nothing usable");
  return body.map((entry) => (entry as { result?: unknown })?.result);
}

function asCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Count one successful scan.
 *
 * Never throws, never blocks for longer than the timeout, and never changes what
 * the caller returns: measurement must not be able to break the thing it is
 * measuring.
 */
export async function recordScan(): Promise<void> {
  const endpoint = resolveCounterStore();
  if (!endpoint) return;

  const key = dayKey();
  try {
    await pipeline(endpoint, [
      ["INCR", key],
      ["EXPIRE", key, DAY_TTL_SECONDS, "NX"],
      ["INCR", TOTAL_KEY],
    ]);
  } catch (error) {
    console.warn(
      `[spacedust] could not count this scan: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Today's scans and the running total, for `/api/health`. */
export async function readScanCounts(): Promise<{
  today: number | null;
  total: number | null;
  source: string | null;
  detail: string | null;
}> {
  const endpoint = resolveCounterStore();
  if (!endpoint) {
    return {
      today: null,
      total: null,
      source: null,
      detail:
        "No shared store, so scans are not being counted. Add Upstash or Vercel Redis (their own variable names are read), or set RATE_LIMIT_REDIS_URL and RATE_LIMIT_REDIS_TOKEN — the rate limiter uses the same one.",
    };
  }

  try {
    const [today, total] = await pipeline(endpoint, [
      ["GET", dayKey()],
      ["GET", TOTAL_KEY],
    ]);
    return {
      // A key that does not exist yet is a zero, not a failure: Redis answers
      // `null` for a missing key, and "null" on a health page reads like an
      // error when it actually means "nobody has scanned since this shipped".
      today: asCount(today) ?? 0,
      total: asCount(total) ?? 0,
      source: endpoint.source,
      detail: null,
    };
  } catch (error) {
    return {
      today: null,
      total: null,
      source: endpoint.source,
      detail: `The counter store is set from ${endpoint.source} but did not answer (${
        error instanceof Error ? error.message.slice(0, 120) : "unknown error"
      }).`,
    };
  }
}
