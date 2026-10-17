import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkSharedLimit, sharedLimiterStatus } from "./rate-limit-store";

/**
 * The shared counter, and the ways it must not break the app.
 *
 * The arithmetic is the small part. The load-bearing decisions are the failure
 * modes: unconfigured means "no opinion" rather than "refuse everything", and a
 * store that is slow, down, or answering nonsense must let the request through.
 * A rate limiter that takes the API down when its own dependency hiccups is worse
 * than the abuse it exists to prevent.
 */

const request = (ip = "203.0.113.9") =>
  new Request("https://spacedust.cc/api/tokens", {
    headers: { "x-forwarded-for": ip },
  });

/** The pipeline reply the store expects: six counters, in order. */
function reply(counts: number[]): Response {
  return new Response(
    JSON.stringify(counts.map((result) => ({ result }))),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("checkSharedLimit", () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_REDIS_URL = "https://counters.example";
    process.env.RATE_LIMIT_REDIS_TOKEN = "a-token";
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_REDIS_URL;
    delete process.env.RATE_LIMIT_REDIS_TOKEN;
    vi.restoreAllMocks();
  });

  it("has no opinion when no store is configured, and costs nothing", async () => {
    delete process.env.RATE_LIMIT_REDIS_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const allowance = await checkSharedLimit(request(), "tokens");

    expect(allowance.allowed).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("allows a client that is inside its budget", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply([5, 1, 42, 10, 1, 42])),
    );

    await expect(checkSharedLimit(request(), "tokens")).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    vi.unstubAllGlobals();
  });

  it("refuses a client over its own budget, and says how long to wait", async () => {
    // tokens is 30/min, so 31 is one over.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply([31, 1, 37, 31, 1, 37])),
    );

    await expect(checkSharedLimit(request(), "tokens")).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 37,
    });
    vi.unstubAllGlobals();
  });

  it("refuses when the route ceiling is reached, however the client is keyed", async () => {
    // 30/min × 50 ceiling = 1500. A client inside its own budget still waits.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply([2, 1, 40, 1501, 1, 40])),
    );

    await expect(checkSharedLimit(request(), "tokens")).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 40,
    });
    vi.unstubAllGlobals();
  });

  it("counts the client, not the route, in its key", async () => {
    const fetchSpy = vi.fn(async () => reply([1, 1, 60, 1, 1, 60]));
    vi.stubGlobal("fetch", fetchSpy);

    await checkSharedLimit(request("198.51.100.7"), "tokens");

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toContain("rl:tokens:ip:198.51.100.7");
    vi.unstubAllGlobals();
  });

  it("fails open when the store is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(checkSharedLimit(request(), "tokens")).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    vi.unstubAllGlobals();
  });

  it("fails open when the store answers with an error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );

    await expect(checkSharedLimit(request(), "health")).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    vi.unstubAllGlobals();
  });

  it("fails open when the store answers with something unusable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 })),
    );

    await expect(checkSharedLimit(request(), "plan")).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    vi.unstubAllGlobals();
  });
});

/**
 * Which environment names count as "configured".
 *
 * The names matter as much as the arithmetic. Production sat unconfigured for
 * days because the only names this read were ones nothing had set, while every
 * Redis integration people actually add supplies different ones — so accepting
 * those as they come is the difference between a working limiter and a file of
 * good intentions.
 */
const STORE_ENV = [
  "RATE_LIMIT_REDIS_URL",
  "RATE_LIMIT_REDIS_TOKEN",
  "RATE_LIMIT_REDIS_KV_REST_API_URL",
  "RATE_LIMIT_REDIS_KV_REST_API_TOKEN",
  "RATE_LIMIT_REDIS_KV_URL",
  "RATE_LIMIT_REDIS_REDIS_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
];

function clearStoreEnv(): void {
  for (const name of STORE_ENV) delete process.env[name];
}

describe("store configuration", () => {
  beforeEach(clearStoreEnv);
  afterEach(() => {
    clearStoreEnv();
    vi.unstubAllGlobals();
  });

  /** The URL a single allowed request went to, or null if nothing was called. */
  async function endpointUsed(): Promise<string | null> {
    const fetchSpy = vi.fn(async () => reply([1, 1, 60, 1, 1, 60]));
    vi.stubGlobal("fetch", fetchSpy);
    await checkSharedLimit(request(), "tokens");
    const first = fetchSpy.mock.calls[0] as unknown as [string] | undefined;
    return first?.[0] ?? null;
  }

  it("reads Upstash's own variable names, slashes and all", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://upstash.example/";
    process.env.UPSTASH_REDIS_REST_TOKEN = "upstash-token";

    await expect(endpointUsed()).resolves.toBe("https://upstash.example/pipeline");
  });

  it("reads Vercel's Redis integration's names", async () => {
    process.env.KV_REST_API_URL = "https://vercel-redis.example";
    process.env.KV_REST_API_TOKEN = "vercel-token";

    await expect(endpointUsed()).resolves.toBe("https://vercel-redis.example/pipeline");
  });

  it("prefers the app's own names over an integration's", async () => {
    process.env.RATE_LIMIT_REDIS_URL = "https://explicit.example";
    process.env.RATE_LIMIT_REDIS_TOKEN = "explicit-token";
    process.env.UPSTASH_REDIS_REST_URL = "https://upstash.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "upstash-token";

    await expect(endpointUsed()).resolves.toBe("https://explicit.example/pipeline");
  });

  it("reads what Vercel's integration creates after a custom prefix", async () => {
    // The real shape: the prefix is prepended to the integration's own KV_* names,
    // so `RATE_LIMIT_REDIS` arrives as …_KV_REST_API_URL, not …_URL.
    process.env.RATE_LIMIT_REDIS_KV_REST_API_URL = "https://prefixed.example";
    process.env.RATE_LIMIT_REDIS_KV_REST_API_TOKEN = "prefixed-token";

    await expect(endpointUsed()).resolves.toBe("https://prefixed.example/pipeline");
  });

  it("ignores the redis:// siblings that connection also creates", async () => {
    // Every Upstash/Vercel connection ships …_KV_URL and …_REDIS_URL beside the
    // REST pair. They speak the Redis protocol, so fetching them would fail on
    // every request and fail open — the limiter would look configured and be off.
    process.env.RATE_LIMIT_REDIS_KV_URL = "rediss://default:secret@example.com:6379";
    process.env.RATE_LIMIT_REDIS_REDIS_URL = "rediss://default:secret@example.com:6379";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(checkSharedLimit(request(), "tokens")).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("needs both halves, so a URL with no token is still unconfigured", async () => {
    process.env.KV_REST_API_URL = "https://vercel-redis.example";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(checkSharedLimit(request(), "tokens")).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * The half `/api/health` reports. Its whole reason to exist is that "configured
 * but not working" is a distinct state from "not configured", and both look the
 * same from the outside: requests succeed either way, because this fails open.
 */
describe("sharedLimiterStatus", () => {
  beforeEach(clearStoreEnv);
  afterEach(() => {
    clearStoreEnv();
    vi.unstubAllGlobals();
  });

  it("says the limits are per-instance when nothing is set, without calling out", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const status = await sharedLimiterStatus();

    expect(status.configured).toBe(false);
    expect(status.working).toBe(false);
    expect(status.detail).toContain("per-instance");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("proves the store answers, and names the variables it came from", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://upstash.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "upstash-token";
    const fetchSpy = vi.fn(async () => reply([7, 1]));
    vi.stubGlobal("fetch", fetchSpy);

    const status = await sharedLimiterStatus();

    expect(status.configured).toBe(true);
    expect(status.working).toBe(true);
    expect(status.source).toBe("UPSTASH_REDIS_REST_URL");

    // The probe increments a key, so it must also give that key an expiry —
    // otherwise checking health would leave litter in the database for ever.
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain("EXPIRE");
  });

  it("reports a store that is set but silent, rather than claiming it works", async () => {
    process.env.RATE_LIMIT_REDIS_URL = "https://counters.example";
    process.env.RATE_LIMIT_REDIS_TOKEN = "a-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const status = await sharedLimiterStatus();

    expect(status.configured).toBe(true);
    expect(status.working).toBe(false);
    expect(status.detail).toContain("fail open");
  });
});

