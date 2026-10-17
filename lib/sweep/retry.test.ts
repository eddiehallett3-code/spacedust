import { describe, expect, it } from "vitest";
import { planRetry } from "./retry";
import type { DustToken } from "@/types/token";
import type { TokenOutcome } from "@/types/sweep";

/**
 * Which tokens a retry brings back.
 *
 * The arithmetic is trivial; the decisions are not. A retry must never resurrect
 * a token Jupiter refused to route (it never failed — it was declined), must not
 * plan against a balance the wallet no longer holds, and must carry a partial
 * amount through, or "retry my 10% position" would silently become "sell it all".
 */

const TOKEN_ACCOUNT = "HDB6voVbH8skNEXH13bBqJ9tNk2DrtQ3eJ8AucFZan8d";

function token(mint: string, overrides: Partial<DustToken> = {}): DustToken {
  return {
    mint,
    name: mint.slice(0, 6),
    symbol: mint.slice(0, 4).toUpperCase(),
    logoUri: null,
    rawAmount: "1000",
    balance: 1000,
    decimals: 6,
    priceUsd: 1,
    priceChange24h: null,
    valueUsd: 1,
    program: "legacy",
    tokenAccount: TOKEN_ACCOUNT,
    hasNoPrice: false,
    hasTransferHook: false,
    hasTransferFee: false,
    frozen: false,
    poolLike: false,
    staked: null,
    ...overrides,
  };
}

function outcome(
  mint: string,
  status: TokenOutcome["status"],
  error: string | null = null,
): TokenOutcome {
  return {
    mint,
    symbol: mint.slice(0, 4).toUpperCase(),
    logoUri: null,
    status,
    signature: status === "success" ? "sig" : null,
    valueUsd: 1,
    inputAmount: "1000",
    outputAmount: status === "success" ? "1000" : null,
    outputAmountFormatted: status === "success" ? 1 : null,
    priceImpactPct: null,
    routeLabels: [],
    error,
    rentReclaimed: false,
  };
}

const A = token("MintA1111111111111111111111111111111111111");
const B = token("MintB1111111111111111111111111111111111111");
const C = token("MintC1111111111111111111111111111111111111");

describe("planRetry", () => {
  it("returns only the tokens whose transaction failed", () => {
    const plan = planRetry({
      outcomes: [
        outcome(A.mint, "success"),
        outcome(B.mint, "failed", "Blockhash not found"),
        outcome(C.mint, "success"),
      ],
      tokens: [A, B, C],
    });

    expect(plan?.tokens.map((t) => t.mint)).toEqual([B.mint]);
  });

  it("keeps the scan's order, so the retry reads like the run it repeats", () => {
    const plan = planRetry({
      outcomes: [outcome(C.mint, "failed"), outcome(A.mint, "failed")],
      tokens: [A, B, C],
    });

    expect(plan?.tokens.map((t) => t.mint)).toEqual([A.mint, C.mint]);
  });

  it("carries a partial amount, and only for the tokens it retries", () => {
    const plan = planRetry({
      outcomes: [outcome(A.mint, "failed"), outcome(B.mint, "success")],
      tokens: [A, B],
      amounts: new Map([
        [A.mint, "250"],
        [B.mint, "900"],
      ]),
    });

    expect([...plan!.amounts]).toEqual([[A.mint, "250"]]);
  });

  it("has nothing to do when every token landed", () => {
    expect(
      planRetry({
        outcomes: [outcome(A.mint, "success"), outcome(B.mint, "success")],
        tokens: [A, B],
      }),
    ).toBeNull();
  });

  it("does not retry a token the planner skipped", () => {
    // `skipped` means it fitted in no transaction, not that it failed on chain.
    expect(
      planRetry({
        outcomes: [outcome(A.mint, "skipped"), outcome(B.mint, "success")],
        tokens: [A, B],
      }),
    ).toBeNull();
  });

  it("drops a failure the wallet no longer holds", () => {
    // The scan is the authority on what exists; a mint missing from it has been
    // moved or closed since, and planning against it would fail the whole retry.
    expect(
      planRetry({
        outcomes: [outcome(A.mint, "failed")],
        tokens: [B, C],
      }),
    ).toBeNull();
  });

  it("keeps the failures it can still see when others have gone", () => {
    const plan = planRetry({
      outcomes: [outcome(A.mint, "failed"), outcome("Gone111111111111111111111111111111111111", "failed")],
      tokens: [A, B],
    });

    expect(plan?.tokens.map((t) => t.mint)).toEqual([A.mint]);
  });
});
