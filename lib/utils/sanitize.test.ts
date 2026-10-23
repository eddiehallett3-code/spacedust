import { describe, expect, it } from "vitest";
import {
  baseAmountToNumber,
  sanitizeImageUri,
  sanitizeLogoUri,
  toBaseAmount,
} from "./sanitize";

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

/**
 * The other direction, used everywhere a balance or output is displayed.
 *
 * The bug this locks: the divisor was clamped at 10^15 while decimals up to 30
 * were accepted, so an 18-decimal amount came back 1000× too large. No SPL mint
 * has more than nine decimals today, which is exactly why the error could sit
 * there unnoticed — the function's contract says "scale by the decimals it was
 * given", so it must.
 */
describe("baseAmountToNumber", () => {
  it("scales by the real decimals", () => {
    expect(baseAmountToNumber(1_000_000n, 6)).toBe(1);
    expect(baseAmountToNumber(1_000_000_000n, 9)).toBe(1);
  });

  it("does not cap the divisor at 15 decimals", () => {
    expect(baseAmountToNumber(1_000_000_000_000_000_000n, 18)).toBe(1);
    expect(baseAmountToNumber(1_000_000_000_000_000_000_000_000n, 24)).toBe(
      1,
    );
  });

  it("rejects a decimals count that is not a real one", () => {
    expect(baseAmountToNumber(1n, -1)).toBeNull();
    expect(baseAmountToNumber(1n, 31)).toBeNull();
    expect(baseAmountToNumber(1n, 1.5)).toBeNull();
  });
});

describe("sanitizeLogoUri", () => {
  it("accepts https on a host the app already renders images from", () => {
    expect(sanitizeLogoUri("https://cdn.jup.ag/tokens/x.png")).toBe(
      "https://cdn.jup.ag/tokens/x.png",
    );
    expect(sanitizeLogoUri("https://abc.arweave.net/x.png")).toBe(
      "https://abc.arweave.net/x.png",
    );
  });

  it("refuses plain http, which an enforced img-src would block anyway", () => {
    expect(sanitizeLogoUri("http://cdn.jup.ag/tokens/x.png")).toBeNull();
  });

  it("refuses a host nobody vetted, which would turn every view into a beacon", () => {
    // Anyone can publish token metadata. An arbitrary logo host means every
    // wallet that renders the list reports its IP to whoever wrote it.
    expect(sanitizeLogoUri("https://tracker.example/logo.png")).toBeNull();
  });

  it("refuses a lookalike suffix", () => {
    expect(sanitizeLogoUri("https://notjup.ag/x.png")).toBeNull();
    expect(sanitizeLogoUri("https://jup.ag.evil.example/x.png")).toBeNull();
  });
});

describe("sanitizeImageUri", () => {
  it("rewrites ipfs:// to a gateway and keeps https artwork", () => {
    expect(sanitizeImageUri("ipfs://QmHash/1.png")).toBe(
      "https://ipfs.io/ipfs/QmHash/1.png",
    );
    expect(sanitizeImageUri("https://example.example/a.png")).toBe(
      "https://example.example/a.png",
    );
  });

  it("refuses plain http and non-http schemes", () => {
    expect(sanitizeImageUri("http://example.example/a.png")).toBeNull();
    expect(sanitizeImageUri("javascript:alert(1)")).toBeNull();
    expect(sanitizeImageUri("data:image/png;base64,AAAA")).toBeNull();
  });
});
