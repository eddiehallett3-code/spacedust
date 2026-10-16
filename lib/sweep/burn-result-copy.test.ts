import { describe, expect, it } from "vitest";
import {
  burnResultCopy,
  countBurned,
  type Burnableish,
} from "@/lib/sweep/burn-result-copy";

/**
 * "The report has to describe the batch, not the tab it was read on."
 *
 * A user burned an NFT and a cNFT in one transaction and was told "2 cNFTs
 * burned — nothing returned, a compressed NFT holds no rent". Wrong count, wrong
 * noun, and a rent claim contradicted by the NFT that had just returned its rent.
 * The screen took its wording from the open tab, which knows nothing about what
 * was in the batch.
 *
 * These cases are the shapes a batch can take, plus the one nobody had thought
 * about: all three classes mixed.
 */

function burned(
  overrides: Partial<Burnableish> = {},
): Burnableish {
  return { compressed: false, interface: "V1_NFT", status: "burned", ...overrides };
}

const cnft = (overrides: Partial<Burnableish> = {}) =>
  burned({ compressed: true, ...overrides });
const core = (overrides: Partial<Burnableish> = {}) =>
  burned({ interface: "MplCoreAsset", ...overrides });

describe("burnResultCopy", () => {
  it("names both classes when a batch spans them", () => {
    const copy = burnResultCopy(countBurned([burned(), cnft()]), {
      failed: 0,
      rentLamports: 8_264_760,
    });

    expect(copy.headline).toBe("1 NFT and 1 cNFT sent into The Void");
    // The rent line has to carry both halves: one returned rent, one could not.
    expect(copy.detail).toContain("SOL of rent reclaimed");
    expect(copy.detail).toContain("a compressed NFT returns nothing");
  });

  it("keeps the old wording when the batch is one class", () => {
    const cnfTs = burnResultCopy(countBurned([cnft(), cnft()]), {
      failed: 0,
      rentLamports: 0,
    });
    expect(cnfTs.headline).toBe("2 cNFTs sent into The Void");
    expect(cnfTs.detail).toBe("Nothing returned — a compressed NFT holds no rent");

    const nfts = burnResultCopy(countBurned([burned(), burned()]), {
      failed: 0,
      rentLamports: 16_529_520,
    });
    expect(nfts.headline).toBe("2 NFTs sent into The Void");
    expect(nfts.detail).not.toContain("compressed");
  });

  it("says what a Core husk leaves behind, and does not claim its account closed", () => {
    const copy = burnResultCopy(countBurned([core()]), {
      failed: 0,
      rentLamports: 1_132_840,
    });

    expect(copy.headline).toBe("1 NFT sent into The Void");
    expect(copy.note).toContain("one-byte husk");
    // The SPL sentence would be a lie for a Core asset: nothing was closed.
    expect(copy.note).not.toContain("token account is closed");
  });

  it("describes all three classes at once", () => {
    const copy = burnResultCopy(countBurned([burned(), cnft(), core()]), {
      failed: 0,
      rentLamports: 9_397_600,
    });

    expect(copy.headline).toBe("2 NFTs and 1 cNFT sent into The Void");
    expect(copy.detail).toContain("of rent reclaimed");
    expect(copy.note).toContain("token account is closed");
    expect(copy.note).toContain("one-byte husk");
    expect(copy.note).toContain("leaves nothing behind");
  });

  it("reports failures without borrowing a class's noun", () => {
    const copy = burnResultCopy(
      countBurned([burned(), cnft({ status: "failed" })]),
      { failed: 1, rentLamports: 2_039_280 },
    );

    expect(copy.headline).toBe("1 NFT sent into The Void · 1 asset did not go");
    expect(copy.note).not.toContain("leaves nothing behind");
  });

  it("never promises rent when only leaves burned", () => {
    const copy = burnResultCopy(countBurned([cnft()]), {
      failed: 0,
      rentLamports: 0,
    });
    expect(copy.detail).not.toContain("reclaimed");
  });
});
