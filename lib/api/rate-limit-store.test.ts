import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkSharedLimit } from "./rate-limit-store";

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
