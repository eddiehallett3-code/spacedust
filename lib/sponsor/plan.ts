import {
  PublicKey,
  SystemProgram,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  BASE_FEE_LAMPORTS,
  PRIORITY_FEE_MICRO_LAMPORTS,
} from "@/lib/utils/constants";
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
 * Is this wallet actually unable to pay for one transaction?
 *
 * The sponsor exists for the wallet that has rent to reclaim and no SOL to
 * reclaim it with — not as a convenience for wallets that can pay. Two reasons
 * this is a check rather than a default:
 *
 *  - It keeps the promise the page makes ("If the wallet cannot cover that fee,
 *    Spacedust advances it") literally true.
 *  - It confines the one unresolved risk — a wallet that refuses to sign a
 *    transaction whose fee payer is somebody else — to the users who would
 *    otherwise be unable to act at all. Everyone else keeps the ordinary path.
 *
 * The comparison is against the fee the wallet would pay *without* sponsorship
 * (one signature), because that is the cost of doing nothing. A read failure
 * means `null`: never spend the sponsor's lamports on a guess.
 */
export async function sponsorOnlyIfNeeded(input: {
  connection: Connection;
  owner: PublicKey;
  feeSponsor?: string | null;
  computeUnitLimit: number;
}): Promise<FeeSponsorPlan | null> {
  const candidate = sponsorPlanFor(input.feeSponsor, input.computeUnitLimit);
  if (!candidate) return null;

  try {
    const balance = await input.connection.getBalance(input.owner, "confirmed");
    const unsponsoredFee =
      BASE_FEE_LAMPORTS +
      Math.ceil(
        (input.computeUnitLimit * PRIORITY_FEE_MICRO_LAMPORTS) / 1_000_000,
      );
    return balance < unsponsoredFee ? candidate : null;
  } catch {
    return null;
  }
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

/**
 * What a sponsored run pays back in total: one repayment per transaction.
 *
 * The repayment is per *transaction*, not per run, and it comes out of the same
 * rent the user is about to receive — so it belongs in every "you receive"
 * figure. Kept here so the planners, the hooks and the panels cannot disagree
 * about a number the user is shown.
 */
export function totalRepaymentLamports(
  sponsor: FeeSponsorPlan | null,
  transactionCount: number,
): number {
  if (!sponsor) return 0;
  return sponsor.repaymentLamports * Math.max(0, Math.trunc(transactionCount));
}

/** The network fee of one transaction, which depends on who signs it. */
export function feePerTransaction(
  sponsor: FeeSponsorPlan | null,
  priorityLamports: number,
): number {
  return BASE_FEE_LAMPORTS * (sponsor ? 2 : 1) + priorityLamports;
}
