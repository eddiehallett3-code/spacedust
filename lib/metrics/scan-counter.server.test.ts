import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readScanCounts, recordScan } from "./scan-counter.server";

/**
 * The scan counter.
 *
 * It exists so that "has anyone used this?" has an answer, which means the
 * failure that matters is silence: a counter that quietly stops counting looks
 * exactly like a site nobody visits. So these tests pin the commands it sends,
 * that it parses Redis' string replies, and — most importantly — that a broken
 * store never propagates into the scan it is measuring.
 */

const DAY = "spacedust:scans:v1:2026-10-31";
const TOTAL = "spacedust:scans:v1:total";

const fetchMock = vi.fn();

/** A pipeline reply in Redis' REST shape: one object per command. */
function reply(...results: unknown[]): Response {
  return new Response(JSON.stringify(results.map((result) => ({ result }))), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function configureStore(): void {
  process.env.RATE_LIMIT_REDIS_URL = "https://example.upstash.io/";
  process.env.RATE_LIMIT_REDIS_TOKEN = "test-token";
}

function unconfigureStore(): void {
  delete process.env.RATE_LIMIT_REDIS_URL;
  delete process.env.RATE_LIMIT_REDIS_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.RATE_LIMIT_REDIS_KV_REST_API_URL;
  delete process.env.RATE_LIMIT_REDIS_KV_REST_API_TOKEN;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  unconfigureStore();
});

describe("recordScan", () => {
  it("increments today's bucket and the running total in one round trip", async () => {
    configureStore();
    fetchMock.mockResolvedValue(reply(1, 1, 1));

    await recordScan();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.upstash.io/pipeline");
    expect(JSON.parse(String(init.body))).toEqual([
      ["INCR", DAY],
      ["EXPIRE", DAY, 34_560_000, "NX"],
      ["INCR", TOTAL],
    ]);
  });

  it("sends the token as a bearer credential", async () => {
    configureStore();
    fetchMock.mockResolvedValue(reply(1, 1, 1));

    await recordScan();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-token");
  });

  it("does nothing at all when no store is configured", async () => {
    unconfigureStore();

    await expect(recordScan()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows a failing store rather than breaking the scan it measures", async () => {
    configureStore();
    fetchMock.mockRejectedValue(new Error("network down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(recordScan()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("swallows a non-200 answer too", async () => {
    configureStore();
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(recordScan()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("readScanCounts", () => {
  it("parses Redis' string replies into numbers", async () => {
    configureStore();
    fetchMock.mockResolvedValue(reply("7", "1234"));

    const counts = await readScanCounts();

    expect(counts).toMatchObject({ today: 7, total: 1234, detail: null });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual([
      ["GET", DAY],
      ["GET", TOTAL],
    ]);
  });

  it("reports an empty store as zero rather than as a failure", async () => {
    configureStore();
    fetchMock.mockResolvedValue(reply(null, null));

    await expect(readScanCounts()).resolves.toMatchObject({
      today: 0,
      total: 0,
      detail: null,
    });
  });

  it("explains itself when nothing is configured", async () => {
    unconfigureStore();

    const counts = await readScanCounts();

    expect(counts.today).toBeNull();
    expect(counts.source).toBeNull();
    expect(counts.detail).toContain("not being counted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains a store that is configured but unreachable", async () => {
    configureStore();
    fetchMock.mockRejectedValue(new Error("connect timeout"));

    const counts = await readScanCounts();

    expect(counts.total).toBeNull();
    expect(counts.source).toBe("RATE_LIMIT_REDIS_URL");
    expect(counts.detail).toContain("did not answer");
  });
});
