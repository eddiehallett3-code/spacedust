/**
 * Payload domain types.
 *
 * Kept separate from `types/sweep.ts` because a send is a different shape of
 * thing from a swap: nothing is priced, nothing is routed, and the only money
 * involved is rent — freed on the way out, and spent at the destination to give
 * the recipient an account to receive into.
 */

/** What happened to one item in a batch, after it was submitted. */
export interface PayloadOutcome {
  mint: string;
  kind: "token" | "nft" | "cnft" | "sol";
  label: string;
  status: "sent" | "failed" | "skipped";
  /** Solscan-linkable signature, when it was submitted. */
  signature: string | null;
  /** Why it did not happen. Null for a send that landed. */
  error: string | null;
  /** True when this item's account was closed and its rent returned. */
  rentReclaimed: boolean;
  /** Rent that account freed, in lamports. */
  rentLamports: number;
  /** Payload's fee on that rent, in lamports. */
  feeLamports: number;
  /**
   * What creating the recipient's account cost, in lamports.
   *
   * A real cost the *sender* bears, which is why it is attributed per item
   * rather than folded into a total: one NFT can cost more in account rent than
   * it frees by closing its own account.
   */
  recipientAccountLamports: number;
}

/** The end-of-batch summary shown once everything has settled. */
export interface PayloadSummary {
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  /** Accounts closed, each of which returned its rent. */
  closedCount: number;
  /** Gross rent the closes returned, in lamports. */
  rentLamports: number;
  /** Payload's fee, taken from that rent. */
  feeLamports: number;
  /** Paid at the destination to create accounts for the recipient. */
  recipientAccountLamports: number;
  /** Network and priority fees, which are owed whatever the outcome. */
  networkFeeLamports: number;
  /**
   * What the user is actually up on the rent side.
   *
   * Gross rent, less the fee, less the deposits paid at the destination. Shown
   * as the headline figure because it is the honest one — the gross number would
   * read as a gain when the batch spent more than it freed.
   */
  netRentLamports: number;
  signatures: string[];
}
