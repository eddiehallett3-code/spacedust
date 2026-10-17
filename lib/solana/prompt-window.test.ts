import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BLOCKHASH_APPROVAL_MARGIN_SLOTS,
  BLOCKHASH_PROMPT_MARGIN_SLOTS,
} from "./blockhash";

/**
 * "Reading the preview must not cost you the batch."
 *
 * A blockhash lives roughly 150 slots — about a minute — and a batch is signed
 * with the one captured when it was planned. So each flow has to decide, at the
 * click, whether the window it has left is enough. The two burn flows decided with
 * the *approval* margin, which is sized for a rebuild that is too expensive to do
 * on every click: it settles for ~30 seconds. On a phone that is the approval plus
 * the whole send burst, and the transactions at the end of the burst are the ones
 * that expire.
 *
 * These assert the wiring, not the rule, because the rule was already right in
 * `blockhash.ts` — the same shape of gap as `previewAction`, where the guard
 * existed and simply was not applied.
 */

const HOOKS = [
  "hooks/use-sweep.ts",
  "hooks/use-void.ts",
  "hooks/use-nft-burn.ts",
  "hooks/use-close.ts",
  "hooks/use-revoke.ts",
];

const source = (file: string): string =>
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

describe("every flow rebuilds against the prompt margin", () => {
  it("orders the two margins the way the names say", () => {
    expect(BLOCKHASH_PROMPT_MARGIN_SLOTS).toBeGreaterThan(
      BLOCKHASH_APPROVAL_MARGIN_SLOTS,
    );
    // And it cannot demand more life than the cluster offers, or every click would
    // rebuild forever without ever reaching the wallet.
    expect(BLOCKHASH_PROMPT_MARGIN_SLOTS).toBeLessThan(150);
  });

  for (const file of HOOKS) {
    it(`${file} uses the prompt margin, not the approval one`, () => {
      const text = source(file);

      expect(text).toContain("BLOCKHASH_PROMPT_MARGIN_SLOTS");
      expect(text).not.toContain("BLOCKHASH_APPROVAL_MARGIN_SLOTS");
    });

    it(`${file} replaces the preview when it rebuilds`, () => {
      const text = source(file);
      const start = text.indexOf("isBlockhashExpired(");
      const end = text.indexOf("const signed = await signTransactions", start);

      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);

      const rebuild = text.slice(start, end);

      // The bug this replaces: the new plan went into the ref and the panel went
      // on describing the previous batch — its transaction count, its warnings, its
      // rent — while the wallet was asked to sign the new one.
      expect(rebuild).toContain("packed: result.packed");
      expect(rebuild).toContain("simulations: result.simulations");
      expect(rebuild).toContain("warnings: result.warnings");
    });
  }

  /**
   * Payload is the exception, and deliberately so: its rebuild re-quotes Jupiter,
   * which takes seconds per token and can move the amounts. Rebuilding that on
   * every click would be worse than the short window it accepts — so if this test
   * starts failing because someone changed it, the question is whether that cost
   * was measured, not whether the test is right.
   */
  it("Payload keeps the approval margin, because a re-quote is not cheap", () => {
    const payload = source("hooks/use-payload.ts");

    expect(payload).toContain("BLOCKHASH_APPROVAL_MARGIN_SLOTS");
    expect(payload).not.toContain("BLOCKHASH_PROMPT_MARGIN_SLOTS");
  });
});
