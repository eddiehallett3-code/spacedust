/**
 * What to call each asset in a grid.
 *
 * A collection puts the same name on every copy it mints, so a wallet holding
 * three of them holds three rows called "Mask". That is fine until one is
 * burned: the remaining two then look like a burn that did not happen. This came
 * from a real report — two cNFTs named "Mask" were burned and a third, live one
 * was still listed, which reads as the destroyed assets coming back. The burn
 * was correct; the grid was unreadable.
 *
 * So a name is only ambiguous when it is *shared within the list being shown*.
 * A unique name is left exactly as the collection wrote it, because appending
 * anything to "Pandas On Sol #28" would be noise on every row in the app.
 */

/** Shortest address prefix used to tell two same-named assets apart. */
const MIN_PREFIX = 4;

export interface AssetLabel {
  /** The name as the collection wrote it. Never modified. */
  base: string;
  /** What to render: `base`, plus a distinguisher when the name is shared. */
  name: string;
  /** The distinguisher alone — `#679684` or `7f3a` — or null when unique. */
  disambiguator: string | null;
}

/**
 * The least an asset must expose to be labelled.
 *
 * Deliberately not `NonFungibleAsset`: the post-burn report carries only an id
 * and a name, and those rows need the same label the grid showed a moment
 * earlier — otherwise a failed burn of "Mask · #679684" is reported as "Mask",
 * which is exactly the ambiguity this file exists to remove.
 */
export interface LabelableAsset {
  id: string;
  name: string;
  /** Compressed assets prefer their leaf id as the distinguisher. */
  compressed?: boolean;
  merkle?: { leafId: number } | null;
}

/**
 * Names that count as the same to a reader.
 *
 * Case and surrounding whitespace are ignored, because "Mask" and "mask " are
 * the same word on screen — and the point of this is what the user can see, not
 * what the bytes say.
 */
function nameKey(asset: LabelableAsset): string {
  return asset.name.trim().toLowerCase();
}

/**
 * The shortest prefix of an address that is unique among those already taken.
 *
 * Four characters is the floor because anything shorter is not something a
 * person can hold in their head and compare. If even the whole address collides,
 * the whole address is returned: two identical addresses are the same asset, and
 * nothing a label can do would make them distinguishable.
 */
function shortestUniquePrefix(id: string, taken: ReadonlySet<string>): string {
  for (let length = MIN_PREFIX; length < id.length; length += 2) {
    const candidate = id.slice(0, length);
    if (!taken.has(candidate)) return candidate;
  }
  return id;
}

/**
 * Label a list of assets, keyed by asset id.
 *
 * An asset's distinguisher is, in order of preference:
 *
 *  1. **Its leaf id**, for a compressed asset — `#679684`. That is the copy
 *     number inside the merkle tree, it is what a marketplace shows, and it is
 *     what the user saw when they burned its sibling.
 *  2. **The shortest unique slice of its address**, at least four characters.
 *
 * Only assets whose name collides with another's get a suffix at all.
 */
export function labelNonFungibles(
  assets: readonly LabelableAsset[],
): Map<string, AssetLabel> {
  const groups = new Map<string, LabelableAsset[]>();
  for (const asset of assets) {
    const key = nameKey(asset);
    const group = groups.get(key);
    if (group) group.push(asset);
    else groups.set(key, [asset]);
  }

  const labels = new Map<string, AssetLabel>();

  for (const group of groups.values()) {
    if (group.length === 1) {
      const only = group[0];
      if (only) {
        labels.set(only.id, {
          base: only.name,
          name: only.name,
          disambiguator: null,
        });
      }
      continue;
    }

    // Shared name: everyone in the group needs a distinguisher, including the
    // first one. Leaving the first bare would make it look like the "real" one.
    const taken = new Set<string>();

    for (const asset of group) {
      const leaf = asset.compressed ? asset.merkle?.leafId : null;
      let disambiguator: string;

      if (typeof leaf === "number" && Number.isFinite(leaf)) {
        const candidate = `#${leaf}`;
        disambiguator = taken.has(candidate)
          ? shortestUniquePrefix(asset.id, taken)
          : candidate;
      } else {
        disambiguator = shortestUniquePrefix(asset.id, taken);
      }

      taken.add(disambiguator);
      labels.set(asset.id, {
        base: asset.name,
        name: `${asset.name} · ${disambiguator}`,
        disambiguator,
      });
    }
  }

  return labels;
}
