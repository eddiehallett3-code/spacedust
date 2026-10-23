/**
 * Salvage domain types.
 *
 * Kept apart from `types/token.ts` because a `.sns` domain is not an asset in any
 * of the senses the rest of the app uses: it has no balance, no price, no route,
 * and the only thing it is worth here is the rent its account holds. That is also
 * why deleting one needs its own vocabulary — it is not "closing an unused
 * account", it is giving the name up.
 */

/**
 * A Pump.fun user volume accumulator.
 *
 * Pump.fun creates one small program-owned account per wallet to track volume
 * for fee tiers. It holds only rent; closing it returns that rent and resets the
 * volume tracking for the wallet. It is not a token account and cannot be found
 * by `getTokenAccountsByOwner` — the address is the program's PDA.
 */
export interface PumpAccumulator {
  /** The derived `user_volume_accumulator` PDA. */
  address: string;
  /** Lamports the account holds, all returned to the owner on close. */
  lamports: number;
}

/** One Token-2022 account holding more lamports than its rent-exempt minimum. */
export interface ExcessRentAccount {
  /** The token account with the extra lamports. */
  address: string;
  /** The mint it holds, used to identify the asset in the UI. */
  mint: string;
  /** Current lamports in the account. */
  lamports: number;
  /** The rent-exempt minimum for this account's data size. */
  rentLamports: number;
  /** `lamports - rentLamports`; what the withdraw returns. */
  excessLamports: number;
  /** Account data size, the input to the rent-exempt minimum. */
  space: number;
  /** Name/symbol from the wallet scan when the mint is a known asset. */
  label?: string | null;
}

/** One `.sns` domain a wallet owns, exactly as `/api/domains` reports it. */
export interface SalvageDomain {
  /** The name, without the `.sns` suffix. */
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

/**
 * One non-empty wrapped-SOL account.
 *
 * A wSOL account is a native token account: its lamports are the wrapped
 * balance **plus** the account's rent deposit, and closing it returns all of
 * them to the owner. The two are kept apart because the fee applies only to
 * the rent, never to the SOL the user wrapped.
 */
export interface WrappedSolAccount {
  address: string;
  /** Wrapped balance in lamports, as the token program reports it. */
  amountLamports: number;
  /** Total lamports closing the account returns: wrapped balance + rent. */
  lamports: number;
  /** The rent deposit inside `lamports`, which is the only feeable part. */
  rentLamports: number;
  /** A close authority, when one is set. A foreign key blocks the close. */
  closeAuthority: string | null;
}
