/**
 * Canopy arithmetic for concurrent merkle trees.
 *
 * A cNFT burn needs a merkle proof: one sibling hash per tree level. Trees can
 * store the bottom `canopyDepth` levels *on chain*, inside the tree account, so
 * those nodes do not have to be repeated as transaction accounts. Indexers
 * often return the full-depth proof anyway, and Metaplex's own
 * `getAssetWithProof({ truncateCanopy: true })` slices the canopy tail off
 * before building a burn.
 *
 * This module does the same arithmetic without pulling in the whole
 * compression SDK: read the tree header, work out how much of the account is
 * canopy, and turn that byte count into a number of proof nodes.
 *
 * The tree account layout is the SPL account-compression one:
 *
 *   byte 0       account type (1 = ConcurrentMerkleTree)
 *   byte 1       header version (0 = V1)
 *   bytes 2..5   maxBufferSize (u32 LE)
 *   bytes 6..9   maxDepth      (u32 LE)
 *   bytes 10..41 authority
 *   bytes 42..49 creationSlot (u64 LE)
 *   bytes 50..55 padding
 *
 * followed by the tree body and then `32 * ((1 << (canopyDepth + 1)) - 2)`
 * bytes of canopy nodes.
 */

/** Bytes before the tree body. Fixed for the V1 header. */
export const MERKLE_TREE_HEADER_SIZE = 56;

export interface MerkleTreeHeader {
  maxDepth: number;
  maxBufferSize: number;
}

/**
 * Read the two fields needed to price a tree's non-canopy size.
 *
 * Returns `null` for anything that is not a V1 concurrent merkle tree header,
 * so a caller can fall back to the full proof rather than guessing.
 */
export function parseMerkleTreeHeader(
  bytes: Uint8Array,
): MerkleTreeHeader | null {
  if (bytes.length < MERKLE_TREE_HEADER_SIZE) return null;

  // Account type 1 is ConcurrentMerkleTree; header version 0 is V1. A future
  // version may move the fields, and guessing at an unknown layout would be
  // worse than not truncating.
  if (bytes[0] !== 1 || bytes[1] !== 0) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const maxBufferSize = view.getUint32(2, true);
  const maxDepth = view.getUint32(6, true);

  if (maxDepth <= 0 || maxBufferSize <= 0) return null;
  return { maxDepth, maxBufferSize };
}

/**
 * Size of a tree account with no canopy at all.
 *
 * The body is:
 *   3 × u64 counters
 *   maxBufferSize × change log
 *   right-most path
 *
 * and a change log is a root, `maxDepth` path nodes, and an 8-byte index.
 * The right-most path is `maxDepth` nodes, a leaf, a u32 index and u32
 * padding.
 */
export function merkleTreeSizeWithoutCanopy(
  maxDepth: number,
  maxBufferSize: number,
): number {
  const changeLogSize = 32 + maxDepth * 32 + 8;
  const treeSize =
    3 * 8 +
    maxBufferSize * changeLogSize +
    (maxDepth * 32 + 32 + 4 + 4);

  // `MERKLE_TREE_HEADER_SIZE` already includes the one-byte account-type
  // discriminator, so it is the whole 56-byte prefix, not 56 plus one.
  return MERKLE_TREE_HEADER_SIZE + treeSize;
}

/**
 * Canopy depth implied by a tree account's real size.
 *
 * The canopy is a complete binary tree of `2^(depth+1) - 2` nodes, each 32
 * bytes, so the node count has to invert to a whole depth. If it does not, the
 * account is not shaped like a canopy tree and the safe answer is zero.
 */
export function canopyDepthFromSpace(
  space: number,
  header: MerkleTreeHeader,
): number {
  const withoutCanopy = merkleTreeSizeWithoutCanopy(
    header.maxDepth,
    header.maxBufferSize,
  );
  const canopyBytes = space - withoutCanopy;
  if (!Number.isFinite(canopyBytes) || canopyBytes <= 0) return 0;
  if (canopyBytes % 32 !== 0) return 0;

  const canopyNodes = canopyBytes / 32;
  const depth = Math.log2(canopyNodes + 2) - 1;
  if (!Number.isInteger(depth) || depth < 0) return 0;

  return Math.min(depth, header.maxDepth);
}

/**
 * Remove the canopy nodes from an indexer's full proof.
 *
 * DAS returns proof nodes from the leaf upwards. The first
 * `proof.length - canopyDepth` entries are the nodes a burn must send; the
 * remaining tail is already in the tree's canopy. Slicing beyond the proof's
 * own length would silently turn a bad answer into a short proof, so a depth
 * larger than the proof is treated as "nothing to truncate".
 */
export function truncateProofToCanopy(
  proof: string[],
  canopyDepth: number,
  maxDepth?: number,
): string[] {
  if (canopyDepth <= 0) return proof;

  // Some indexers already return only the non-canopy tail. A proof shorter than
  // the tree is one of those, and slicing again would remove real nodes. A proof
  // *longer* than the tree is malformed; it is not safe to guess which entries
  // are canopy, so keep it intact too.
  if (maxDepth !== undefined && proof.length !== maxDepth) return proof;

  // More canopy than proof nodes is a malformed answer, not a fully-canopied
  // leaf. Keep the proof intact so the burn either works or fails honestly.
  if (canopyDepth > proof.length) return proof;

  // A full-depth proof with a full-depth canopy has nothing left to send.
  if (maxDepth !== undefined && canopyDepth === proof.length) {
    return proof.length === maxDepth ? [] : proof;
  }

  return proof.slice(0, proof.length - canopyDepth);
}
