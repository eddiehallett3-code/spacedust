import { describe, expect, it } from "vitest";
import { assetIsGone, indexFlagsBurnt, isCoreHusk } from "@/lib/solana/liveness";
import type { NonFungibleAsset } from "@/types/token";

/**
 * This rule has two halves that pull in opposite directions, and getting either
 * wrong is invisible: a missing account is *not* always a dead asset, and a tiny
 * account is *not* always a live one. Both mistakes have now been made for real.
 */

const base: NonFungibleAsset = {
  id: "JEKMoZLzbHgsUwpNrDp7aDNKXNN432hJrbegzTTCLnwQ",
  name: "Pixel Guild - Golden Key",
  imageUri: null,
  imageMime: null,
  collection: null,
  compressed: false,
  interface: "V1_NFT",
  tokenAccount: "HDB6voVbH8skNEXH13bBqJ9tNk2DrtQ3eJ8AucFZan8d",
  program: "legacy",
  frozen: false,
  merkle: null,
  delegate: null,
};

/** A Core asset account, as the RPC returns it: base64, hundreds of bytes long. */
const assetAccount = { data: ["BRaddYsmnauD/gGa/GcxTiXZY1M2NgrCcX4LPseSVst2DAAAAFRoZSBSZWFsbUtpbkU", "base64"] };

describe("isCoreHusk", () => {
  it("recognises the one zero byte Core leaves behind", () => {
    expect(isCoreHusk(new Uint8Array([0]))).toBe(true);
    // Mainnet, verbatim: `space: 1`, `data: "AA=="`.
    expect(isCoreHusk([...Buffer.from("AA==", "base64")])).toBe(true);
  });

  it("does not mistake a live asset for one", () => {
    expect(isCoreHusk(new Uint8Array([1]))).toBe(false);
    expect(isCoreHusk(new Uint8Array([0, 0, 0, 0]))).toBe(false);
    expect(isCoreHusk(new Uint8Array([]))).toBe(false);
  });
});

describe("assetIsGone", () => {
  it("keeps a cNFT whose id has no account, because a leaf never has one", () => {
    // The regression: a cNFT's id is a merkle leaf, the RPC returned `null` for
    // it, and treating that as "destroyed" deleted every live cNFT from the
    // scan — including one the user still held and could not understand losing.
    const cnft: NonFungibleAsset = {
      ...base,
      compressed: true,
      tokenAccount: null,
      interface: "V1_NFT",
      merkle: {
        tree: "7MHNupVw45KV1JG3HxPPqUnCJoLzFxt3THMJsLjJRerz",
        leafId: 1172,
        dataHash: "3eNTexmWmu1cEYKhCsoXDCZJRSvgdujR1RQDGVa3t8H9",
        creatorHash: "98UuRrUaTrQF5gQocbrabinCDqmPh2UeyF9t7GwzNVCK",
        assetDataHash: null,
        flags: null,
      },
    };
    expect(assetIsGone(cnft, null)).toBe(false);
  });

  it("counts a missing account as gone for everything that should have one", () => {
    expect(assetIsGone(base, null)).toBe(true);
    expect(assetIsGone({ ...base, interface: "MplCoreAsset" }, null)).toBe(true);
  });

  it("counts a Core husk as gone, which is what a burn leaves", () => {
    const husk = { data: ["AA==", "base64"] };
    expect(assetIsGone({ ...base, interface: "MplCoreAsset" }, husk)).toBe(true);
    // The same rule for an SPL NFT would be a closed mint, so it holds there too.
    expect(assetIsGone(base, husk)).toBe(true);
  });

  it("keeps anything it cannot read", () => {
    // A live Core asset: present, hundreds of bytes.
    expect(assetIsGone({ ...base, interface: "MplCoreAsset" }, assetAccount)).toBe(false);
    // A parsed response rather than base64 tells us nothing, so it is not death.
    expect(
      assetIsGone({ ...base, interface: "MplCoreAsset" }, { data: { parsed: {} } }),
    ).toBe(false);
    expect(
      assetIsGone({ ...base, interface: "MplCoreAsset" }, { data: undefined }),
    ).toBe(false);
  });
});

/**
 * The index's own verdict. This is the only signal that reaches a cNFT — a leaf
 * has no account, so nothing can be read to contradict the index — which makes
 * it the one flag where being wrong in the wrong direction loses an asset the
 * user still owns.
 */
describe("indexFlagsBurnt", () => {
  it("accepts the flag when the index says true", () => {
    expect(indexFlagsBurnt({ burnt: true })).toBe(true);
  });

  it("leaves a live asset alone", () => {
    expect(indexFlagsBurnt({ burnt: false })).toBe(false);
  });

  it("does not treat a missing flag as burned", () => {
    expect(indexFlagsBurnt({})).toBe(false);
  });

  it("does not accept a truthy stand-in for true", () => {
    // "true", 1 and {} are all truthy. Only the boolean counts: this flag hides
    // an asset, and hiding one someone still owns is the failure to avoid.
    expect(indexFlagsBurnt({ burnt: "true" })).toBe(false);
    expect(indexFlagsBurnt({ burnt: 1 })).toBe(false);
    expect(indexFlagsBurnt({ burnt: {} })).toBe(false);
  });
});
