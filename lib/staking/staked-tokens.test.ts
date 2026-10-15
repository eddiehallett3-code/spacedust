import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  LIQUID_STAKING_TOKENS,
  STAKED_POSITION_NOTE,
  stakedTokenFor,
} from "@/lib/staking/staked-tokens";

/**
 * "A curated list is only as good as its addresses."
 *
 * The registry is a claim about specific mints, so these tests are mostly about
 * the claim being *well-formed* rather than about any one lookup working: a mint
 * with a typo, a duplicate entry, or an empty protocol name all fail in the same
 * silent way — the lookup simply never matches, which looks exactly like "this
 * wallet holds no staking tokens".
 */

const MSOL = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";
const WSOL = "So11111111111111111111111111111111111111112";

describe("stakedTokenFor", () => {
  it("names the protocol for a known staking token", () => {
    expect(stakedTokenFor(MSOL)).toEqual({
      protocol: "Marinade",
      underlying: "SOL",
      symbol: "mSOL",
    });
  });

  it("returns null for a mint it does not know", () => {
    // The distinction the whole design rests on: null is "we cannot name this",
    // never "this is not staked". The caller keeps whatever `poolLike` decided.
    expect(stakedTokenFor(WSOL)).toBeNull();
    expect(stakedTokenFor("")).toBeNull();
    expect(stakedTokenFor("not base58")).toBeNull();
  });
});

describe("LIQUID_STAKING_TOKENS", () => {
  it("holds only real, well-formed mints", () => {
    for (const entry of LIQUID_STAKING_TOKENS) {
      // Throws on anything that is not valid base58 of the right length, which
      // is the point: a typo must not ship as a lookup that never fires.
      const key = new PublicKey(entry.mint);
      expect(key.toBytes()).toHaveLength(32);
      expect(key.toBase58()).toBe(entry.mint);
    }
  });

  it("has no duplicate mints, so none can shadow another", () => {
    const mints = LIQUID_STAKING_TOKENS.map((entry) => entry.mint);
    expect(new Set(mints).size).toBe(mints.length);
  });

  it("names a protocol, a symbol and an underlying for every entry", () => {
    for (const entry of LIQUID_STAKING_TOKENS) {
      expect(entry.protocol.trim().length).toBeGreaterThan(0);
      expect(entry.symbol.trim().length).toBeGreaterThan(0);
      expect(entry.underlying).toBe("SOL");
    }
  });

  it("does not list wrapped SOL, which the lst tag groups in with the rest", () => {
    // Jupiter's `lst` tag returns wSOL first, by holder count. It is not staked
    // anything, and listing it would label ordinary SOL as a staking position.
    expect(stakedTokenFor(WSOL)).toBeNull();
    expect(LIQUID_STAKING_TOKENS.some((entry) => entry.mint === WSOL)).toBe(
      false,
    );
  });
});

describe("STAKED_POSITION_NOTE", () => {
  it("says the position is not in the total", () => {
    expect(STAKED_POSITION_NOTE.toLowerCase()).toContain("out of the total");
  });

  it("calls it staking, and never a liquidity pool", () => {
    // The exact mislabel this feature corrects: these tokens used to be reported
    // under the pool note, which describes a share of a pool and names no
    // protocol. If this note starts saying "liquidity pool" the bug is back.
    expect(STAKED_POSITION_NOTE.toLowerCase()).toContain("staking");
    expect(STAKED_POSITION_NOTE.toLowerCase()).not.toContain("liquidity pool");
  });

  it("does not pretend the position is lost", () => {
    // It is reversible, just not from here. A note that read as a loss would be
    // as wrong as one that read as recoverable.
    expect(STAKED_POSITION_NOTE.toLowerCase()).toContain("unwinding");
    expect(STAKED_POSITION_NOTE.toLowerCase()).not.toContain("lost");
  });
});
