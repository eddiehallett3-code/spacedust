import type { NonFungibleAsset } from "@/types/token";
import { CORE_HUSK_SIZE_BYTES } from "@/lib/solana/rent";

/**
 * Is this asset alive?
 *
 * Kept out of the server module that uses it so it can be tested without a
 * network, because the rule has two halves that pull in opposite directions and
 * getting either wrong is invisible:
 *
 *  - **A missing account is not always a dead asset.** A cNFT's id is a merkle
 *    leaf, so nothing exists at it — ever. Treating "no account" as "destroyed"
 *    silently deleted every live cNFT from the scan, which is exactly what it
 *    did the first time this filter shipped.
 *  - **A tiny account is not always a live asset.** Core's burn leaves a
 *    one-byte husk rather than closing the account, and every index keeps
 *    describing it with the old owner, so a burned NFT otherwise reappears and
 *    reads as a burn that never happened.
 */

/**
 * The data of a Core asset account that has been burned.
 *
 * A one-byte account holding a single zero. Recognised so a burned asset can be
 * kept out of the grid, and its rent kept out of the numbers.
 */
export function isCoreHusk(data: Uint8Array | readonly number[]): boolean {
  return data.length === CORE_HUSK_SIZE_BYTES && data[0] === 0;
}

/**
 * Whether the index itself says this asset was burned.
 *
 * An account read cannot answer this for a cNFT — a leaf has no account, so
 * there is nothing to inspect — but Helius keeps its own `burnt` flag, and it is
 * accurate: verified `true` for every asset burned on mainnet and `false` for
 * the live ones sitting beside them in the same response, fungible and not.
 * It also lags, which is precisely why a destroyed asset keeps appearing: the
 * flag lands when the indexer processes the slot, so a burn can be many hours
 * old before the grid stops listing it.
 *
 * Only an explicit `true` counts. Absent, false, or a string is left alone,
 * because the failure mode of guessing in this direction is hiding something
 * the user still owns.
 */
export function indexFlagsBurnt(item: { burnt?: unknown }): boolean {
  return item.burnt === true;
}

/**
 * Whether the chain proves this asset no longer exists.
 *
 * `account` is what `getMultipleAccounts` returned for the asset's id: `null`
 * when no account is there at all. Only a *proven* death counts — anything
 * unreadable, and anything that has no account by nature, is left alone.
 */
export function assetIsGone(
  asset: NonFungibleAsset,
  account: { data?: [string, string] | unknown } | null,
): boolean {
  // A compressed asset is a leaf in a merkle tree. There is no account to find,
  // so its absence says nothing at all.
  if (asset.compressed) return false;

  // Nothing at the address: for a Core asset that is a closed account, and for
  // an SPL NFT that is a closed mint. Either way it is gone.
  if (!account) return true;

  // Base64 by request, but never assume it: anything else is unreadable rather
  // than empty.
  const encoded = Array.isArray(account.data) ? account.data[0] : null;
  if (typeof encoded !== "string") return false;

  // A husk is one zero byte. A mint is 82, a Core asset hundreds — and a
  // payload too long to be a husk is decoded no further.
  if (encoded.length > 8) return false;
  try {
    return isCoreHusk([...Buffer.from(encoded, "base64")]);
  } catch {
    return false;
  }
}
