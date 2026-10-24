import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import {
  CLOSE_COMPUTE_UNIT_LIMIT,
  PRIORITY_FEE_MICRO_LAMPORTS,
  RECLAIM_FEE_BPS,
  TOKEN_PROGRAM_ID,
} from "@/lib/utils/constants";
import { getPublicFeeWallet } from "@/lib/config/public-env";
import {
  createCloseAccountInstruction,
  createComputeBudgetInstructions,
} from "@/lib/solana/instructions";
import { feeFromRentLamports, fetchRentMinimums } from "@/lib/solana/rent";
import { packTransactions, type PackUnit } from "@/lib/solana/pack";
import { simulateAll, splitBySimulation } from "@/lib/solana/simulate";
import { auditPlanBeforeSigning } from "@/lib/security/audit-plan";
import {
  feePerTransaction,
  planPayer,
  sponsorPlanFor,
  sponsorRepaymentInstruction,
  type FeeSponsorPlan,
} from "@/lib/sponsor/plan";
import { isValidSolanaAddress } from "@/lib/utils/sanitize";
import type { PackedTransaction, SimulationOutcome } from "@/types/sweep";
import type { WrappedSolAccount } from "@/types/salvage";

/**
 * Unwrapping wrapped SOL.
 *
 * A wSOL account is a *native* token account: the token program lets it be
 * closed while its amount is non-zero, and the close returns the account's
 * whole lamport balance — the wrapped SOL plus the rent deposit — to the owner.
 * There is no transfer and no second transaction: closing it is the unwrap.
 *
 * The fee is the one number here that is policy rather than fact, and it is
 * charged on the **rent only**. Taking a percentage of `lamports` would tax the
 * user's own principal, which is not rent being recovered and was never ours to
 * charge for. `rentLamports` is read by the route as `lamports - amount`, per
 * account, so unsynced lamports are treated as rent rather than as balance.
 *
 * Nothing here signs or sends.
 */

export interface PlanUnwrapInput {
  connection: Connection;
  owner: PublicKey;
  accounts: readonly WrappedSolAccount[];
  /** The fee sponsor's address, when one is configured. A request only. */
  feeSponsor?: string | null;
}

export interface PlanUnwrapResult {
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  warnings: string[];
  blockhash: string;
  lastValidBlockHeight: number;
  /** Base fee plus priority fee for every transaction this plan will send. */
  estimatedFeeLamports: number;
  /** Accounts a successful run closes. */
  closeCount: number;
  /** The wrapped SOL those closes release, in lamports. */
  wrappedLamports: number;
  /** Rent those closes return, in lamports. The only feeable part. */
  rentLamports: number;
  /** The Spacedust fee on that rent. */
  reclaimFeeLamports: number;
  /** Wrapped SOL + rent − fee: what actually reaches the wallet. */
  netReturnedLamports: number;
  /** True when at least one packed transaction failed to simulate. */
  hasFailures: boolean;
  /** The sponsor advancing this fee, when one did. */
  sponsor: FeeSponsorPlan | null;
}

export class UnwrapError extends Error {
  override readonly name = "UnwrapError";

  constructor(
    message: string,
    readonly hint: string,
    readonly warnings: string[] = [],
  ) {
    super(message);
  }
}

/**
 * Split the list into accounts that can be closed and accounts that cannot.
 *
 * Kept pure and separate from the network so the same rule can be shown in the
 * panel before a preview exists.
 */
export function planWrappedSolUnwraps(
  accounts: readonly WrappedSolAccount[],
  owner: string,
): {
  closeable: WrappedSolAccount[];
  skipped: Array<{ account: WrappedSolAccount; reason: string }>;
  wrappedLamports: number;
  rentLamports: number;
} {
  const closeable: WrappedSolAccount[] = [];
  const skipped: Array<{ account: WrappedSolAccount; reason: string }> = [];
  const seen = new Set<string>();
  let wrappedLamports = 0;
  let rentLamports = 0;

  for (const account of accounts) {
    if (seen.has(account.address)) continue;
    seen.add(account.address);

    if (!isValidSolanaAddress(account.address)) {
      skipped.push({ account, reason: "its address could not be verified" });
      continue;
    }
    if (account.closeAuthority !== null && account.closeAuthority !== owner) {
      skipped.push({
        account,
        reason: `another key (${account.closeAuthority.slice(0, 6)}…) is its close authority`,
      });
      continue;
    }

    if (
      !Number.isSafeInteger(account.lamports) ||
      account.lamports <= 0 ||
      !Number.isSafeInteger(account.amountLamports) ||
      account.amountLamports <= 0
    ) {
      skipped.push({ account, reason: "it holds no wrapped SOL to return" });
      continue;
    }

    closeable.push(account);
    wrappedLamports += account.amountLamports;
    rentLamports += Math.max(0, account.rentLamports);
  }

  return { closeable, skipped, wrappedLamports, rentLamports };
}

/**
 * The Spacedust fee on one wrapped-SOL close.
 *
 * Exported so the fee base is testable in isolation: it is `rentLamports`, not
 * the account's whole balance. A test that only checked a total could pass while
 * the principal was being taxed.
 */
export function wrappedSolFeeLamports(account: WrappedSolAccount): number {
  return feeFromRentLamports(Math.max(0, account.rentLamports), RECLAIM_FEE_BPS);
}

export async function planWrappedSolUnwrapsTx(
  input: PlanUnwrapInput,
): Promise<PlanUnwrapResult> {
  const { connection, owner, accounts } = input;
  const warnings: string[] = [];
  const units: PackUnit[] = [];
  const ownerAddress = owner.toBase58();

  const plan = planWrappedSolUnwraps(accounts, ownerAddress);
  const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);

  // A funded fee wallet is a precondition, not a detail: Solana refuses to
  // create an account below the rent-exempt minimum, so a fee sent to a fresh
  // address fails the whole transaction rather than creating anything.
  const rent = await fetchRentMinimums(connection);
  const feeWallet = getPublicFeeWallet();
  let feeEnabled = false;

  if (feeWallet) {
    try {
      const info = await connection.getAccountInfo(new PublicKey(feeWallet));
      feeEnabled = (info?.lamports ?? 0) >= rent.emptyAccount;
    } catch {
      feeEnabled = false;
    }
    if (!feeEnabled) {
      warnings.push(
        "No fee was charged: the fee wallet has not been funded yet, and a fee this small cannot create it.",
      );
    }
  }

  for (const { account, reason } of plan.skipped) {
    warnings.push(`Left ${account.address.slice(0, 6)}… wrapped: ${reason}.`);
  }

  for (const account of plan.closeable) {
    try {
      const accountKey = new PublicKey(account.address);
      const instructions = [
        // A native token account may be closed with a non-zero amount; the
        // program pays the whole lamport balance — wrapped SOL and rent — to
        // the owner. This is the unwrap.
        createCloseAccountInstruction(accountKey, owner, tokenProgram),
      ];

      const accountFee = wrappedSolFeeLamports(account);
      if (feeEnabled && feeWallet && accountFee > 0) {
        instructions.push(
          SystemProgram.transfer({
            fromPubkey: owner,
            toPubkey: new PublicKey(feeWallet),
            lamports: accountFee,
          }),
        );
      }

      units.push({
        mint: account.address,
        instructions,
        rentReclaim: true,
      });
    } catch (error) {
      warnings.push(
        `Skipped ${account.address.slice(0, 6)}…: ${
          error instanceof Error ? error.message : "could not build a close."
        }`,
      );
    }
  }

  if (units.length === 0) {
    throw new UnwrapError(
      "None of these wrapped SOL accounts could be closed.",
      "Rescan the wallet and try again.",
      warnings,
    );
  }

  const blockhashInfo = await connection.getLatestBlockhash("confirmed");
  const prologue = createComputeBudgetInstructions(
    CLOSE_COMPUTE_UNIT_LIMIT,
    PRIORITY_FEE_MICRO_LAMPORTS,
  );

  // The advance is only worth taking when the rent being returned covers it and
  // Spacedust's fee. A wSOL account whose rent cannot pay both is still
  // unwrappable — just not on the sponsor's lamports.
  const totalRentLamports = plan.closeable.reduce(
    (sum, account) => sum + Math.max(0, account.rentLamports),
    0,
  );
  const totalFeeLamports = feeEnabled
    ? plan.closeable.reduce(
        (sum, account) => sum + wrappedSolFeeLamports(account),
        0,
      )
    : 0;
  const candidate = sponsorPlanFor(input.feeSponsor, CLOSE_COMPUTE_UNIT_LIMIT);
  const sponsor =
    candidate &&
    totalRentLamports - totalFeeLamports > candidate.repaymentLamports
      ? candidate
      : null;
  if (candidate && !sponsor) {
    warnings.push(
      "The rent is smaller than the network fee a sponsor would advance, so this one needs SOL in the wallet.",
    );
  }
  const tail = sponsor ? [sponsorRepaymentInstruction(sponsor, owner)] : [];

  const packedResult = packTransactions({
    units,
    prologue,
    payer: planPayer(owner, sponsor),
    blockhash: blockhashInfo.blockhash,
    lookupTables: [],
    tail,
  });

  warnings.push(
    ...packedResult.dropped.map(
      (dropped) => `Skipped ${dropped.mint.slice(0, 6)}…: ${dropped.reason}`,
    ),
  );

  if (packedResult.transactions.length === 0) {
    throw new UnwrapError(
      "These wrapped SOL accounts are too large to close in one go.",
      "Try closing fewer at a time.",
      warnings,
    );
  }

  const simulated = await simulateAll(connection, packedResult.transactions);

  if (simulated.every((simulation) => !simulation.ok)) {
    const firstError = simulated.find((simulation) => !simulation.ok);
    throw new UnwrapError(
      firstError?.error ?? "Every transaction failed to simulate.",
      "Nothing was signed or sent. Rescan the wallet and try again.",
      warnings,
    );
  }

  const priorityFee = Math.ceil(
    (CLOSE_COMPUTE_UNIT_LIMIT * PRIORITY_FEE_MICRO_LAMPORTS) / 1_000_000,
  );

  const packedAccounts = new Set(
    packedResult.transactions.flatMap((tx) => tx.mints),
  );
  const packedList = plan.closeable.filter((account) =>
    packedAccounts.has(account.address),
  );

  // ── The audit: what is about to be signed ────────────────────────────────
  // An unwrap is a close like any other, and it moves *more* than rent: the
  // wrapped balance comes back with it. The audit proves the rent destination is
  // the wallet, the account is one the plan listed, and the fee is the only SOL
  // leaving.
  auditPlanBeforeSigning({
    prologue,
    units,
    packed: packedResult.transactions,
    tail,
    expected: {
      flow: "salvage",
      owner: ownerAddress,
      feeWallet,
      expectedFeeLamports: feeEnabled
        ? packedList.reduce(
            (sum, account) => sum + wrappedSolFeeLamports(account),
            0,
          )
        : 0,
      expectedSubjects: packedList.map((account) => account.address),
      expectedCloses: packedList.map((account) => account.address),
      sponsor: sponsor
        ? {
            address: sponsor.address,
            expectedLamports: sponsor.repaymentLamports,
          }
        : null,
    },
  });

  // A transaction that failed simulation is not signed: it would be refused, or
  // revert after the fee was paid.
  const { packed, simulations, failed } = splitBySimulation(
    packedResult.transactions,
    simulated,
  );
  for (const failure of failed) {
    warnings.push(
      `Skipped one transaction: it failed its simulation (${failure.error ?? "no detail"}).`,
    );
  }
  if (packed.length === 0) {
    throw new UnwrapError(
      "None of these unwrap transactions could be simulated.",
      "Nothing was signed or sent. Rescan the wallet and try again.",
      warnings,
    );
  }

  const signedAccounts = new Set(packed.flatMap((tx) => tx.mints));
  const signedList = packedList.filter((account) =>
    signedAccounts.has(account.address),
  );
  const wrappedLamports = signedList.reduce(
    (sum, account) => sum + account.amountLamports,
    0,
  );
  const rentLamports = signedList.reduce(
    (sum, account) => sum + Math.max(0, account.rentLamports),
    0,
  );
  const reclaimFeeLamports = feeEnabled
    ? signedList.reduce((sum, account) => sum + wrappedSolFeeLamports(account), 0)
    : 0;

  return {
    packed,
    simulations,
    warnings,
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
    estimatedFeeLamports: packed.length * feePerTransaction(sponsor, priorityFee),
    closeCount: signedAccounts.size,
    wrappedLamports,
    rentLamports,
    reclaimFeeLamports,
    netReturnedLamports: wrappedLamports + rentLamports - reclaimFeeLamports,
    hasFailures: failed.length > 0,
    sponsor,
  };
}
