import { describe, expect, it } from "vitest";
import {
  HOLDER_COLLECTION,
  HOLDER_REQUIRED,
  countFromIndexResponse,
  holderStatus,
  unavailableStatus,
} from "./holder-membership";

/**
 * The waiver decides a fee, so the edge is where it matters: nine, ten, and the
 * counts an index can return that are not counts at all.
 */
describe("holderStatus", () => {
  it("entitles at exactly the requirement", () => {
    const status = holderStatus(10);
    expect(status.entitled).toBe(true);
    expect(status.held).toBe(10);
    expect(status.required).toBe(HOLDER_REQUIRED);
    expect(status.collection).toBe(HOLDER_COLLECTION);
  });

  it("does not entitle one short", () => {
    expect(holderStatus(9).entitled).toBe(false);
    expect(holderStatus(9).held).toBe(9);
  });

  it("does not entitle on zero", () => {
    expect(holderStatus(0).entitled).toBe(false);
  });

  it("caps the reported count at the requirement", () => {
    // A wallet with 300 Turtles is a holder, and "300 of 10" is not a sentence
    // the UI should ever have to render.
    expect(holderStatus(300)).toEqual({
      entitled: true,
      held: HOLDER_REQUIRED,
      required: HOLDER_REQUIRED,
      collection: HOLDER_COLLECTION,
    });
  });

  it("treats nonsense counts as zero rather than as a holder", () => {
    for (const value of [Number.NaN, -5, 0.4, Number.POSITIVE_INFINITY]) {
      const status = holderStatus(value);
      expect(status.entitled).toBe(false);
      expect(status.held).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("countFromIndexResponse", () => {
  it("trusts total over items", () => {
    // The index pages ten items and reports 42 in total; the answer is 42.
    expect(countFromIndexResponse({ total: 42, items: new Array(10).fill({}) })).toBe(42);
  });

  it("falls back to the item count when total is absent", () => {
    expect(countFromIndexResponse({ items: new Array(3).fill({}) })).toBe(3);
  });

  it("reads an empty response as zero", () => {
    expect(countFromIndexResponse({})).toBe(0);
    expect(countFromIndexResponse({ total: Number.NaN, items: undefined })).toBe(0);
  });
});

describe("unavailableStatus", () => {
  it("never entitles, so a failed check charges the normal fee", () => {
    const status = unavailableStatus();
    expect(status.entitled).toBe(false);
    expect(status.held).toBe(0);
    expect(status.required).toBe(HOLDER_REQUIRED);
  });
});
