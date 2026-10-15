import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import { buildCnftBurnInstruction } from "@/lib/solana/cnft-burn";

/**
 * A cNFT's burn is one instruction built from values that all come from outside:
 * the indexer's tree, leaf index and hashes, and its merkle proof. Every one of
 * them has a way of being wrong that still *encodes*, so the assertions here are
 * about what the bytes mean, not merely that something was built.
 *
 * The reference values are a real leaf of a real tree (checked against mainnet:
 * this exact shape simulates clean), and the discriminator is mpl-bubblegum
 * 6.0.0's own for `burn` — read out of the package's serializer, not typed from
 * memory.
 */

const BUBBLEGUM_PROGRAM = "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY";
const BURN_DISCRIMINATOR = [116, 110, 29, 56, 107, 219, 42, 93];

const LEAF_OWNER = "DHV45VXX4pEjTRXQz2SVHC3EScM9j7u2ncvDwdZLB4J";
const TREE = "7MHNupVw45KV1JG3HxPPqUnCJoLzFxt3THMJsLjJRerz";

const request = {
  asset: "HhWaxhccnjuaFgUU2NGsSKQZ7j7mYFwoHYaJFFa3z899",
  // A V1 leaf: no asset-data hash, no flags. V2 is a different instruction and
  // has its own test below.
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
};

describe("buildCnftBurnInstruction", () => {
  it("builds Bubblegum's Burn, with the proof appended as accounts", async () => {
    const instruction = await buildCnftBurnInstruction(request);
    const data = Buffer.from(instruction.data);

    expect(instruction.programId.toBase58()).toBe(BUBBLEGUM_PROGRAM);
    expect([...data.subarray(0, 8)]).toEqual(BURN_DISCRIMINATOR);

    // Accounts: treeConfig, leafOwner, leafDelegate, merkleTree, logWrapper,
    // account-compression, system, then the proof — in that order, because the
    // program reads them positionally.
    const keys = instruction.keys.map((key) => key.pubkey.toBase58());
    expect(keys.length).toBe(7 + request.proof.length);
    expect(keys[1]).toBe(LEAF_OWNER);
    // Undelegated leaf: the delegate defaults to the owner, which is what such a
    // leaf stores, and the program compares the account it is given against it.
    expect(keys[2]).toBe(LEAF_OWNER);
    expect(keys[3]).toBe(TREE);
    expect(keys.slice(7)).toEqual(request.proof);
  });

  it("encodes the leaf's own facts, in the order the program reads them", async () => {
    const data = Buffer.from(
      (await buildCnftBurnInstruction(request)).data,
    );

    // 8 discriminator + 32 root + 32 data hash + 32 creator hash + 8 nonce + 4 index
    expect(data.length).toBe(8 + 32 * 3 + 8 + 4);

    // Each 32-byte field at its own offset: the program reads them positionally,
    // so a swap of two hashes would still encode and still be wrong. Decoded
    // from the same base58 the indexer speaks.
    expect(
      Buffer.from(data.subarray(8, 40)).equals(Buffer.from(bs58.decode(request.root))),
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

    // The nonce is the leaf's index; the index argument is the *same* number and
    // not the proof's `nodeIndex`. Passing the node index here was rejected on
    // chain with a misattributed 6008 (`LeafIndexOutOfBounds`).
    expect(data.readBigUInt64LE(8 + 96)).toBe(1172n);
    expect(data.readUInt32LE(8 + 104)).toBe(1172);
  });

  it("refuses a hash that is not 32 bytes", async () => {
    // The indexer sending a truncated hash must fail here, in words, rather than
    // becoming a proof that cannot verify.
    await expect(
      buildCnftBurnInstruction({ ...request, dataHash: "3eNTexmW" }),
    ).rejects.toThrow(/32-byte hash/);
  });
});

/**
 * Bubblegum V2 is a different instruction, not a variation: another
 * discriminator, twelve accounts instead of seven, and two extra arguments.
 *
 * The reference values are a real V2 leaf of a real tree — checked against
 * mainnet, where this exact shape simulates clean — and the discriminator and
 * account order come from mpl-bubblegum's own builder.
 */
describe("buildCnftBurnInstruction (Bubblegum V2)", () => {
  const v2 = {
    ...request,
    variant: "v2" as const,
    asset: "JE43yBZsyyqZxRJCLZkJeJkqkdqKRSMqy2gxoyMb7oLk",
    tree: "6Fqx4W2g1LDE4Qqy6XHZBxPgLnCNEZ2VzrKmg9TQcBUN",
    // A Core collection: V2 needs the account, and supplies the Core CPI signer
    // for it by itself.
    collection: "urModXhTA7GDStmBs7LxVVDgqzm6xsWBrTZm5LKaKQv",
    leafId: 108966,
    dataHash: "3Af4hPqqpmqCeXyXxGB4ZAAnp7HfjNJYFD1UocGW8Gsm",
    creatorHash: "CCk2pSgMkvB6NeLJe8z6AzY6MW1XgP7b8vgtT5Sk7n7d",
    assetDataHash: "EKDHSGbrGztomDfuiV4iqiZ6LschDJPsFiXjZ83f92Md",
    flags: 0,
    index: 108966,
  };

  it("builds burnV2, not burn", async () => {
    const data = Buffer.from((await buildCnftBurnInstruction(v2)).data);
    expect([...data.subarray(0, 8)]).toEqual([
      115, 210, 34, 240, 232, 143, 183, 16,
    ]);
  });

  it("marks the payer and authority as signers — and the leaf owner not at all", async () => {
    // This is the V2 design change, and the reason `authority` exists: a
    // collection's permanent burn delegate can sign in place of the holder. So
    // the signing slot is `authority`, while `leafOwner` is only an account to
    // compare against. Sending the owner as a signer for `leafOwner` type-checks
    // nowhere, and would be rejected on chain if it did.
    const keys = (await buildCnftBurnInstruction(v2)).keys;
    expect(keys[1]?.isSigner).toBe(true); // payer
    expect(keys[2]?.isSigner).toBe(true); // authority
    expect(keys[3]?.isSigner).toBe(false); // leafOwner
    // Positions, because the program reads them positionally.
    expect(keys[3]?.pubkey.toBase58()).toBe(v2.owner);
    expect(keys[5]?.pubkey.toBase58()).toBe(v2.tree); // merkleTree
    expect(keys[6]?.pubkey.toBase58()).toBe(v2.collection); // coreCollection
    expect(keys.length).toBe(12 + v2.proof.length);
  });

  it("encodes the two V2-only fields as present options, in order", async () => {
    const data = Buffer.from((await buildCnftBurnInstruction(v2)).data);

    // 8 disc + 32 root + 32 data hash + 32 creator hash
    // + 33 asset-data hash (option tag + 32) + 2 flags (option tag + u8)
    // + 8 nonce + 4 index
    expect(data.length).toBe(8 + 96 + 33 + 2 + 8 + 4);

    expect(data[104]).toBe(1); // assetDataHash is Some
    expect(
      Buffer.from(data.subarray(105, 137)).equals(
        Buffer.from(bs58.decode(v2.assetDataHash)),
      ),
    ).toBe(true);
    expect(data[137]).toBe(1); // flags is Some
    expect(data[138]).toBe(0); // and reads zero for a normal leaf
    expect(data.readBigUInt64LE(139)).toBe(108966n);
    expect(data.readUInt32LE(147)).toBe(108966);
  });

  it("omits an absent asset-data hash rather than inventing one", async () => {
    // `None` is a real state for a leaf that does not commit to one, and the
    // only honest encoding when the index gave us nothing.
    const data = Buffer.from(
      (
        await buildCnftBurnInstruction({
          ...v2,
          assetDataHash: null,
          flags: null,
          collection: null,
        })
      ).data,
    );
    expect(data[104]).toBe(0); // assetDataHash is None
    expect(data[105]).toBe(0); // flags is None
    expect(data.length).toBe(8 + 96 + 1 + 1 + 8 + 4);
  });
});
