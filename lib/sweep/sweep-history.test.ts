import { describe, expect, it } from "vitest";
import { isHistoryEntry } from "@/hooks/use-sweep-history";

/**
 * Persisted history is the one place a hand-edited value can reach React.
 *
 * The old validator checked only the keys it needed to list rows, so
 * `signatures: [{}]` passed and then `truncateAddress` returned the object as a
 * child — a render-time throw that took the whole panel down. The module's own
 * doc says a corrupt entry can at worst render wrong text; these are the checks
 * that make that true.
 */
const valid = {
  id: "1717000000000-sig",
  createdAt: 1_717_000_000_000,
  outputAsset: "SOL",
  outputMint: "So11111111111111111111111111111111111111112",
  totalOutput: 0.5,
  totalValueUsd: 42,
  tokenCount: 3,
  successCount: 2,
  failedCount: 1,
  rentReclaimedLamports: 1_400_000,
  feeLamports: 5_000,
  signatures: ["3Bwppb9v3PxCZfgeiU3pKDUUxB2KzPHjMEtDMU9P3ydG9XTuKkJHyhNmtM9yZRRkjQcW2HHRtij3kAEScB2jCdcL"],
  mints: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
};

describe("isHistoryEntry", () => {
  it("accepts a well-formed entry", () => {
    expect(isHistoryEntry(valid)).toBe(true);
  });

  it("rejects objects where React needs strings", () => {
    expect(isHistoryEntry({ ...valid, signatures: [{}] })).toBe(false);
    expect(isHistoryEntry({ ...valid, mints: [123] })).toBe(false);
  });

  it("rejects an output asset the app cannot render", () => {
    expect(isHistoryEntry({ ...valid, outputAsset: "BONK" })).toBe(false);
  });

  it("rejects non-finite and non-numeric figures", () => {
    expect(isHistoryEntry({ ...valid, createdAt: Number.NaN })).toBe(false);
    expect(isHistoryEntry({ ...valid, totalOutput: "0.5" })).toBe(false);
    expect(isHistoryEntry({ ...valid, totalValueUsd: Number.POSITIVE_INFINITY })).toBe(
      false,
    );
  });

  it("rejects impossible counts", () => {
    expect(isHistoryEntry({ ...valid, tokenCount: -1 })).toBe(false);
    expect(isHistoryEntry({ ...valid, successCount: 1.5 })).toBe(false);
    expect(isHistoryEntry({ ...valid, failedCount: null })).toBe(false);
  });

  it("rejects anything that is not an object", () => {
    expect(isHistoryEntry(null)).toBe(false);
    expect(isHistoryEntry("entry")).toBe(false);
    expect(isHistoryEntry([])).toBe(false);
  });
});
