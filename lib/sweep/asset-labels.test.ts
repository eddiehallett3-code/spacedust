import { describe, expect, it } from "vitest";
import { labelNonFungibles } from "@/lib/sweep/asset-labels";
import type { NonFungibleAsset } from "@/types/token";

/**
 * "Three rows called Mask, one of them still there after two were burned."
 *
 * A collection names every copy the same, so the grid has to add the only thing
 * that separates them. The rule that matters most is the one about *not* adding
 * anything: a suffix on every row would be noise, and the app's own name for an
 * asset is the collection's, not ours.
 */

function asset(overrides: Partial<NonFungibleAsset> = {}): NonFungibleAsset {
  return {
    id: "11111111111111111111111111111111",
    name: "Mask",
    imageUri: null,
    imageMime: null,
    collection: null,
    compressed: true,
    interface: "V1_NFT",
    tokenAccount: null,
    program: "legacy",
    frozen: false,
    merkle: {
      tree: "Dapb6C9jUfskHpsPi5RMHwF3maou3dhAu9qRhATLWwsx",
      leafId: 679_684,
      dataHash: "6c7UoC9hhwBvKq7YSMdMDa4Y1C1SyWPDkZwhise85D2U",
      creatorHash: "J8Sz1WEV8BZ8WWcLDmtJ7G3hPZnaRdLc4uLpJmJLPqqH",
      assetDataHash: null,
      flags: null,
    },
    delegate: null,
    ...overrides,
  };
}

describe("labelNonFungibles", () => {
  it("leaves a unique name exactly as the collection wrote it", () => {
    const labels = labelNonFungibles([
      asset({ id: "AAA", name: "Pandas On Sol #28", compressed: false }),
    ]);

    const label = labels.get("AAA");
    expect(label?.name).toBe("Pandas On Sol #28");
    expect(label?.disambiguator).toBeNull();
  });

  it("gives every copy of a shared name a distinguisher, including the first", () => {
    const labels = labelNonFungibles([
      asset({ id: "A", merkle: { ...asset().merkle!, leafId: 11 } }),
      asset({ id: "B", merkle: { ...asset().merkle!, leafId: 22 } }),
    ]);

    expect(labels.get("A")?.name).toBe("Mask · #11");
    expect(labels.get("B")?.name).toBe("Mask · #22");
    // The first is not left bare: a bare row reads as "the real one".
    expect(labels.get("A")?.disambiguator).not.toBeNull();
  });

  it("prefers the leaf id, which is the copy number a person recognises", () => {
    const labels = labelNonFungibles([
      asset({ id: "HtGMV122gYbh7RknMUe2iaRzxa9W9MBbWcGArWgDZvwe", merkle: { ...asset().merkle!, leafId: 679_684 } }),
      asset({ id: "HsiazTgzZW2wZfRnc7bm9jC1RTLL63bo62KavCVzig5v", merkle: { ...asset().merkle!, leafId: 679_685 } }),
    ]);

    expect(labels.get("HtGMV122gYbh7RknMUe2iaRzxa9W9MBbWcGArWgDZvwe")?.name).toBe("Mask · #679684");
    expect(labels.get("HsiazTgzZW2wZfRnc7bm9jC1RTLL63bo62KavCVzig5v")?.name).toBe("Mask · #679685");
  });

  it("treats case and padding as the same name, since they look the same", () => {
    const labels = labelNonFungibles([
      asset({ id: "A", name: "Mask" }),
      asset({ id: "B", name: "mask ", merkle: { ...asset().merkle!, leafId: 2 } }),
    ]);

    expect(labels.get("A")?.disambiguator).not.toBeNull();
    expect(labels.get("B")?.disambiguator).not.toBeNull();
  });

  it("falls back to a slice of the address when there is no leaf id", () => {
    const labels = labelNonFungibles([
      asset({ id: "3ZEzgjprXx22pTDFTp4QiWakxMx4VsKxbCxT7VrnyXfb", name: "Pandas", compressed: false, merkle: null }),
      asset({ id: "9XkLmNoPqRsTuVwXyZ1234567890abcdefghijkLmn", name: "Pandas", compressed: false, merkle: null }),
    ]);

    expect(labels.get("3ZEzgjprXx22pTDFTp4QiWakxMx4VsKxbCxT7VrnyXfb")?.name).toBe("Pandas · 3ZEz");
    expect(labels.get("9XkLmNoPqRsTuVwXyZ1234567890abcdefghijkLmn")?.name).toBe("Pandas · 9XkL");
  });

  it("extends the slice when two addresses start the same way", () => {
    // Addresses in one collection can share a prefix, so four characters are not
    // always enough — and a distinguisher that does not distinguish is worse
    // than none, because it looks like it should have.
    const labels = labelNonFungibles([
      asset({ id: "ABCDEFGHIJKLMNOPQRSTUVWXYZ1", name: "Pandas", compressed: false, merkle: null }),
      asset({ id: "ABCDEFGHIJKLMNOPQRSTUVWXYZ2", name: "Pandas", compressed: false, merkle: null }),
    ]);

    const first = labels.get("ABCDEFGHIJKLMNOPQRSTUVWXYZ1")?.disambiguator;
    const second = labels.get("ABCDEFGHIJKLMNOPQRSTUVWXYZ2")?.disambiguator;
    expect(first).not.toBe(second);
    expect(first).toBe("ABCD");
    expect(second?.length).toBeGreaterThan(4);
  });

  it("labels four copies of one name with four different names", () => {
    const labels = labelNonFungibles(
      [1, 2, 3, 4].map((leafId) =>
        asset({ id: `id-${leafId}`, merkle: { ...asset().merkle!, leafId } }),
      ),
    );

    const names = [...labels.values()].map((label) => label.name);
    expect(names).toHaveLength(4);
    expect(new Set(names).size).toBe(4);
  });

  it("keeps a shared name shared when only one asset in the list has it", () => {
    // A list of one is not ambiguous, even if the wallet holds other copies.
    const labels = labelNonFungibles([asset({ id: "A", name: "Mask" })]);
    expect(labels.get("A")?.name).toBe("Mask");
  });
});
