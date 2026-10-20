import {
  MAX_TX_SIZE_BYTES,
  TX_SIZE_HEADROOM_BYTES,
} from "@/lib/utils/constants";
import type { NonFungibleAsset } from "@/types/token";

/**
 * How big a cNFT burn is, and therefore how long a proof it can carry.
 *
 * A Bubblegum burn puts every non-canopy proof node in the transaction as an
 * account. Accounts are not free: a new 32-byte key adds 32 bytes to the static
 * key list, and the instruction's account index adds one more. That is why a
 * proof grows a transaction by exactly 33 bytes per node, and why a deep enough
 * tree cannot be burned in one transaction at all.
 *
 * The numbers below are measured, not estimated. They come from building a real
 * burn (mpl-bubblegum's own builder), packing it with the same compute-budget
 * prologue the planner uses, and reading `packTransactions`' size for proof
 * lengths 0–30. The base figures are the zero-proof size of a single-cNFT
 * transaction:
 *
 *   V1 leaf                   514 bytes
 *   V2 leaf                   587 bytes
 *   V2 leaf + Core collection 651 bytes
 *
 * An undelegated V1 leaf's delegate is its owner, so the builder's default
 * dedupes to the same key. A delegated leaf adds one distinct account instead
 * (32 bytes of key plus one account index), which is why the base grows by
 * exactly the same 33 bytes as a proof node when one is present.
 *
 * The budget is the protocol's 1232 bytes minus the packer's 40-byte headroom,
 * which is the same limit `packTransactions` enforces before it reports a
 * transaction as too large. Solving `base + 33n <= 1192` gives the last proof
 * length that fits directly:
 *
 *   V1                        20 nodes (1174 bytes; 21 needs 1207)
 *   V2                        18 nodes (1181 bytes; 19 needs 1214)
 *   V2 + Core collection      16 nodes (1179 bytes; 17 needs 1212)
 *
 * A distinct delegate shifts each of those by one node. These are deliberately
 * the same constants the planner measures against, so a tree sitting exactly on
 * the boundary is described the same way in the grid and in the preview. If the
 * compute-budget prologue or the Bubblegum account list changes, re-measure
 * rather than adjusting these by guesswork.
 */
export const CNFT_PROOF_NODE_BYTES = 33;

export const CNFT_BURN_BASE_BYTES = {
  v1: 514,
  v2: 587,
  v2WithCollection: 651,
} as const;

/** The size a packed burn may occupy, after the packer's own headroom. */
export const CNFT_INLINE_PROOF_BUDGET_BYTES =
  MAX_TX_SIZE_BYTES - TX_SIZE_HEADROOM_BYTES;

export function cnftBurnBaseBytes(input: {
  v2: boolean;
  hasCollection: boolean;
  hasDelegate?: boolean;
}): number {
  const base = !input.v2
    ? CNFT_BURN_BASE_BYTES.v1
    : input.hasCollection
      ? CNFT_BURN_BASE_BYTES.v2WithCollection
      : CNFT_BURN_BASE_BYTES.v2;
  // A distinct leaf delegate is another 32-byte key and one account index.
  return base + (input.hasDelegate ? CNFT_PROOF_NODE_BYTES : 0);
}

/** The longest proof — in nodes — that still fits without a lookup table. */
export function cnftInlineProofLimit(input: {
  v2: boolean;
  hasCollection: boolean;
  hasDelegate?: boolean;
}): number {
  const remaining = CNFT_INLINE_PROOF_BUDGET_BYTES - cnftBurnBaseBytes(input);
  return Math.max(0, Math.floor(remaining / CNFT_PROOF_NODE_BYTES));
}

/**
 * Whether a leaf's burn fits in one transaction, or `null` when the scan could
 * not read the tree and the proof length is unknown.
 *
 * `false` is the only answer that can be acted on before planning: those leaves
 * will need an address lookup table. `true` is a guarantee for the lengths and
 * account sets measured above. `null` must not be shown as either — the
 * planner's real measurement is the source of truth, and treating unknown as
 * "needs a table" would put ordinary cNFTs behind a setup warning they do not
 * need.
 */
export function cnftFitsInline(asset: NonFungibleAsset): boolean | null {
  const proofNodes = asset.merkle?.proofNodes;
  if (
    typeof proofNodes !== "number" ||
    !Number.isInteger(proofNodes) ||
    proofNodes < 0
  ) {
    return null;
  }
  // Mirrors `isBubblegumV2` in `plan-nft-burn.ts`. Kept as a plain interface
  // check so this sizing module has no dependency on the planner.
  const v2 = asset.interface === "MplBubblegumV2";
  return (
    proofNodes <=
    cnftInlineProofLimit({
      v2,
      hasCollection: asset.collection !== null,
      hasDelegate: asset.delegate !== null,
    })
  );
}
