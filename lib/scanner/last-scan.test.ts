import { describe, expect, it } from "vitest";
import type { WalletScan } from "@/types/token";
import { STORAGE_KEYS } from "@/lib/utils/constants";
import {
  MAX_CACHED_SCAN_CHARS,
  describeAge,
  describeChange,
  fitsInStorage,
  readLastScan,
  summariseScan,
  writeLastScan,
  type ScanSummary,
} from "./last-scan";

/**
 * The scan we keep between visits.
 *
 * Two failure modes are worth testing and neither is visible on screen: a cached
 * result shown without its age (which reads as live data), and a "what changed"
 * line computed against a different wallet (which is worse than no line at all).
 * The quota behaviour is here for the same reason — it fails silently by design, so
 * the only place it can be seen is a test.
 */

const OWNER = "3gJFX3KFfsPFERu437FeUBbH2B6twpfBD5ZkoZGsgUty";

function scanWith(counts: {
  tokens?: number;
  nfts?: number;
  approvals?: number | null;
  emptyAccounts?: number;
}): WalletScan {
  const { tokens = 0, nfts = 0, approvals = null, emptyAccounts = 0 } = counts;
  return {
    owner: OWNER,
    tokens: Array.from({ length: tokens }, () => ({})),
    nonFungibles: Array.from({ length: nfts }, () => ({})),
    emptyTokenAccounts: Array.from({ length: emptyAccounts }, () => ({})),
    ...(approvals === null
      ? {}
      : { approvals: Array.from({ length: approvals }, () => ({})) }),
  } as unknown as WalletScan;
}

function summary(over: Partial<ScanSummary> = {}): ScanSummary {
  return {
    owner: OWNER,
    at: 1_000,
    tokens: 10,
    nfts: 2,
    approvals: 3,
    emptyAccounts: 4,
    ...over,
  };
}

/** The smallest thing that behaves like Storage for the two calls we make. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  } as unknown as Storage;
}

describe("summariseScan", () => {
  it("counts what can be counted and does not invent approvals", () => {
    const summary = summariseScan(scanWith({ tokens: 7, nfts: 1, emptyAccounts: 2 }), 5);

    expect(summary).toEqual({
      owner: OWNER,
      at: 5,
      tokens: 7,
      nfts: 1,
      approvals: null,
      emptyAccounts: 2,
    });
  });
});

describe("describeAge", () => {
  it("says just now, then minutes, hours and days", () => {
    const at = 1_000_000;
    expect(describeAge(at, at + 5_000)).toBe("just now");
    expect(describeAge(at, at + 60_000)).toBe("1 minute ago");
    expect(describeAge(at, at + 4 * 60_000)).toBe("4 minutes ago");
    expect(describeAge(at, at + 3 * 3_600_000)).toBe("3 hours ago");
    expect(describeAge(at, at + 2 * 86_400_000)).toBe("2 days ago");
  });
});

describe("describeChange", () => {
  it("reports the deltas in both directions", () => {
    const line = describeChange(
      summary(),
      summary({ tokens: 12, approvals: 1 }),
    );

    expect(line).toContain("2 more tokens");
    expect(line).toContain("2 fewer approvals");
  });

  it("says nothing when nothing moved", () => {
    expect(describeChange(summary(), summary())).toBeNull();
  });

  it("never compares two different wallets", () => {
    const other = summary({ owner: "9qDz4uC7M7oJdhCErKEtLzm4pkdjdc7uQAFggy5jYrmt", tokens: 99 });
    expect(describeChange(other, summary())).toBeNull();
  });

  it("skips approvals when either scan did not read them", () => {
    const line = describeChange(
      summary({ approvals: null }),
      summary({ approvals: 9, tokens: 10 }),
    );
    expect(line).toBeNull();
  });
});

describe("fitsInStorage", () => {
  it("keeps a normal wallet and refuses an enormous one", () => {
    expect(fitsInStorage(scanWith({ tokens: 50 }))).toBe(true);

    const huge = scanWith({ tokens: 1 });
    (huge as unknown as { tokens: unknown[] }).tokens = Array.from(
      { length: 4_000 },
      () => ({ mint: "x".repeat(80), balance: "1" }),
    );
    expect(JSON.stringify(huge).length).toBeGreaterThan(MAX_CACHED_SCAN_CHARS);
    expect(fitsInStorage(huge)).toBe(false);
  });
});

describe("readLastScan and writeLastScan", () => {
  it("stores under the shared key, so the clear-site-data button finds it", () => {
    // The security page promises that clearing site data removes everything the
    // app keeps, and that button iterates `STORAGE_KEYS`. A record written under a
    // private key would survive it, which is the one failure this test can see
    // from here.
    const storage = fakeStorage();
    writeLastScan({ summary: summary(), scan: null }, storage);

    expect(storage.getItem(STORAGE_KEYS.lastScan)).not.toBeNull();
  });

  it("round-trips a record", () => {
    const storage = fakeStorage();
    writeLastScan({ summary: summary(), scan: scanWith({ tokens: 3 }) }, storage);

    const read = readLastScan(storage);
    expect(read?.summary.tokens).toBe(10);
    expect(read?.scan).not.toBeNull();
  });

  it("returns null rather than throwing on corrupt storage", () => {
    expect(readLastScan(fakeStorage({ "spacedust.lastScan.v1": "{not json" }))).toBeNull();
    expect(readLastScan(fakeStorage({ "spacedust.lastScan.v1": "[]" }))).toBeNull();
  });

  it("drops the full result when the quota refuses it, keeping the summary", () => {
    const storage = fakeStorage();
    const refusing = {
      getItem: storage.getItem,
      setItem: (key: string, value: string) => {
        if (value.length > 1_000) throw new Error("QuotaExceededError");
        storage.setItem(key, value);
      },
    } as unknown as Storage;

    writeLastScan(
      { summary: summary(), scan: { big: "x".repeat(5_000) } as unknown as WalletScan },
      refusing,
    );

    const read = readLastScan(refusing);
    expect(read?.summary.tokens).toBe(10);
    expect(read?.scan).toBeNull();
  });
});
