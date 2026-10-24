import {
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import { BASE_FEE_LAMPORTS } from "@/lib/utils/constants";
import { sponsoredRepaymentLamports } from "./policy";

/**
 * Turning "a sponsor is available" into the two things a planner needs.
 *
 * Kept in one module so all five sponsored flows build the same repayment and
 * price the same fee. The sponsor pays for *two* signatures (its own and the
 * wallet's), which is the one number that changes when a plan is sponsored.
 */
export interface FeeSponsorPlan {
  /** The sponsor's public address; it is the fee payer. */
  address: string;
  /** What each sponsored transaction pays back, out of the rent it released. */
  repaymentLamports: number;
}

/** A plan for the given sponsor, or `null` when sponsorship is off. */
export function sponsorPlanFor(
  address: string | null | undefined,
  computeUnitLimit: number,
): FeeSponsorPlan | null {
  const trimmed = address?.trim();
  if (!trimmed) return null;
  try {
    // Validate before building anything: a bad address must disable the
    // sponsorship, never produce a transfer to a typo.
    void new PublicKey(trimmed);
  } catch {
    return null;
  }
  return {
    address: trimmed,
    repaymentLamports: sponsoredRepaymentLamports(computeUnitLimit),
  };
}

/** The fee payer a sponsored plan builds against. */
export function planPayer(
  owner: PublicKey,
  sponsor: FeeSponsorPlan | null,
): PublicKey {
  return sponsor ? new PublicKey(sponsor.address) : owner;
}

/**
 * The repayment instruction, appended to every transaction.
 *
 * It sits at the end of the transaction, after the closes, because that is what
 * makes it payable: the rent has to have landed in the wallet before the wallet
 * can send the fee back. This is the same ordering the Spacedust fee already
 * relies on, extended to the fee itself.
 */
export function sponsorRepaymentInstruction(
  sponsor: FeeSponsorPlan,
  owner: PublicKey,
): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: owner,
    toPubkey: new PublicKey(sponsor.address),
    lamports: sponsor.repaymentLamports,
  });
}

/** The network fee of one transaction, which depends on who signs it. */
export function feePerTransaction(
  sponsor: FeeSponsorPlan | null,
  priorityLamports: number,
): number {
  return BASE_FEE_LAMPORTS * (sponsor ? 2 : 1) + priorityLamports;
}
