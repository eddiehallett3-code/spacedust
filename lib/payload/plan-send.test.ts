import { describe, expect, it } from "vitest";
import { sendEmptiesAccount } from "@/lib/solana/transfer";
import { computeBudgetForUnits, unsendableAssetReason } from "./plan-send";
import type { NonFungibleAsset } from "@/types/token";

/**
 * The parts of planning that need no chain.
 *
 * The two rules asserted hardest here are the ones that cost money if they are
 * wrong: a compute budget is billed at the size it *requests*, and a close
 * attached to a send that did not empty its account is refused on chain with
 * `Custom: 11` — measured, along with the rest, in
 * `probes/tmp-payload-transfer-probe.mjs`.
 */

const asset = (overrides: Partial<NonFungibleAsset>): NonFungibleAsset => ({
  id: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  name: "Test NFT",
  imageUri: null,
  imageMime: null,
  collection: null,
  compressed: false,
  interface: "V1_NFT",
  tokenAccount: "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi",
  program: "legacy",
  frozen: false,
  merkle: null,
  delegate: null,
  ...overrides,
});

describe("computeBudgetForUnits", () => {
  it("floors a single unit rather than asking for the measured 16,000", () => {
    expect(computeBudgetForUnits(1)).toBe(50_000);
  });

  it("scales with the units, rounded up to the next 10,000", () => {
    // 4 × 16,000 = 64,000
    expect(computeBudgetForUnits(4)).toBe(70_000);
    expect(computeBudgetForUnits(10)).toBe(160_000);
  });

  it("adds a proof allowance for each compressed NFT", () => {
    // A Bubblegum transfer verifies a merkle proof before it moves anything, so
    // asking for a token transfer's budget would under-ask and fail.
    expect(computeBudgetForUnits(1, 1)).toBe(80_000); // 16,000 + 60,000
    expect(computeBudgetForUnits(2, 2)).toBe(160_000); // 32,000 + 120,000
  });

  it("never exceeds Solana's own ceiling", () => {
    expect(computeBudgetForUnits(100)).toBe(1_400_000);
    expect(computeBudgetForUnits(100_000)).toBe(1_400_000);
  });

  it("still answers sanely for zero, which is what an empty batch looks like", () => {
    expect(computeBudgetForUnits(0)).toBe(50_000);
  });

  it("stays far below the sweep's budget for a realistic batch", () => {
    // The priority fee is billed on the request, so a batch of eleven distinct
    // destinations — the measured maximum per transaction — must not be priced
    // like the sweep's fixed 800,000.
    expect(computeBudgetForUnits(11)).toBeLessThan(800_000);
  });
});

describe("sendEmptiesAccount", () => {
  it("is true when the whole balance goes", () => {
    expect(sendEmptiesAccount(1_000n, 1_000n)).toBe(true);
  });

  it("is true when more than the balance is sent, which the chain will clamp", () => {
    expect(sendEmptiesAccount(1_001n, 1_000n)).toBe(true);
  });

  it("is false for a partial send, which must not be followed by a close", () => {
    expect(sendEmptiesAccount(999n, 1_000n)).toBe(false);
  });

  it("is true for an NFT, because one of one is all of it", () => {
    expect(sendEmptiesAccount(1n, 1n)).toBe(true);
  });
});

describe("unsendableAssetReason", () => {
  it("allows an SPL NFT", () => {
    expect(unsendableAssetReason(asset({}))).toBeNull();
  });

  it("allows a legacy NFT", () => {
    expect(unsendableAssetReason(asset({ interface: "LEGACY_NFT" }))).toBeNull();
  });

  it("sends a compressed NFT once the index has described its leaf", () => {
    // A cNFT is a leaf, not an account — so `tokenAccount: null` is normal here
    // and must not be read as "the scan lost it". What it needs is the tree data.
    const reason = unsendableAssetReason(
      asset({
        compressed: true,
        tokenAccount: null,
        merkle: {
          tree: "7MHNupVw45KV1JG3HxPPqUnCJoLzFxt3THMJsLjJRerz",
          leafId: 1172,
          dataHash: "3eNTexmWmu1cEYKhCsoXDCZJRSvgdujR1RQDGVa3t8H9",
          creatorHash: "98UuRrUaTrQF5gQocbrabinCDqmPh2UeyF9t7GwzNVCK",
          assetDataHash: null,
          flags: null,
        },
      }),
    );

    expect(reason).toBeNull();
  });

  it("refuses a leaf the index never described", () => {
    // Without tree, index and hashes there is nothing to prove, so the leaf
    // cannot be moved at all — and without a metadata index this is what every
    // cNFT in the wallet looks like.
    const reason = unsendableAssetReason(
      asset({ compressed: true, tokenAccount: null, merkle: null }),
    );

    expect(reason).toMatch(/metadata index/i);
    expect(reason).toMatch(/prove/i);
  });

  it("refuses a V2 leaf with no asset-data hash", () => {
    // `transferV2` encodes that hash and the program compares it against the
    // leaf, so a leaf the index described without one cannot be moved honestly.
    const reason = unsendableAssetReason(
      asset({
        compressed: true,
        tokenAccount: null,
        interface: "MplBubblegumV2",
        merkle: {
          tree: "6Fqx4W2g1LDE4Qqy6XHZBxPgLnCNEZ2VzrKmg9TQcBUN",
          leafId: 1,
          dataHash: "3Af4hPqqpmqCeXyXxGB4ZAAnp7HfjNJYFD1UocGW8Gsm",
          creatorHash: "CCk2pSgMkvB6NeLJe8z6AzY6MW1XgP7b8vgtT5Sk7n7d",
          assetDataHash: null,
          flags: 0,
        },
      }),
    );

    expect(reason).toMatch(/asset-data hash/i);
  });

  it("names the freeze authority when an asset is frozen", () => {
    const reason = unsendableAssetReason(asset({ frozen: true }));
    expect(reason).toMatch(/frozen/i);
    expect(reason).toMatch(/freeze authority/i);
  });

  it("refuses an asset whose account the scan could not name", () => {
    const reason = unsendableAssetReason(asset({ tokenAccount: null }));
    expect(reason).toMatch(/could not find the token account/i);
  });

  it("refuses a programmable NFT for the reason that applies to it", () => {
    const reason = unsendableAssetReason(
      asset({ interface: "ProgrammableNFT" }),
    );
    expect(reason).toMatch(/Token Metadata/i);
    expect(reason).toMatch(/not built yet/i);
  });

  it("refuses an unrecognised interface by name", () => {
    expect(unsendableAssetReason(asset({ interface: "MplCoreAsset" }))).toMatch(
      /MplCoreAsset/,
    );
  });
});
