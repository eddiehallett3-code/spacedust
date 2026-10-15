/**
 * Salvage domain types.
 *
 * Kept apart from `types/token.ts` because a `.sol` domain is not an asset in any
 * of the senses the rest of the app uses: it has no balance, no price, no route,
 * and the only thing it is worth here is the rent its account holds. That is also
 * why deleting one needs its own vocabulary — it is not "closing an unused
 * account", it is giving the name up.
 */

/** One `.sol` domain a wallet owns, exactly as `/api/domains` reports it. */
export interface SalvageDomain {
  /** The name, without the `.sol` suffix. */
  name: string;
  /** The name account: what a delete acts on. */
  address: string;
  /** Rent held in that account, which is what a delete returns. */
  lamports: number;
  /** Account size — the deposit is set by the name's length at registration. */
  bytes: number;
  /**
   * The owner recorded in the registry's header.
   *
   * Checked against the connected wallet before anything is offered, because the
   * delete is signed by the owner and a stale list could otherwise present
   * somebody else's domain as the user's to destroy.
   */
  owner: string | null;
  /** Wrapped as an NFT, and refused until that route has been verified. */
  tokenized: boolean;
}

/** What happened to one domain in a batch, after it was submitted. */
export interface DomainDeleteOutcome {
  address: string;
  name: string;
  status: "deleted" | "failed";
  signature: string | null;
  error: string | null;
  /** Rent that account held. Only counted when the delete landed. */
  rentLamports: number;
  /** The Spacedust fee on that rent. */
  feeLamports: number;
}

/** The end-of-batch summary. */
export interface DomainDeleteSummary {
  requested: number;
  deletedCount: number;
  failedCount: number;
  rentLamports: number;
  reclaimFeeLamports: number;
  /** Rent minus the fee: what reached the wallet. */
  netRentLamports: number;
  /** Network and priority fees, owed whatever the outcome. */
  feeLamports: number;
  signatures: string[];
}
