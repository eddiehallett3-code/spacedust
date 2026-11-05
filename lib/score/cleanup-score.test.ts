import { describe, expect, it } from "vitest";
import { scoreWallet, type ScoreToken } from "./cleanup-score";

/**
 * The score decides what a person is told about their own wallet, so the tests are
 * about honesty: an empty wallet is perfect, a missing reading is not a zero, and
 * no single factor can run away with the number.
 */

const dust = (overrides: Partial<ScoreToken> = {}): ScoreToken => ({
  valueUsd: 0,
  hasNoPrice: true,
  poolLike: false,
  ...overrides,
});

const worth = (usd: number, overrides: Partial<ScoreToken> = {}): ScoreToken => ({
  valueUsd: usd,
  hasNoPrice: false,
  poolLike: false,
  ...overrides,
});

describe("scoreWallet", () => {
  it("gives a clean wallet 100", () => {
    const result = scoreWallet({
      tokens: [worth(12)],
      emptyRentLamports: 0,
      approvalsCount: 0,
      solPriceUsd: 150,
    });

    expect(result.score).toBe(100);
    expect(result.band.label).toBe("Tidy");
    expect(result.factors.every((factor) => factor.points === 0)).toBe(true);
  });

  it("scores unsellable holdings, but not pool shares or staking positions", () => {
    const result = scoreWallet({
      tokens: [
        dust(),
        dust(),
        dust({ poolLike: true }),
        dust({ staked: true }),
        dust({ frozen: true }),
      ],
      emptyRentLamports: 0,
      approvalsCount: 0,
    });

    const deadWeight = result.factors.find((f) => f.key === "dead-weight");
    expect(deadWeight?.points).toBe(4); // two plain dust holdings at 2 points each
    expect(result.score).toBe(96);
  });

  it("caps dead weight so a wallet of dust cannot alone sink the score", () => {
    const tokens = Array.from({ length: 60 }, () => dust());
    const result = scoreWallet({ tokens, emptyRentLamports: 0, approvalsCount: 0 });

    const deadWeight = result.factors.find((f) => f.key === "dead-weight");
    expect(deadWeight?.points).toBe(deadWeight?.max);
    expect(result.score).toBe(100 - 25);
  });

  it("only counts a danger hazard when there is value to lose", () => {
    const danger = { severity: "danger" as const };
    const warning = { severity: "warning" as const };

    const result = scoreWallet({
      tokens: [
        worth(500, { hazards: [danger] }),
        worth(0.2, { hazards: [danger] }), // under a dollar: nothing to take
        worth(500, { hazards: [warning] }), // a warning is not a threat
      ],
      emptyRentLamports: 0,
      approvalsCount: 0,
    });

    expect(result.factors.find((f) => f.key === "at-risk")?.points).toBe(5);
  });

  it("treats unread approvals as unjudged, not as zero", () => {
    const read = scoreWallet({ tokens: [], emptyRentLamports: 0, approvalsCount: 0 });
    const unread = scoreWallet({ tokens: [], emptyRentLamports: 0, approvalsCount: null });

    expect(read.score).toBe(100);
    expect(unread.score).toBe(100);
    expect(unread.factors.find((f) => f.key === "approvals")?.detail).toContain("Not checked");
  });

  it("scores standing approvals", () => {
    const result = scoreWallet({ tokens: [], emptyRentLamports: 0, approvalsCount: 2 });
    expect(result.factors.find((f) => f.key === "approvals")?.points).toBe(8);
  });

  it("scores idle rent on value, and caps it", () => {
    const small = scoreWallet({
      tokens: [],
      emptyRentLamports: 0.05e9, // ~$7.50 at $150
      approvalsCount: 0,
      solPriceUsd: 150,
    });
    const large = scoreWallet({
      tokens: [],
      emptyRentLamports: 5e9, // far past the ceiling
      approvalsCount: 0,
      solPriceUsd: 150,
    });

    expect(small.factors.find((f) => f.key === "idle-rent")?.points).toBe(5);
    expect(large.factors.find((f) => f.key === "idle-rent")?.points).toBe(30);
  });

  it("still scores idle rent when no SOL price is available", () => {
    const result = scoreWallet({
      tokens: [],
      emptyRentLamports: 0.25e9,
      approvalsCount: 0,
      solPriceUsd: null,
    });

    expect(result.factors.find((f) => f.key === "idle-rent")?.points).toBe(30);
  });

  it("never goes below zero, even with every factor maxed", () => {
    const tokens = [
      ...Array.from({ length: 40 }, () => dust()),
      ...Array.from({ length: 10 }, () => worth(50, { hazards: [{ severity: "danger" }] })),
    ];
    const result = scoreWallet({
      tokens,
      emptyRentLamports: 10e9,
      excessRentLamports: 1e9,
      approvalsCount: 20,
      solPriceUsd: 150,
    });

    expect(result.score).toBe(0);
    expect(result.band.label).toBe("Mostly stuck");
  });

  it("adds excess rent to idle rent, since both are reachable today", () => {
    const result = scoreWallet({
      tokens: [],
      emptyRentLamports: 0.1e9,
      excessRentLamports: 0.15e9,
      approvalsCount: 0,
      solPriceUsd: 150,
    });

    // 0.1 + 0.15 = 0.25 SOL, which at $150 is $37.50 — three quarters of the $50
    // ceiling, so 23 of the 30 points.
    expect(result.factors.find((f) => f.key === "idle-rent")?.points).toBe(23);
  });
});
