import { describe, expect, it } from "vitest";
import { hideAssets, mergeIds, removeId } from "./hidden-assets";

const asset = (id: string) => ({ id, name: `#${id}` });

describe("mergeIds", () => {
  it("keeps what is already there, so an earlier hide is never forgotten", () => {
    expect(mergeIds(["a"], ["b"])).toEqual(["a", "b"]);
  });

  it("does not duplicate an asset hidden twice", () => {
    // Two tabs, or a rescan that still lists it because the index lags.
    expect(mergeIds(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("is unchanged when nothing was added", () => {
    expect(mergeIds(["a"], [])).toEqual(["a"]);
  });

  it("starts from nothing without inventing an entry", () => {
    expect(mergeIds([], [])).toEqual([]);
  });
});

describe("removeId", () => {
  it("undoes a hide", () => {
    expect(removeId(["a", "b"], "a")).toEqual(["b"]);
  });

  it("changes nothing when the id was not hidden", () => {
    expect(removeId(["a", "b"], "c")).toEqual(["a", "b"]);
  });

  it("leaves the rest in order", () => {
    expect(removeId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});

describe("hideAssets", () => {
  it("drops a hidden asset", () => {
    const kept = hideAssets([asset("a"), asset("b")], new Set(["a"]));
    expect(kept.map((item) => item.id)).toEqual(["b"]);
  });

  it("keeps everything else, in order", () => {
    const kept = hideAssets([asset("a"), asset("b"), asset("c")], new Set(["b"]));
    expect(kept.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("is a no-op with nothing hidden", () => {
    const all = [asset("a"), asset("b")];
    expect(hideAssets(all, new Set())).toEqual(all);
  });

  it("hides a hidden id whatever kind of asset carried it", () => {
    // A cNFT id is a merkle leaf, not an account — there is nothing on chain
    // left to check, so the remembered id has to be enough on its own.
    const leaf = { id: "5fY...leaf", compressed: true };
    expect(hideAssets([leaf], new Set(["5fY...leaf"]))).toEqual([]);
  });
});
