import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import { buildCnftTransferInstruction } from "@/lib/solana/cnft-transfer";

/**
 * Sending a cNFT is one Bubblegum instruction built from values that all come
 * from outside: the tree, the leaf's index and hashes, the merkle proof, and the
 * destination. Each has a way of being wrong that still *encodes*, so these
 * assertions are about what the bytes mean — and, above all, that the
 * destination we pass is the one that ends up in the instruction.
 *
 * The reference values are a real leaf of a real tree (the same one the burn
 * test uses, checked against mainnet), and both discriminators are
 * mpl-bubblegum 6.0.0's own, read out of the package's serializer rather than
 * typed from memory.
 */

const BUBBLEGUM_PROGRAM = "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY";
const TRANSFER_DISCRIMINATOR = [163, 52, 200, 231, 140, 3, 69, 186];
const TRANSFER_V2_DISCRIMINATOR = [119, 40, 6, 235, 234, 221, 248, 49];

const LEAF_OWNER = "DHV45VXX4pEjTRXQz2SVHC3EScM9j7u2ncvDwdZLB4J";
const NEW_OWNER = "Cikd6CT1At9m9YXH8yShWcKp2QKxGjjeDBA1n1RJKdK";
const TREE = "7MHNupVw45KV1JG3HxPPqUnCJoLzFxt3THMJsLjJRerz";

const request = {
  asset: "HhWaxhccnjuaFgUU2NGsSKQZ7j7mYFwoHYaJFFa3z899",
  variant: "v1" as const,
  tree: TREE,
  owner: LEAF_OWNER,
  delegate: null,
  collection: null,
  leafId: 1172,
  dataHash: "3eNTexmWmu1cEYKhCsoXDCZJRSvgdujR1RQDGVa3t8H9",
  creatorHash: "98UuRrUaTrQF5gQocbrabinCDqmPh2UeyF9t7GwzNVCK",
  assetDataHash: null,
  flags: null,
  root: "ENZ5LNawYGdiYRzmeHpXVCRUbydgAKuD8aHVF5eyfBKm",
  proof: [
    "9AtiDDT8GDDs5NpSBEgCrFrbPV4atve4CDVJZ6xeFwdR",
    "AtZYkS9LiQeryQbMxP2Qg5YyrGFcFnHc5jvBLFy6Qvfc",
  ],
  index: 1172,
  newOwner: NEW_OWNER,
};

describe("buildCnftTransferInstruction", () => {
  it("builds Bubblegum's Transfer, with the proof appended as accounts", async () => {
    const instruction = await buildCnftTransferInstruction(request);
    const data = Buffer.from(instruction.data);

    expect(instruction.programId.toBase58()).toBe(BUBBLEGUM_PROGRAM);
    expect([...data.subarray(0, 8)]).toEqual(TRANSFER_DISCRIMINATOR);

    // Accounts: treeConfig, leafOwner, leafDelegate, newLeafOwner, merkleTree,
    // logWrapper, account-compression, system, then the proof — in that order,
    // because the program reads them positionally.
    const keys = instruction.keys.map((key) => key.pubkey.toBase58());
    expect(keys.length).toBe(8 + request.proof.length);
    expect(keys[1]).toBe(LEAF_OWNER);
    // Undelegated leaf: the delegate defaults to the owner, which is what such a
    // leaf stores, and the program compares the account it is given against it.
    expect(keys[2]).toBe(LEAF_OWNER);
    expect(keys[3]).toBe(NEW_OWNER);
    expect(keys[4]).toBe(TREE);
    expect(keys.slice(8)).toEqual(request.proof);
  });

  it("encodes the leaf's own facts, in the order the program reads them", async () => {
    const data = Buffer.from(
      (await buildCnftTransferInstruction(request)).data,
    );

    // 8 discriminator + 32 root + 32 data hash + 32 creator hash + 8 nonce + 4 index
    expect(data.length).toBe(8 + 32 * 3 + 8 + 4);

    // Each 32-byte field at its own offset: a swap of two hashes would encode
    // and be rejected only on chain.
    expect(
      Buffer.from(data.subarray(8, 40)).equals(
        Buffer.from(bs58.decode(request.root)),
      ),
    ).toBe(true);
    expect(
      Buffer.from(data.subarray(40, 72)).equals(
        Buffer.from(bs58.decode(request.dataHash)),
      ),
    ).toBe(true);
    expect(
      Buffer.from(data.subarray(72, 104)).equals(
        Buffer.from(bs58.decode(request.creatorHash)),
      ),
    ).toBe(true);

    // The nonce is the leaf's index; the index argument is the same number and
    // not the proof's `nodeIndex`.
    expect(data.readBigUInt64LE(8 + 96)).toBe(1172n);
    expect(data.readUInt32LE(8 + 104)).toBe(1172);
  });

  it("refuses a hash that is not 32 bytes", async () => {
    await expect(
      buildCnftTransferInstruction({ ...request, creatorHash: "98UuRr" }),
    ).rejects.toThrow(/32-byte hash/);
  });
});

/**
 * Bubblegum V2 is a different instruction, not a variation: another
 * discriminator, a separate signing `authority`, and two extra arguments.
 */
describe("buildCnftTransferInstruction (Bubblegum V2)", () => {
  const v2 = {
    ...request,
    variant: "v2" as const,
    asset: "JE43yBZsyyqZxRJCLZkJeJkqkdqKRSMqy2gxoyMb7oLk",
    tree: "6Fqx4W2g1LDE4Qqy6XHZBxPgLnCNEZ2VzrKmg9TQcBUN",
    collection: "urModXhTA7GDStmBs7LxVVDgqzm6xsWBrTZm5LKaKQv",
    leafId: 108966,
    dataHash: "3Af4hPqqpmqCeXyXxGB4ZAAnp7HfjNJYFD1UocGW8Gsm",
    creatorHash: "CCk2pSgMkvB6NeLJe8z6AzY6MW1XgP7b8vgtT5Sk7n7d",
    assetDataHash: "EKDHSGbrGztomDfuiV4iqiZ6LschDJPsFiXjZ83f92Md",
    flags: 0,
    index: 108966,
  };

  it("builds transferV2, not transfer, and still names the new owner", async () => {
    const instruction = await buildCnftTransferInstruction(v2);
    const data = Buffer.from(instruction.data);

    expect([...data.subarray(0, 8)]).toEqual(TRANSFER_V2_DISCRIMINATOR);

    const keys = instruction.keys.map((key) => key.pubkey.toBase58());
    expect(keys.length).toBe(11 + v2.proof.length);
    expect(keys[3]).toBe(v2.owner); // leafOwner
    expect(keys[5]).toBe(NEW_OWNER); // newLeafOwner
    expect(keys[6]).toBe(v2.tree); // merkleTree
    expect(keys[7]).toBe(v2.collection); // coreCollection
    expect(keys.slice(11)).toEqual(v2.proof);
  });

  it("signs with the payer and authority, never with the leaf owner", async () => {
    // The V2 design change: the signing slot is `authority`, while `leafOwner`
    // is only compared against the leaf.
    const keys = (await buildCnftTransferInstruction(v2)).keys;
    expect(keys[1]?.isSigner).toBe(true); // payer
    expect(keys[2]?.isSigner).toBe(true); // authority
    expect(keys[3]?.isSigner).toBe(false); // leafOwner
  });

  it("encodes the two V2-only fields as present options, in order", async () => {
    const data = Buffer.from(
      (await buildCnftTransferInstruction(v2)).data,
    );

    // 8 disc + 32 root + 32 data hash + 32 creator hash
    // + 33 asset-data hash (option tag + 32) + 2 flags (option tag + u8)
    // + 8 nonce + 4 index
    expect(data.length).toBe(8 + 96 + 33 + 2 + 8 + 4);
    expect(data[104]).toBe(1);
    expect(
      Buffer.from(data.subarray(105, 137)).equals(
        Buffer.from(bs58.decode(v2.assetDataHash)),
      ),
    ).toBe(true);
    expect(data[137]).toBe(1);
    expect(data.readBigUInt64LE(139)).toBe(108966n);
  });
});

