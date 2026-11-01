/**
 * Who qualifies for the holder waiver, and how it is decided.
 *
 * Pure, so the rule can be tested without a network: the collection, the count,
 * and the reading of an index response all live here, and the route that fetches
 * the response does nothing but fetch it.
 *
 * WHY HOLDING RATHER THAN BURNING: The Void does burn pNFTs, and this collection
 * is entirely pNFTs, so "send ten to The Void" is buildable — but a burn leaves
 * nothing on-chain to read afterwards, so proving it would need a minted receipt
 * or an index of every burn. Holding needs neither: the wallet either has ten
 * verified members of the collection right now, or it does not.
 *
 * The consequence, stated plainly because it is the trade: the perk stops when
 * the tokens leave the wallet. That is not a loophole to close, it is the model —
 * it is a membership, not a purchase.
 */

/**
 * The Turtles collection.
 *
 * The *collection* mint, not any individual NFT: every Turtle has its own mint
 * (`7md6rW8…` is #6241), and this is the parent those mints point at in their
 * metadata. Read from Turtle #6241's metadata account, where it is recorded with
 * `verified: true` — the flag the collection authority signs, and the reason a
 * copycat collection can point at the same key without qualifying.
 */
export const HOLDER_COLLECTION = "EG1XZWddWV5H1HADtXiWNqNwuHBoBSeH4f21AnfdZx3x";

/** How many must be held. One number, so the copy and the check cannot disagree. */
export const HOLDER_REQUIRED = 10;

export interface HolderStatus {
  /** True when `held >= HOLDER_REQUIRED`. */
  entitled: boolean;
  /** How many the wallet holds, capped at `HOLDER_REQUIRED` — the exact count past ten has no use and would invite copy that reads "hold 37". */
  held: number;
  /** What was required, so a client can render "7 of 10" without hardcoding it. */
  required: number;
  /** The collection the count is against. */
  collection: string;
}

/**
 * Build a status from a count.
 *
 * Takes the count rather than the assets so the caller decides how many to page
 * for: asking the index for ten and multiplying is the difference between one
 * cheap call and paging a wallet that holds thousands of NFTs.
 */
export function holderStatus(count: number): HolderStatus {
  // A count that is not a finite number is not a count. `Infinity` would pass a
  // `>= required` test and hand out a waiver on the strength of a broken index
  // response, so it is refused here rather than at the call site.
  const safe = Number.isFinite(count) ? Math.trunc(count) : 0;
  const held = Math.max(0, Math.min(safe, HOLDER_REQUIRED));
  return {
    entitled: held >= HOLDER_REQUIRED,
    held,
    required: HOLDER_REQUIRED,
    collection: HOLDER_COLLECTION,
  };
}

/** The answer for a wallet that cannot be read: not entitled, and no claim made. */
export function unavailableStatus(): HolderStatus {
  return { entitled: false, held: 0, required: HOLDER_REQUIRED, collection: HOLDER_COLLECTION };
}

/**
 * How many of the collection the index says this wallet holds.
 *
 * `total` is the authoritative number. `items.length` is a fallback for the
 * response shape where the index pages assets without a total, and the two are
 * capped at the requirement so the arithmetic can never exceed what was asked
 * for.
 */
export function countFromIndexResponse(response: {
  total?: number;
  items?: unknown[];
}): number {
  if (typeof response.total === "number" && Number.isFinite(response.total)) {
    return Math.max(0, response.total);
  }
  return Array.isArray(response.items) ? response.items.length : 0;
}
