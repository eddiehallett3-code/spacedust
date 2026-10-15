import { describe, expect, it } from "vitest";
import { looksLikeCollectible, toCollectibleAsset } from "./collectible-shape";
import type { DustToken } from "@/types/token";

/**
 * The discriminator between a collectible and dust.
 *
 * `decimals === 0` is the shape of an NFT and also of a collectible minted as a
 * fungible, so shape alone cannot decide it. The market can: a 0-decimal asset
 * with a price is something a sweep can move, and one with no price is not.
 *
 * Getting this wrong is not cosmetic in either direction. Treated as dust, a
 * collectible is listed as a token and pre-ticked for burning. Treated as a
 * collectible, a genuinely tradeable 0-decimal token would be hidden from the
 * sweep — which is why the price, not the shape, is the test.
 */

const dust: DustToken = {
  mint: "9n3YAi3WWG",
  name: "Jupiter x MB",
  symbol: "",
  logoUri: null,
  rawAmount: "71334",
  balance: 71334,
  decimals: 0,
  priceUsd: null,
  priceChange24h: null,
  valueUsd: 0,
  program: "legacy",
  tokenAccount: "ATAtokenaccountaddress",
  hasNoPrice: true,
  hasTransferHook: false,
  hasTransferFee: false,
  frozen: false,
  poolLike: false,
  staked: null,
};

describe("looksLikeCollectible", () => {
  it("catches the case this exists for: no decimals, no market", () => {
    expect(looksLikeCollectible({ decimals: 0, hasNoPrice: true })).toBe(true);
  });

  it("does not hide a 0-decimal asset that has a market", () => {
    // Something people trade at a price is not a collectible here, whatever its
    // decimals say.
    expect(looksLikeCollectible({ decimals: 0, hasNoPrice: false })).toBe(false);
  });

  it("leaves ordinary tokens alone, priced or not", () => {
    expect(looksLikeCollectible({ decimals: 6, hasNoPrice: true })).toBe(false);
    expect(looksLikeCollectible({ decimals: 9, hasNoPrice: false })).toBe(false);
  });
});

describe("toCollectibleAsset", () => {
  it("keeps the index's own word for the interface, and the scan's account", () => {
    const asset = toCollectibleAsset(dust);

    expect(asset).toEqual({
      id: dust.mint,
      name: dust.name,
      imageUri: dust.logoUri,
      imageMime: null,
      collection: null,
      compressed: false,
      // Not relabelled to V1_NFT: the burn path reads this to choose its route,
      // and a plain SPL burn is what this one needs.
      interface: "FungibleAsset",
      tokenAccount: dust.tokenAccount,
      program: dust.program,
      frozen: dust.frozen,
      merkle: null,
      delegate: null,
    });
  });

  it("carries frozen across, so an unfreezable asset is never offered", () => {
    expect(toCollectibleAsset({ ...dust, frozen: true }).frozen).toBe(true);
  });
});
