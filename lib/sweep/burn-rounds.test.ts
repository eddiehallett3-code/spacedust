import { describe, expect, it } from "vitest";
import { buildBurnRounds } from "@/lib/sweep/burn-rounds";
import type { NonFungibleAsset } from "@/types/token";

function cnft(id: string, tree: string): NonFungibleAsset {
  return {
    id,
    name: id,
    imageUri: null,
    imageMime: null,
    collection: null,
    compressed: true,
    interface: "V1_NFT",
    tokenAccount: null,
    program: "legacy",
    frozen: false,
    merkle: {
      tree,
      leafId: 1,
      dataHash: "11111111111111111111111111111111",
      creatorHash: "11111111111111111111111111111111",
      assetDataHash: null,
      flags: null,
    },
    delegate: null,
  };
}

function nft(id: string): NonFungibleAsset {
  return {
    ...cnft(id, "unused"),
    compressed: false,
    merkle: null,
    interface: "V1_NFT",
    tokenAccount: "11111111111111111111111111111111",
  };
}

describe("buildBurnRounds", () => {
  it("gives each leaf from one tree its own round", () => {
    const rounds = buildBurnRounds([
      cnft("A", "tree-1"),
      cnft("B", "tree-1"),
      cnft("C", "tree-1"),
      cnft("D", "tree-1"),
    ]);

    expect(rounds.map((round) => round.map((asset) => asset.id))).toEqual([
      ["A"],
      ["B"],
      ["C"],
      ["D"],
    ]);
  });

  it("keeps different trees in the same round", () => {
    const rounds = buildBurnRounds([
      cnft("A", "tree-1"),
      cnft("B", "tree-2"),
      cnft("C", "tree-1"),
      cnft("D", "tree-2"),
    ]);

    expect(rounds.map((round) => round.map((asset) => asset.id))).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
  });

  it("puts uncompressed NFTs in the first round", () => {
    const rounds = buildBurnRounds([
      nft("N"),
      cnft("A", "tree-1"),
      cnft("B", "tree-1"),
    ]);

    expect(rounds.map((round) => round.map((asset) => asset.id))).toEqual([
      ["N", "A"],
      ["B"],
    ]);
  });

  it("returns one round when every asset is independent", () => {
    const rounds = buildBurnRounds([nft("N"), nft("M")]);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.map((asset) => asset.id)).toEqual(["N", "M"]);
  });
});
