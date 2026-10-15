import { describe, expect, it } from "vitest";
import { assetKind, isBubblegumV2, nftBurnability } from "@/lib/sweep/plan-nft-burn";
import type { NonFungibleAsset } from "@/types/token";

/**
 * An NFT burn destroys a unique asset, so this predicate is the last line of
 * defence. It has to refuse anything it cannot build a *correct* instruction
 * for — refusing costs a feature, guessing costs someone their asset.
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

const refusals = (asset: Partial<NonFungibleAsset>) => {
  const verdict = nftBurnability({ ...base, ...asset });
  expect(verdict.burnable).toBe(false);
  // Every refusal must carry a reason the UI can show on the row.
  if (!verdict.burnable) expect(verdict.reason.length).toBeGreaterThan(0);
};

describe("nftBurnability", () => {
  it("allows a plain NFT held in a token account", () => {
    expect(nftBurnability(base).burnable).toBe(true);
    expect(nftBurnability({ ...base, interface: "LEGACY_NFT" }).burnable).toBe(true);
  });

  it("refuses a cNFT whose leaf the scan could not read — without a proof there is no burn", () => {
    // A cNFT is a merkle leaf, so a burn needs the tree, the index and both
    // hashes. `merkle: null` is what a wallet scanned without an index looks
    // like, and it must refuse rather than build a burn from three of four.
    refusals({ compressed: true, tokenAccount: null });
  });

  it("allows a cNFT whose leaf the index did describe", () => {
    const verdict = nftBurnability({
      ...base,
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
    });
    expect(verdict.burnable).toBe(true);
    expect(verdict.burnable && verdict.route).toBe("cnft");
  });

  it("allows a Bubblegum V2 leaf when the index gave its asset-data hash", () => {
    // V2 is supported, but only from a scan that read the extra field it
    // commits to. Same route, different instruction underneath.
    const verdict = nftBurnability({
      ...base,
      compressed: true,
      tokenAccount: null,
      interface: "MplBubblegumV2",
      merkle: {
        tree: "6Fqx4W2g1LDE4Qqy6XHZBxPgLnCNEZ2VzrKmg9TQcBUN",
        leafId: 108966,
        dataHash: "3Af4hPqqpmqCeXyXxGB4ZAAnp7HfjNJYFD1UocGW8Gsm",
        creatorHash: "CCk2pSgMkvB6NeLJe8z6AzY6MW1XgP7b8vgtT5Sk7n7d",
        assetDataHash: "EKDHSGbrGztomDfuiV4iqiZ6LschDJPsFiXjZ83f92Md",
        flags: 0,
      },
    });
    expect(verdict.burnable).toBe(true);
    expect(verdict.burnable && verdict.route).toBe("cnft");
  });

  it("refuses a Bubblegum V2 leaf with no asset-data hash", () => {
    // The program checks this field against the leaf, so its absence is a
    // refusal — never a value to invent.
    refusals({
      compressed: true,
      tokenAccount: null,
      interface: "MplBubblegumV2",
      merkle: {
        tree: "6Fqx4W2g1LDE4Qqy6XHZBxPgLnCNEZ2VzrKmg9TQcBUN",
        leafId: 108966,
        dataHash: "3Af4hPqqpmqCeXyXxGB4ZAAnp7HfjNJYFD1UocGW8Gsm",
        creatorHash: "CCk2pSgMkvB6NeLJe8z6AzY6MW1XgP7b8vgtT5Sk7n7d",
        assetDataHash: null,
        flags: null,
      },
    });
  });

  it("tells V1 and V2 leaves apart by the index's interface, nothing else", () => {
    // A V1 leaf the index mislabels as V2 would be refused for a missing field
    // rather than sent the wrong instruction, which is the safe direction.
    expect(isBubblegumV2({ ...base, interface: "MplBubblegumV2" })).toBe(true);
    expect(isBubblegumV2({ ...base, interface: "V1_NFT" })).toBe(false);
  });

  it("names each asset class, because the burn route differs by class", () => {
    // The one thing a card never said. The route (and so the failure modes)
    // differ per class, and a user cannot be expected to know a Core asset from
    // a pNFT by looking at one.
    expect(assetKind(base)).toBe("NFT");
    expect(assetKind({ ...base, interface: "ProgrammableNFT" })).toBe("pNFT");
    expect(assetKind({ ...base, interface: "MplCoreAsset", tokenAccount: null })).toBe(
      "Core",
    );
    expect(assetKind({ ...base, compressed: true, tokenAccount: null })).toBe("cNFT");
    expect(assetKind({ ...base, interface: "core-rpc:supply-1" })).toBe(
      "unidentified",
    );
    // And something we have never seen says so, rather than guessing a class.
    expect(assetKind({ ...base, interface: "SomethingNew" })).toBe("unknown");
  });

  it("names a collectible-shaped token as a collectible, not as unknown", () => {
    // The index calls it fungible; this app calls it a collectible, because it has
    // no decimals and no market. On a card whose whole job is to make destruction
    // deliberate, "unknown" would be the wrong word for something the app has
    // already decided about.
    expect(assetKind({ ...base, interface: "FungibleAsset" })).toBe("collectible");
  });

  it("burns a collectible-shaped token through the SPL route, like an NFT", () => {
    // It has a token account and no token record, so its burn is the plain SPL
    // `Burn` + `CloseAccount` — the same instruction an uncompressed NFT gets.
    expect(nftBurnability({ ...base, interface: "FungibleAsset" })).toEqual({
      burnable: true,
      route: "spl",
    });
  });

  it("refuses a frozen asset — the owner cannot burn it", () => {
    refusals({ frozen: true });
  });

  it("refuses an asset whose token account we could not locate", () => {
    // Deriving an ATA instead is what produced `InvalidAccountData` before.
    refusals({ tokenAccount: null });
  });

  it("allows a pNFT, which Token Metadata burns whole", () => {
    // A pNFT has a token record that a plain SPL burn would leave behind, so it
    // gets its own route — but it is burnable, and it needs a real token
    // account like any SPL token.
    const verdict = nftBurnability({
      ...base,
      interface: "ProgrammableNFT",
    });
    expect(verdict.burnable).toBe(true);
    expect(verdict.burnable && verdict.route).toBe("pnft");
  });

  it("refuses a pNFT whose token account we could not locate", () => {
    // The same rule as SPL: without the real account there is nothing to burn,
    // and deriving an ATA instead is what produced `InvalidAccountData` before.
    refusals({ interface: "ProgrammableNFT", tokenAccount: null });
  });

  it("allows a Core asset, which burns through its own program", () => {
    // A Core asset has no token account — the asset account *is* the position —
    // so this has to be decided by type, never by whether an account was found.
    const verdict = nftBurnability({
      ...base,
      interface: "MplCoreAsset",
      tokenAccount: null,
    });
    expect(verdict.burnable).toBe(true);
    if (verdict.burnable) expect(verdict.route).toBe("core");
  });

  it("routes an ordinary NFT through burn-then-close", () => {
    const verdict = nftBurnability(base);
    expect(verdict.burnable).toBe(true);
    if (verdict.burnable) expect(verdict.route).toBe("spl");
  });

  it("refuses an asset the free scanner could only guess at", () => {
    // Supply === 1 is enough to keep it out of the dust list, not enough to
    // destroy it: we cannot say what it is.
    refusals({ interface: "core-rpc:supply-1" });
  });

  it("refuses an interface we have never seen", () => {
    refusals({ interface: "SomethingNewFromMetaplex" });
  });
});

/**
 * Refusal *reasons* are user-facing copy, so which one wins is a behaviour, not
 * a detail. Getting the order wrong made the app look broken and misdirected
 * the debugging: a Core asset has no SPL token account by nature, so checking
 * the account before the asset type reported "its token account could not be
 * located" for 4,244 of 4,280 assets in the first wallet measured.
 */
describe("nftBurnability reason ordering", () => {
  it("blames the asset type, not a missing account, for an interface we do not know", () => {
    // The ordering rule, where it still applies: a type we cannot burn is
    // reported as the type, never as a missing account it might never have had.
    const verdict = nftBurnability({
      ...base,
      interface: "SomethingNew",
      tokenAccount: null,
    });
    expect(verdict.burnable).toBe(false);
    if (!verdict.burnable) {
      expect(verdict.reason).toContain("Metaplex");
      expect(verdict.reason).not.toContain("could not be located");
    }
  });

  it("names a recognised interface in plain English rather than raw", () => {
    // `MplCoreCollection` is the case left: a collection is not a thing a wallet
    // holds to burn, and if one ever reached here it should read as words.
    const verdict = nftBurnability({ ...base, interface: "MplCoreCollection" });
    expect(verdict.burnable).toBe(false);
    if (!verdict.burnable) {
      expect(verdict.reason).toContain("A Core collection");
      expect(verdict.reason).not.toContain("MplCoreCollection");
    }
  });

  it("reserves 'could not be located' for a type we can burn", () => {
    // A V1_NFT should always have an account. If one does not, that really is
    // an anomaly worth reporting — which is what the message now means.
    const verdict = nftBurnability({ ...base, tokenAccount: null });
    expect(verdict.burnable).toBe(false);
    if (!verdict.burnable) {
      expect(verdict.reason).toContain("could not be located");
    }
  });

  it("prefers the cNFT explanation even when the type is unusual", () => {
    // `compressed` has to be decided before the interface is consulted, for the
    // same reason the asset types are: a cNFT's route is not SPL's, whatever the
    // interface happens to say. Locked by the absence of the interface name in
    // the reason — if the interface check won, that is what the user would read.
    const verdict = nftBurnability({
      ...base,
      compressed: true,
      tokenAccount: null,
      interface: "SomethingNew",
    });
    expect(verdict.burnable).toBe(false);
    if (!verdict.burnable) {
      expect(verdict.reason).toContain("metadata index");
      expect(verdict.reason).not.toContain("SomethingNew");
    }
  });
});
