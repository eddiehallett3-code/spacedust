import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import {
  CLOSE_COMPUTE_UNIT_LIMIT,
  PRIORITY_FEE_MICRO_LAMPORTS,
  RECLAIM_FEE_BPS,
} from "@/lib/utils/constants";
import { getPublicFeeWallet } from "@/lib/config/public-env";
import {
  createCloseAccountInstruction,
  createComputeBudgetInstructions,
  tokenProgramFor,
} from "@/lib/solana/instructions";
import { feeFromRentLamports, fetchRentMinimums } from "@/lib/solana/rent";
import { packTransactions, type PackUnit } from "@/lib/solana/pack";
import { simulateAll, splitBySimulation } from "@/lib/solana/simulate";
import { auditPlanBeforeSigning } from "@/lib/security/audit-plan";
import {
  feePerTransaction,
  planPayer,
  sponsorOnlyIfNeeded,
  sponsorRepaymentInstruction,
  type FeeSponsorPlan,
} from "@/lib/sponsor/plan";
import {
  EMPTY_ACCOUNT_SKIP_TEXT,
  planEmptyAccountCloses,
} from "@/lib/sweep/empty-accounts";
import type { PackedTransaction, SimulationOutcome } from "@/types/sweep";
import type { EmptyTokenAccount } from "@/types/token";

/**
 * Rent reclaim — closing token accounts that are already empty.
 *
 * The sweep closes the accounts *its own swaps* empty, which covers the dust it
 * just sold. It cannot help an account that was already empty when the user
 * arrived: a wallet that sold a token somewhere else, or moved one out by hand,
 * leaves the account behind holding its rent and nothing else. No balance means
 * no swap to trigger the close, so that rent sat there permanently.
 *
 * Nothing here is a judgement call. The accounts hold no assets, so there is
 * nothing to *value* and no way to be wrong about it — the only question is which
 * of them the token program will let us close, and `planEmptyAccountCloses`
 * answers that from rules settled against mainnet.
 *
 * There is now one thing to price: the fee on the rent these closes return, taken
 * per account from each account's own deposit. That is the only number in this file
 * that is a policy rather than a fact, and it is stated where the user meets it.
 * module turns that answer into packed, simulated transactions.
 */

export interface PlanCloseInput {
  connection: Connection;
  owner: PublicKey;
  accounts: readonly EmptyTokenAccount[];
  /**
   * The fee sponsor's address, when one is configured. A request only: the plan
   * declines it when the rent does not cover the advance and Spacedust's fee.
   */
  feeSponsor?: string | null;
}

export interface PlanCloseResult {
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  warnings: string[];
  blockhash: string;
  lastValidBlockHeight: number;
  /** Base fee plus priority fee for every transaction this plan will send. */
  estimatedFeeLamports: number;
  /** Accounts a successful run closes. */
  closeCount: number;
  /** Rent those closes return to the owner, in lamports. */
  rentLamports: number;
  /**
   * The Spacedust fee on that rent, in lamports.
   *
   * Taken per closed account rather than per transaction, because the packer
   * decides how many units share a transaction and a per-transaction fee would
   * silently scale with the grouping. Zero when fees are switched off or the fee
   * wallet is not funded, so it can be subtracted from `rentLamports` blindly.
   */
  reclaimFeeLamports: number;
  /** Rent minus that fee: what actually lands in the wallet. */
  netRentLamports: number;
  /** True when at least one packed transaction failed to simulate. */
  hasFailures: boolean;
  /**
   * The sponsor advancing this plan's fee, when one did. Its presence means the
   * fee payer is the sponsor and the signature step must co-sign server-side.
   */
  sponsor: FeeSponsorPlan | null;
}

/** A planning failure, with the warnings gathered along the way. */
export class CloseError extends Error {
  override readonly name = "CloseError";

  constructor(
    message: string,
    readonly hint: string,
    readonly warnings: string[] = [],
  ) {
    super(message);
  }
}

export async function planEmptyAccountClosesTx(
  input: PlanCloseInput,
): Promise<PlanCloseResult> {
  const { connection, owner, accounts } = input;
  const warnings: string[] = [];
  const units: PackUnit[] = [];

  const plan = planEmptyAccountCloses(accounts, owner.toBase58());

  // The fee wallet, when fees are switched on — and it has to be *funded*: Solana
  // refuses to create an account below the rent-exempt minimum, so a fee sent to a
  // fresh address fails the whole transaction with `InsufficientFundsForRent`
  // rather than creating anything. Verified once for The Void; identical here.
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

  // Every refusal is reported by reason. A user who sees eight accounts listed
  // and six closed is owed the other two, or the row reads as a bug.
  for (const { account, reason } of plan.skipped) {
    warnings.push(
      `Left ${account.address.slice(0, 6)}… open: ${EMPTY_ACCOUNT_SKIP_TEXT[reason]}.`,
    );
  }

  for (const account of plan.closeable) {
    try {
      const tokenAccount = new PublicKey(account.address);
      // Which program owns the account decides which `closeAccount` to build: a
      // Token-2022 account cannot be closed by the legacy program.
      const tokenProgram = tokenProgramFor(account.program);

      const instructions = [
        // The close names the account, the owner as the rent destination, and the
        // owner again as the signing authority — verified against mainnet,
        // including on a frozen account, where it still succeeds.
        createCloseAccountInstruction(tokenAccount, owner, tokenProgram),
      ];

      // The fee, taken from the rent this close is about to return. It sits after
      // the close so it is always funded — the close credits the account's whole
      // deposit to `owner` first — and it is priced per account, because the
      // packer decides how many units share a transaction.
      const accountFee = feeFromRentLamports(account.lamports, RECLAIM_FEE_BPS);
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
        // It is entirely a rent reclaim: the lamports are the point of the unit.
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
    throw new CloseError(
      "None of these accounts could be prepared to close.",
      "Rescan the wallet and try again.",
      warnings,
    );
  }

  const blockhashInfo = await connection.getLatestBlockhash("confirmed");
  const prologue = createComputeBudgetInstructions(
    CLOSE_COMPUTE_UNIT_LIMIT,
    PRIORITY_FEE_MICRO_LAMPORTS,
  );

  // ── The fee sponsor, if this rent can pay it back ─────────────────────────
  // The repayment and Spacedust's fee both come out of the same deposit, and a
  // deposit smaller than the two would produce a sponsored transaction that
  // cannot repay its own advance. The sponsor's server would refuse it; declining
  // here is what lets the preview say who is paying before anything is signed.
  const totalRentLamports = plan.closeable.reduce(
    (sum, account) => sum + account.lamports,
    0,
  );
  const totalFeeLamports = feeEnabled
    ? plan.closeable.reduce(
        (sum, account) =>
          sum + feeFromRentLamports(account.lamports, RECLAIM_FEE_BPS),
        0,
      )
    : 0;
  const candidate = await sponsorOnlyIfNeeded({
    connection,
    owner,
    feeSponsor: input.feeSponsor,
    computeUnitLimit: CLOSE_COMPUTE_UNIT_LIMIT,
  });
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
    // A close references only its own account and the owner, so there is nothing
    // an address lookup table could shrink.
    lookupTables: [],
    tail,
  });

  warnings.push(
    ...packedResult.dropped.map(
      (dropped) => `Skipped ${dropped.mint.slice(0, 6)}…: ${dropped.reason}`,
    ),
  );

  if (packedResult.transactions.length === 0) {
    throw new CloseError(
      "These accounts are too large to close in one go.",
      "Try closing fewer at a time.",
      warnings,
    );
  }

  // Priced from the accounts that actually made it into a transaction, not from
  // the ones we set out to close: a dropped unit returns nothing, and quoting its
  // rent would overstate what the user is about to receive.
  const packedAccounts = new Set(
    packedResult.transactions.flatMap((tx) => tx.mints),
  );
  const packedList = plan.closeable.filter((account) =>
    packedAccounts.has(account.address),
  );

  // Summed per account, exactly as the instructions were built, rather than
  // computed from the total: flooring a percentage of a sum is not the same as
  // summing floored percentages, and the difference would be a lamport the user
  // was charged and never told about. Zero when fees are off, so the subtraction
  // below stays unconditional.
  const feeFor = (accounts: typeof packedList): number =>
    feeEnabled
      ? accounts.reduce(
          (sum, account) =>
            sum + feeFromRentLamports(account.lamports, RECLAIM_FEE_BPS),
          0,
        )
      : 0;

  // ── The audit: what is about to be signed ────────────────────────────────
  // Same gate every other flow goes through: each close must name the wallet as
  // the rent destination, act only on an account the plan listed, and carry no
  // SOL beyond the fee this plan computed.
  auditPlanBeforeSigning({
    prologue,
    units,
    packed: packedResult.transactions,
    tail,
    expected: {
      flow: "salvage",
      owner: owner.toBase58(),
      feeWallet,
      expectedFeeLamports: feeFor(packedList),
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

  const simulated = await simulateAll(connection, packedResult.transactions);

  if (simulated.every((simulation) => !simulation.ok)) {
    const firstError = simulated.find((simulation) => !simulation.ok);
    throw new CloseError(
      firstError?.error ?? "Every transaction failed to simulate.",
      "Nothing was signed or sent. Rescan the wallet and try again.",
      warnings,
    );
  }

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
    throw new CloseError(
      "None of these close transactions could be simulated.",
      "Nothing was signed or sent. Rescan the wallet and try again.",
      warnings,
    );
  }

  const priorityFee = Math.ceil(
    (CLOSE_COMPUTE_UNIT_LIMIT * PRIORITY_FEE_MICRO_LAMPORTS) / 1_000_000,
  );

  const signedAccounts = new Set(packed.flatMap((tx) => tx.mints));
  const signedList = packedList.filter((account) =>
    signedAccounts.has(account.address),
  );
  const rentLamports = signedList.reduce(
    (sum, account) => sum + account.lamports,
    0,
  );
  const reclaimFeeLamports = feeFor(signedList);

  return {
    packed,
    simulations,
    warnings,
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
    estimatedFeeLamports: packed.length * feePerTransaction(sponsor, priorityFee),
    closeCount: signedAccounts.size,
    rentLamports,
    reclaimFeeLamports,
    // What the user actually receives, which is the only number worth showing them.
    netRentLamports: rentLamports - reclaimFeeLamports,
    hasFailures: failed.length > 0,
    sponsor,
  };
}
