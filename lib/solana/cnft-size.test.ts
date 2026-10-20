import { describe, expect, it } from "vitest";
import {
  CNFT_INLINE_PROOF_BUDGET_BYTES,
  CNFT_PROOF_NODE_BYTES,
  cnftBurnBaseBytes,
  cnftFitsInline,
  cnftInlineProofLimit,
} from "@/lib/solana/cnft-size";
import type { NonFungibleAsset } from "@/types/token";

/**
 * The boundary between "burns in one transaction" and "needs an address lookup
 * table" is a measured size, not a guess: one proof node adds 33 bytes, so each
 * leaf version has exactly one last proof length that fits. These tests pin
 * those edges. If the numbers drift, the grid and the planner must drift
 * together — a card that promises a direct burn and a planner that then asks for
 * a table is worse than either answer on its own.
 */

function asset(
  proofNodes: number | null | undefined,
  options: { v2?: boolean; collection?: boolean; delegated?: boolean } = {},
): NonFungibleAsset {
  return {
    id: "JEKMoZLzbHgsUwpNrDp7aDNKXNN432hJrbegzTTCLnwQ",
    name: "Compressed leaf",
    imageUri: null,
    imageMime: null,
    collection: options.collection
      ? { address: "So11111111111111111111111111111111111111112", name: null }
      : null,
    compressed: true,
    interface: options.v2 ? "MplBubblegumV2" : "V1_NFT",
    tokenAccount: null,
    program: "legacy",
    frozen: false,
    merkle: {
      tree: "6Pmq7XjWZ8kXK4t8bY9ZcV3sQ2nL5rM1pA7dF6hJ8kL",
      leafId: 1,
      dataHash: "11111111111111111111111111111111",
      creatorHash: "11111111111111111111111111111111",
      assetDataHash: options.v2 ? "11111111111111111111111111111111" : null,
      flags: options.v2 ? 0 : null,
      proofNodes,
    },
    delegate: options.delegated
      ? "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi"
      : null,
  };
}

describe("cnftBurnBaseBytes", () => {
  it("uses the measured base for each leaf shape", () => {
    expect(cnftBurnBaseBytes({ v2: false, hasCollection: false })).toBe(514);
    expect(cnftBurnBaseBytes({ v2: true, hasCollection: false })).toBe(587);
    expect(cnftBurnBaseBytes({ v2: true, hasCollection: true })).toBe(651);
  });

  it("ignores a collection on a V1 leaf, whose burn never carries it", () => {
    expect(cnftBurnBaseBytes({ v2: false, hasCollection: true })).toBe(514);
  });

  it("charges one account for a distinct delegate", () => {
    expect(
      cnftBurnBaseBytes({ v2: false, hasCollection: false, hasDelegate: true }),
    ).toBe(547);
    expect(
      cnftBurnBaseBytes({ v2: true, hasCollection: false, hasDelegate: true }),
    ).toBe(620);
    expect(
      cnftBurnBaseBytes({ v2: true, hasCollection: true, hasDelegate: true }),
    ).toBe(684);
  });
});

describe("cnftInlineProofLimit", () => {
  it("derives the last fitting proof from the packer's own budget", () => {
    expect(CNFT_INLINE_PROOF_BUDGET_BYTES).toBe(1192);
    expect(CNFT_PROOF_NODE_BYTES).toBe(33);
    expect(cnftInlineProofLimit({ v2: false, hasCollection: false })).toBe(20);
    expect(cnftInlineProofLimit({ v2: true, hasCollection: false })).toBe(18);
    expect(cnftInlineProofLimit({ v2: true, hasCollection: true })).toBe(16);
  });

  it("moves the boundary one node for a distinct delegate", () => {
    expect(
      cnftInlineProofLimit({
        v2: false,
        hasCollection: false,
        hasDelegate: true,
      }),
    ).toBe(19);
    expect(
      cnftInlineProofLimit({
        v2: true,
        hasCollection: false,
        hasDelegate: true,
      }),
    ).toBe(17);
    expect(
      cnftInlineProofLimit({
        v2: true,
        hasCollection: true,
        hasDelegate: true,
      }),
    ).toBe(15);
  });

  it("places the boundary where the next node would cross the budget", () => {
    for (const shape of [
      { v2: false, hasCollection: false },
      { v2: true, hasCollection: false },
      { v2: true, hasCollection: true },
    ]) {
      const base = cnftBurnBaseBytes(shape);
      const limit = cnftInlineProofLimit(shape);
      expect(base + CNFT_PROOF_NODE_BYTES * limit).toBeLessThanOrEqual(
        CNFT_INLINE_PROOF_BUDGET_BYTES,
      );
      expect(
        base + CNFT_PROOF_NODE_BYTES * (limit + 1),
      ).toBeGreaterThan(CNFT_INLINE_PROOF_BUDGET_BYTES);
    }
  });
});

describe("cnftFitsInline", () => {
  it("accepts the last fitting proof length and refuses the next one", () => {
    expect(cnftFitsInline(asset(20))).toBe(true);
    expect(cnftFitsInline(asset(21))).toBe(false);

    expect(cnftFitsInline(asset(18, { v2: true }))).toBe(true);
    expect(cnftFitsInline(asset(19, { v2: true }))).toBe(false);

    expect(cnftFitsInline(asset(16, { v2: true, collection: true }))).toBe(true);
    expect(cnftFitsInline(asset(17, { v2: true, collection: true }))).toBe(
      false,
    );
  });

  it("accounts for the delegate account when deciding the boundary", () => {
    expect(cnftFitsInline(asset(19, { delegated: true }))).toBe(true);
    expect(cnftFitsInline(asset(20, { delegated: true }))).toBe(false);

    expect(cnftFitsInline(asset(17, { v2: true, delegated: true }))).toBe(true);
    expect(cnftFitsInline(asset(18, { v2: true, delegated: true }))).toBe(false);

    expect(
      cnftFitsInline(asset(15, { v2: true, collection: true, delegated: true })),
    ).toBe(true);
    expect(
      cnftFitsInline(asset(16, { v2: true, collection: true, delegated: true })),
    ).toBe(false);
  });

  it("does not turn an unknown proof length into a lookup-table claim", () => {
    // Unknown is not evidence of a long proof: the planner measures it later.
    expect(cnftFitsInline(asset(undefined))).toBeNull();
    expect(cnftFitsInline(asset(null))).toBeNull();
    expect(cnftFitsInline(asset(-1))).toBeNull();
    expect(cnftFitsInline(asset(2.5))).toBeNull();
  });
});
