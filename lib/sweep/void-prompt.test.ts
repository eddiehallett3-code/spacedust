import { describe, expect, it } from "vitest";
import { countTokensLeftBehind } from "@/lib/sweep/void-prompt";

/**
 * "Left behind" means left behind **by this sweep**.
 *
 * The first version counted every unroutable token in the wallet, so a clean
 * two-token sweep still produced "1 token the sweeper left behind" because an
 * unpriced token was sitting in the wallet that had never been selected.
 * Accurate wording on a false trigger is still a false message.
 */

const A = "AAA";
const B = "BBB";
const UNPRICED = "ZZZ";
const UNROUTABLE = "YYY";
const ok = (mint: string) => ({ mint, status: "success" as const });
const failed = (mint: string) => ({ mint, status: "failed" as const });

describe("countTokensLeftBehind", () => {
  it("is zero after a clean sweep, even with unroutable tokens in the wallet", () => {
    expect(
      countTokensLeftBehind({
        summary: { dryRun: false },
        unroutableMints: [UNPRICED],
        outcomes: [ok(A), ok(B)],
      }),
    ).toBe(0);

    expect(
      countTokensLeftBehind({
        summary: { dryRun: false },
        unroutableMints: [UNPRICED, UNROUTABLE],
        outcomes: [ok(A), ok(B)],
      }),
    ).toBe(0);
  });

  it("counts a token the sweep attempted and could not route", () => {
    expect(
      countTokensLeftBehind({
        summary: { dryRun: false },
        unroutableMints: [UNROUTABLE],
        outcomes: [ok(A), failed(UNROUTABLE)],
      }),
    ).toBe(1);
  });

  it("counts a token that was skipped", () => {
    expect(
      countTokensLeftBehind({
        summary: { dryRun: false },
        unroutableMints: [UNPRICED],
        outcomes: [ok(A), { mint: UNPRICED, status: "skipped" as const }],
      }),
    ).toBe(1);
  });

  it("does not nudge a routable token toward a burn", () => {
    // Failed on slippage but sellable: the per-token failure list covers it,
    // and the right advice is "try again", not "destroy it".
    expect(
      countTokensLeftBehind({
        summary: { dryRun: false },
        unroutableMints: [],
        outcomes: [ok(A), failed(B)],
      }),
    ).toBe(0);
  });

  it("offers nothing before a real sweep has finished", () => {
    expect(
      countTokensLeftBehind({
        summary: { dryRun: true },
        unroutableMints: [UNPRICED],
        outcomes: [failed(UNPRICED)],
      }),
    ).toBe(0);

    expect(
      countTokensLeftBehind({
        summary: null,
        unroutableMints: [UNPRICED],
        outcomes: [failed(UNPRICED)],
      }),
    ).toBe(0);
  });
});
