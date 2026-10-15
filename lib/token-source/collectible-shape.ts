import type { DustToken, NonFungibleAsset } from "@/types/token";

/**
 * The shape of a collectible that an index calls fungible.
 *
 * `decimals === 0` is the shape of an NFT. It is also the shape of a collectible
 * minted as a fungible — a Jupiter collectible, a points token, a receipt — and an
 * index cannot tell those apart: it arrives typed `FungibleAsset`, with no symbol,
 * no price and no market. Everything downstream then treats it as dust, which is
 * how one ended up listed as a token *and* pre-ticked for burning in The Void.
 *
 * **The market is the discriminator.** A 0-decimal asset with a price is something
 * people trade and a sweep can move; one with no price is not, and belongs with the
 * collectibles, where nothing is pre-selected for destruction. Where the caller
 * already knows there is no price — an illiquid token in The Void — the rule
 * reduces to `decimals === 0`, which is why `preselectForVoid` tests exactly that.
 *
 * One rule, two places: the split in `app/api/tokens/route.ts` and the pre-tick in
 * `lib/sweep/void-prompt.ts` have to agree, or an asset is either presented as dust
 * while being unsellable, or presented as a collectible while still ticked.
 */
export function looksLikeCollectible(asset: {
  decimals: number;
  hasNoPrice: boolean;
}): boolean {
  return asset.decimals === 0 && asset.hasNoPrice;
}

/**
 * Present a collectible-shaped token as the collectible it looks like.
 *
 * `interface` keeps the index's own word rather than a relabel of our own: it is
 * what the index said, and the burn path reads it to decide *how* to destroy the
 * asset — which for this one is the plain SPL burn an uncompressed NFT also gets
 * (`lib/sweep/plan-nft-burn.ts`).
 *
 * `tokenAccount` and `frozen` are carried across from the scan, so nothing
 * downstream has to re-derive an account that may not be the canonical ATA.
 */
export function toCollectibleAsset(token: DustToken): NonFungibleAsset {
  return {
    id: token.mint,
    name: token.name,
    imageUri: token.logoUri,
    // A token logo, not a file. Saying `null` keeps the UI from trying to render a
    // video it will never find.
    imageMime: null,
    collection: null,
    compressed: false,
    interface: "FungibleAsset",
    tokenAccount: token.tokenAccount,
    program: token.program,
    frozen: token.frozen,
    merkle: null,
    delegate: null,
  };
}
