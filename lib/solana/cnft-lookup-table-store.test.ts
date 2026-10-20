import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import {
  forgetPendingLookupTableCleanup,
  listPendingLookupTableCleanups,
  rememberPendingLookupTableCleanup,
} from "@/lib/solana/cnft-lookup-table-store";
import { STORAGE_KEYS } from "@/lib/utils/constants";

/**
 * The lookup-table address is the only handle to its rent. These tests pin the
 * merge and removal rules that keep that handle from being lost or duplicated
 * across a refresh.
 */

const AUTHORITY = bs58.encode(Buffer.alloc(32, 1));
const OTHER = bs58.encode(Buffer.alloc(32, 2));
const TABLE_A = bs58.encode(Buffer.alloc(32, 3));
const TABLE_B = bs58.encode(Buffer.alloc(32, 4));

function installStorage(initial: Record<string, string> = {}): Map<string, string> {
  const values = new Map(Object.entries(initial));
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  vi.stubGlobal("window", { localStorage });
  return values;
}

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pending lookup-table cleanup store", () => {
  it("merges tables for the same wallet and replaces an older balance", () => {
    rememberPendingLookupTableCleanup(AUTHORITY, [
      { address: TABLE_A, rentLamports: 100 },
    ]);
    rememberPendingLookupTableCleanup(AUTHORITY, [
      { address: TABLE_A, rentLamports: 200 },
      { address: TABLE_B, rentLamports: 300 },
    ]);

    expect(listPendingLookupTableCleanups(AUTHORITY)).toEqual([
      { address: TABLE_A, rentLamports: 200 },
      { address: TABLE_B, rentLamports: 300 },
    ]);
  });

  it("keeps wallets separate", () => {
    rememberPendingLookupTableCleanup(AUTHORITY, [
      { address: TABLE_A, rentLamports: 100 },
    ]);
    rememberPendingLookupTableCleanup(OTHER, [
      { address: TABLE_B, rentLamports: 300 },
    ]);

    expect(listPendingLookupTableCleanups(AUTHORITY)).toEqual([
      { address: TABLE_A, rentLamports: 100 },
    ]);
  });

  it("drops only the tables that closed, and the entry when none remain", () => {
    rememberPendingLookupTableCleanup(AUTHORITY, [
      { address: TABLE_A, rentLamports: 100 },
      { address: TABLE_B, rentLamports: 200 },
    ]);

    forgetPendingLookupTableCleanup(AUTHORITY, [TABLE_A]);
    expect(listPendingLookupTableCleanups(AUTHORITY)).toEqual([
      { address: TABLE_B, rentLamports: 200 },
    ]);

    forgetPendingLookupTableCleanup(AUTHORITY, [TABLE_B]);
    expect(listPendingLookupTableCleanups(AUTHORITY)).toEqual([]);
  });

  it("ignores corrupt storage instead of throwing", () => {
    const values = installStorage({
      [STORAGE_KEYS.lookupTableCleanup]: "{not json",
    });

    expect(listPendingLookupTableCleanups(AUTHORITY)).toEqual([]);

    // A write repairs the key rather than being blocked by the bad value.
    rememberPendingLookupTableCleanup(AUTHORITY, [
      { address: TABLE_A, rentLamports: 100 },
    ]);
    expect(values.has(STORAGE_KEYS.lookupTableCleanup)).toBe(true);
  });
});
