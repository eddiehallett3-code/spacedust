import type { NonFungibleAsset } from "@/types/token";

/**
 * Split a selection into burn rounds.
 *
 * A burn changes its merkle tree's root, so two leaves from one tree cannot be
 * proved against the same root. Each round takes at most one cNFT per tree;
 * different trees share a round. Uncompressed assets are independent and go in
 * the first round. The executor builds each round after the previous confirms,
 * fetching fresh proofs, which is what makes a same-tree selection usable.
 */
export function buildBurnRounds(
  assets: NonFungibleAsset[],
): NonFungibleAsset[][] {
  const byTree = new Map<string, NonFungibleAsset[]>();
  const independent: NonFungibleAsset[] = [];

  for (const asset of assets) {
    if (asset.compressed && asset.merkle) {
      const tree = asset.merkle.tree;
      const list = byTree.get(tree);
      if (list) list.push(asset);
      else byTree.set(tree, [asset]);
    } else {
      independent.push(asset);
    }
  }

  if (byTree.size === 0) return [assets];

  const lists = [...byTree.values()];
  const rounds: NonFungibleAsset[][] = [];
  const count = Math.max(...lists.map((list) => list.length));
  for (let index = 0; index < count; index += 1) {
    const round = index === 0 ? [...independent] : [];
    for (const list of lists) {
      const asset = list[index];
      if (asset) round.push(asset);
    }
    if (round.length > 0) rounds.push(round);
  }
  return rounds;
}
