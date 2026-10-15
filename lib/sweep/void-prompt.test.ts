import { describe, expect, it } from "vitest";
import {
  countTokensLeftBehind,
  preselectForVoid,
} from "@/lib/sweep/void-prompt";

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
/**
 * The Void pre-ticks illiquid tokens, because after a sweep the common case
 * really is "yes, burn the rest". A tick is consent to destroy the asset, so
 * that offer has exactly one exception: a token with no decimals.
 *
 * `decimals === 0` is the shape of an NFT, and it is also the shape of a
 * collectible minted as a fungible. A Jupiter collectible with no market
 * arrives from the indexer typed as a fungible, unpriced, and therefore lands
 * in the pre-ticked set — an asset that may well be a collectible, already
 * selected for destruction before the user has looked at it. It must stay
 * listed and selectable; it must not be ticked on their behalf.
 */
describe("preselectForVoid", () => {
  const fungible = (mint: string) => ({ mint, decimals: 6 });
  const zeroDecimal = (mint: string) => ({ mint, decimals: 0 });

  it("pre-ticks illiquid tokens that have decimals", () => {
    expect(preselectForVoid([fungible(A), fungible(B)])).toEqual([A, B]);
  });

  it("never pre-ticks a 0-decimal token — the collectible-minted-as-fungible case", () => {
    expect(preselectForVoid([fungible(A), zeroDecimal("MB")])).toEqual([A]);
  });

  it("preselecting none is not the same as listing none", () => {
    // The caller keeps listing every candidate and ticks only what this
    // returns, so an empty result means "nothing ticked", never "nothing shown".
    expect(preselectForVoid([zeroDecimal("MB")])).toEqual([]);
    expect(preselectForVoid([])).toEqual([]);
  });
});
