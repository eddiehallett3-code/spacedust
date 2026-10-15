import { describe, expect, it } from "vitest";
import { toBaseAmount } from "./sanitize";

/**
 * Whole units to base units — the conversion every typed amount goes through.
 *
 * Worth its own tests because the failure modes are money: a float round-trip
 * loses a hair, and a hair is the difference between a transfer that empties an
 * account and one that leaves a residue the account cannot then be closed for.
 * `Number("0.1") * 1e9` is 100000000.00000001, which is why this never uses a
 * float at all.
 */

describe("toBaseAmount", () => {
  it("converts a plain whole number", () => {
    expect(toBaseAmount("1", 6)).toBe(1_000_000n);
    expect(toBaseAmount("250", 9)).toBe(250_000_000_000n);
  });

  it("converts a fraction exactly, where a float would not", () => {
    // The reason this function exists. `1.005 * 1e6` is 1004999.9999999999, so a
    // float path truncated it to 1004999 — one base unit less than the user
    // typed. One unit is the difference between a send that empties an account
    // and one that leaves a residue the account can then never be closed for.
    expect(Number("1.005") * 1e6).not.toBe(1_005_000);
    expect(Math.trunc(Number("1.005") * 1e6)).toBe(1_004_999);
    expect(toBaseAmount("1.005", 6)).toBe(1_005_000n);

    expect(toBaseAmount("0.1", 9)).toBe(100_000_000n);
    expect(toBaseAmount("0.000000001", 9)).toBe(1n);
    expect(toBaseAmount("1234.567890123", 9)).toBe(1_234_567_890_123n);
  });

  it("accepts a leading or trailing decimal point as what it obviously means", () => {
    expect(toBaseAmount(".5", 6)).toBe(500_000n);
    expect(toBaseAmount("5.", 6)).toBe(5_000_000n);
  });

  it("ignores thousands separators people paste in", () => {
    expect(toBaseAmount("1,000", 9)).toBe(1_000_000_000_000n);
  });

  it("refuses more precision than the token has, rather than rounding", () => {
    // Rounding up would send more than was asked for, so this is a refusal.
    expect(toBaseAmount("0.0000001", 6)).toBeNull();
    expect(toBaseAmount("1.5", 0)).toBeNull();
  });

  it("refuses anything that is not a plain positive decimal", () => {
    for (const input of ["", " ", ".", "abc", "-1", "1e9", "0x10", "1.2.3", "+1", "NaN"]) {
      expect(toBaseAmount(input, 6)).toBeNull();
    }
  });

  it("handles zero as a value the caller can then judge", () => {
    // Zero is a real number that parses cleanly; whether it is an acceptable
    // amount is the caller's decision, not the parser's.
    expect(toBaseAmount("0", 6)).toBe(0n);
    expect(toBaseAmount("0.000", 6)).toBe(0n);
  });

  it("says no to a decimals count that cannot be a real mint", () => {
    expect(toBaseAmount("1", -1)).toBeNull();
    expect(toBaseAmount("1", 31)).toBeNull();
    expect(toBaseAmount("1", 1.5)).toBeNull();
  });

  it("refuses an absurdly long input instead of building a giant integer", () => {
    expect(toBaseAmount("9".repeat(41), 9)).toBeNull();
  });
});
