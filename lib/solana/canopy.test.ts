import { describe, expect, it } from "vitest";
import {
  MERKLE_TREE_HEADER_SIZE,
  canopyDepthFromSpace,
  merkleTreeSizeWithoutCanopy,
  parseMerkleTreeHeader,
  truncateProofToCanopy,
} from "@/lib/solana/canopy";

/**
 * The canopy tail is the difference between "a 24-level proof cannot fit" and
 * "a 7-level proof fits with room to spare". These tests pin the arithmetic to
 * the SPL tree layout rather than to a guess, because getting it wrong would
 * remove real proof nodes and produce a burn the program rejects.
 */

function header(maxDepth: number, maxBufferSize: number): Uint8Array {
  const bytes = new Uint8Array(MERKLE_TREE_HEADER_SIZE);
  // Account type 1 (ConcurrentMerkleTree), header version 0 (V1).
  bytes[0] = 1;
  bytes[1] = 0;
  new DataView(bytes.buffer).setUint32(2, maxBufferSize, true);
  new DataView(bytes.buffer).setUint32(6, maxDepth, true);
  return bytes;
}

describe("parseMerkleTreeHeader", () => {
  it("reads the depth and buffer size from their little-endian fields", () => {
    expect(parseMerkleTreeHeader(header(24, 256))).toEqual({
      maxDepth: 24,
      maxBufferSize: 256,
    });
  });

  it("refuses a layout it does not understand", () => {
    const wrongType = header(20, 64);
    wrongType[0] = 0;
    expect(parseMerkleTreeHeader(wrongType)).toBeNull();

    const wrongVersion = header(20, 64);
    wrongVersion[1] = 1;
    expect(parseMerkleTreeHeader(wrongVersion)).toBeNull();

    expect(parseMerkleTreeHeader(new Uint8Array(12))).toBeNull();
  });
});

describe("canopyDepthFromSpace", () => {
  it("matches a real mainnet tree with no canopy", () => {
    // 7MHNupVw45KV1JG3HxPPqUnCJoLzFxt3THMJsLjJRerz, read from mainnet:
    // maxDepth 14, maxBufferSize 64, space 31,800.
    expect(merkleTreeSizeWithoutCanopy(14, 64)).toBe(31_800);
  });

  it("recovers a known canopy depth from the account size", () => {
    // 6Fqx4W2g1LDE4Qqy6XHZBxPgLnCNEZ2VzrKmg9TQcBUN, read from mainnet:
    // maxDepth 20, maxBufferSize 64, space 568,504 -> canopy 13.
    const maxDepth = 20;
    const maxBufferSize = 64;
    const withoutCanopy = merkleTreeSizeWithoutCanopy(maxDepth, maxBufferSize);
    expect(withoutCanopy).toBe(44_280);

    const canopyNodes = (1 << (13 + 1)) - 2;
    expect(
      canopyDepthFromSpace(withoutCanopy + canopyNodes * 32, {
        maxDepth,
        maxBufferSize,
      }),
    ).toBe(13);
    expect(
      canopyDepthFromSpace(568_504, { maxDepth, maxBufferSize }),
    ).toBe(13);
  });

  it("returns zero when there is no canopy and for a malformed size", () => {
    const header = { maxDepth: 20, maxBufferSize: 64 };
    const withoutCanopy = merkleTreeSizeWithoutCanopy(20, 64);

    expect(canopyDepthFromSpace(withoutCanopy, header)).toBe(0);
    // A half-node tail is not a valid canopy.
    expect(canopyDepthFromSpace(withoutCanopy + 16, header)).toBe(0);
  });

  it("never reports more canopy than the tree has levels", () => {
    const header = { maxDepth: 14, maxBufferSize: 64 };
    const withoutCanopy = merkleTreeSizeWithoutCanopy(14, 64);
    // 2^15 - 2 nodes is canopy 14, exactly the full tree.
    const canopyNodes = (1 << 15) - 2;
    expect(
      canopyDepthFromSpace(withoutCanopy + canopyNodes * 32, header),
    ).toBe(14);
  });
});

describe("truncateProofToCanopy", () => {
  const proof = Array.from({ length: 24 }, (_, index) => `node-${index}`);

  it("removes exactly the canopy tail", () => {
    expect(truncateProofToCanopy(proof, 13)).toEqual(proof.slice(0, 11));
    expect(truncateProofToCanopy(proof, 0)).toBe(proof);
  });

  it("handles a fully canopied leaf with an empty proof", () => {
    expect(truncateProofToCanopy(proof, 24, 24)).toEqual([]);
  });

  it("does not re-truncate a proof an indexer already shortened", () => {
    // A depth-24 tree with canopy 13 should arrive as 11 nodes. If an indexer
    // already trimmed it, cutting 13 more would remove real proof nodes.
    const alreadyTrimmed = proof.slice(0, 11);
    expect(truncateProofToCanopy(alreadyTrimmed, 13, 24)).toEqual(
      alreadyTrimmed,
    );
    // A full proof of the same tree is still trimmed correctly.
    expect(truncateProofToCanopy(proof, 13, 24)).toEqual(alreadyTrimmed);
  });

  it("does not shorten a proof by more than it has", () => {
    // A caller with a bad depth should fall back to the proof it was given, not
    // silently send an empty one.
    expect(truncateProofToCanopy(proof, 25)).toEqual(proof);
    // The empty case is already empty, so there is nothing to remove.
    expect(truncateProofToCanopy([], 13)).toEqual([]);
    // A proof longer than the tree is malformed; slicing its tail would guess.
    const tooLong = [...proof, "node-24"];
    expect(truncateProofToCanopy(tooLong, 13, 24)).toEqual(tooLong);
  });
});
