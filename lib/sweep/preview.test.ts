import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { previewAction } from "@/lib/sweep/preview";

/**
 * "The button must describe exactly what will be signed."
 *
 * Both burn flows build transactions for one selection and then sign *those*
 * transactions, whatever the checkboxes say at click time. So a preview that
 * outlives its selection is a lie — and in the case that matters, a dangerous
 * one: unticking an asset would still burn it.
 */

const base = {
  previousKey: "A,B",
  currentKey: "A,B",
  isBusy: false,
  hasSummary: false,
  hasPreview: true,
};

describe("previewAction", () => {
  it("leaves an untouched selection alone", () => {
    expect(previewAction(base)).toBe("none");
  });

  it("discards a preview when the selection moves under it", () => {
    // The case that burns something the user just unticked.
    expect(previewAction({ ...base, currentKey: "A" })).toBe("discard");
    expect(previewAction({ ...base, currentKey: "A,B,C" })).toBe("discard");
    expect(previewAction({ ...base, currentKey: "" })).toBe("discard");
  });

  it("only records the key when there is no preview to discard", () => {
    expect(previewAction({ ...base, currentKey: "A", hasPreview: false })).toBe(
      "remember",
    );
  });

  it("never interrupts a flow that is already in flight", () => {
    // Mid-signature the batch is chosen; yanking it would be worse than stale.
    expect(previewAction({ ...base, currentKey: "A", isBusy: true })).toBe("none");
  });

  it("never discards a finished run's summary", () => {
    // The result stays on screen until the user dismisses it, even if the
    // selection behind it changes — and a rescan changes it.
    expect(previewAction({ ...base, currentKey: "A", hasSummary: true })).toBe(
      "none",
    );
  });
});

/**
 * The rule only helps if the flows actually consult it.
 *
 * The NFT burn panel shipped without this guard — the rule already existed in
 * the Void, it was simply not wired into the new component — so the gap was not
 * in the rule but in its application. Assert the wiring, not just the rule.
 */
describe("both burn flows are wired to the guard", () => {
  for (const file of [
    "components/void/void-app.tsx",
    "components/void/nft-burn-panel.tsx",
  ]) {
    it(`${file} consults previewAction and acts on the verdict`, () => {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      expect(source).toContain("previewAction({");
      // Computing a verdict and ignoring it is the bug this replaces.
      expect(source).toMatch(/action === "discard"/);
    });
  }
});
