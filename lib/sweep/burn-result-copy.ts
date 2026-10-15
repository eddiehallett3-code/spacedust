import { formatSol, pluralize } from "@/lib/utils/format";

/**
 * What to say after a burn, derived from what actually burned.
 *
 * The result screen used to take its wording from the *tab* it was rendered in:
 * a batch of one NFT and one cNFT, reported while the cNFT tab was open, read
 * "2 cNFTs burned — nothing returned, a compressed NFT holds no rent" — wrong
 * count, wrong noun, and a rent claim that contradicted the NFT that had just
 * returned its rent. The tab knows nothing about the batch; the outcomes do.
 *
 * So the copy lives here, as a pure function of the outcomes, per class, because
 * each class leaves something different behind and the user is owed the one that
 * applies to what they burned.
 */

/** What an asset is, for the purpose of describing its burn. */
export interface Burnableish {
  compressed: boolean;
  interface: string;
  status: "burned" | "failed";
}

export interface BurnedCounts {
  /** Ordinary NFTs: an SPL token account, closed by the burn. */
  nfts: number;
  /** Core assets: the account survives as a one-byte husk. */
  core: number;
  /** Compressed leaves: nothing is left, and nothing was ever held. */
  cnfTs: number;
  total: number;
}

/** Count what actually burned, by class. */
export function countBurned(outcomes: readonly Burnableish[]): BurnedCounts {
  const burned = outcomes.filter((outcome) => outcome.status === "burned");
  const core = burned.filter(
    (outcome) => !outcome.compressed && outcome.interface === "MplCoreAsset",
  ).length;
  const cnfTs = burned.filter((outcome) => outcome.compressed).length;
  return {
    core,
    cnfTs,
    nfts: burned.length - core - cnfTs,
    total: burned.length,
  };
}

export interface BurnResultCopy {
  /** "1 NFT and 1 cNFT burned", "2 cNFTs burned", … */
  headline: string;
  /** The rent line: what came back, and what could not. */
  detail: string;
  /** What the user should expect their wallet to show afterwards. */
  note: string;
}

export function burnResultCopy(
  counts: BurnedCounts,
  options: { failed: number; rentLamports: number },
): BurnResultCopy {
  const { nfts, core, cnfTs } = counts;
  const accountLike = nfts + core;
  const failedSuffix =
    options.failed > 0 ? ` · ${pluralize(options.failed, "asset")} did not burn` : "";

  // ── Headline: name the mixture, not the tab ───────────────────────────────
  let headline: string;
  if (accountLike > 0 && cnfTs > 0) {
    headline = `${pluralize(accountLike, "NFT")} and ${pluralize(cnfTs, "cNFT")} burned`;
  } else if (cnfTs > 0) {
    headline = `${pluralize(cnfTs, "cNFT")} burned`;
  } else {
    headline = `${pluralize(accountLike, "NFT")} burned`;
  }

  // ── Detail: the rent story, which differs per class ───────────────────────
  const rent = `${formatSol(options.rentLamports)} of rent reclaimed`;
  let detail: string;
  if (accountLike === 0) {
    detail = "Nothing returned — a compressed NFT holds no rent";
  } else if (cnfTs === 0) {
    detail = rent;
  } else {
    // Both happened in one transaction, so say both.
    detail = `${rent} — a compressed NFT returns nothing, because a leaf is not an account`;
  }

  // ── Note: what the wallet will still show, per class, with no false calm ──
  const parts: string[] = ["Destroyed on chain."];
  if (nfts > 0) {
    parts.push(
      "Each NFT's token account is closed, so its rent is back.",
    );
  }
  if (core > 0) {
    parts.push(
      "A Core asset is not closed: the program leaves its account as a one-byte husk, so a wallet that does not check the burned flag may keep listing it.",
    );
  }
  if (cnfTs > 0) {
    parts.push(
      "A cNFT leaves nothing behind to tell a wallet's list it is gone, so it can keep appearing for a good while.",
    );
  }
  parts.push("None of it can be recovered, and most wallets let you hide it.");

  return { headline: headline + failedSuffix, detail, note: parts.join(" ") };
}
