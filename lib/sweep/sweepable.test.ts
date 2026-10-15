import { describe, expect, it } from "vitest";
import { isSweepableToken } from "@/lib/sweep/sweepable";

/**
 * "One rule, both screens."
 *
 * The read-only scan promises a total; the sweeper then has to produce it. These
 * tests exist because the two disagreed: a recognised staking token was excluded
 * from the scan's total but still listed, priced and sellable in the sweeper —
 * so mSOL could be sold in a dust sweep while the scan said a sweep would not
 * touch it. Nothing failed loudly, which is the point.
 */

/** The default is an ordinary, sellable token. */
function token(overrides = {}) {
  return {
    staked: null,
    poolLike: false,
    frozen: false,
    hasTransferHook: false,
    ...overrides,
  };
}

describe("isSweepableToken", () => {
  it("accepts an ordinary token", () => {
    expect(isSweepableToken(token())).toBe(true);
  });

  it("refuses a named staking token", () => {
    // The case that made this file necessary: an LST is a normal SPL token with
    // a real price, so nothing else on the row would stop it being swept.
    expect(
      isSweepableToken(
        token({
          staked: { protocol: "Marinade", underlying: "SOL", symbol: "mSOL" },
        }),
      ),
    ).toBe(false);
  });

  it("refuses a staking token even when poolLike is false", () => {
    // The registry is the stronger signal and must not depend on the mint
    // happening to look program-controlled.
    expect(
      isSweepableToken(
        token({
          staked: { protocol: "Jito", underlying: "SOL", symbol: "JitoSOL" },
          poolLike: false,
        }),
      ),
    ).toBe(false);
  });

  it("refuses a program-controlled mint", () => {
    expect(isSweepableToken(token({ poolLike: true }))).toBe(false);
  });

  it("refuses frozen and transfer-hooked holdings", () => {
    expect(isSweepableToken(token({ frozen: true }))).toBe(false);
    expect(isSweepableToken(token({ hasTransferHook: true }))).toBe(false);
  });

  it("refuses anything that is both a staking token and frozen", () => {
    expect(
      isSweepableToken(
        token({
          staked: { protocol: "Lido", underlying: "SOL", symbol: "stSOL" },
          frozen: true,
        }),
      ),
    ).toBe(false);
  });
});
