import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import {
  BASE_FEE_LAMPORTS,
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
import { simulateAll } from "@/lib/solana/simulate";
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

      const accountFee = feeFromRentLamports(
        account.rentLamports,
        RECLAIM_FEE_BPS,
      );
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

  const packedResult = packTransactions({
    units,
    prologue,
    payer: owner,
    blockhash: blockhashInfo.blockhash,
    lookupTables: [],
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

  const simulations = await simulateAll(connection, packedResult.transactions);

  if (simulations.every((simulation) => !simulation.ok)) {
    const firstError = simulations.find((simulation) => !simulation.ok);
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
  const wrappedLamports = packedList.reduce(
    (sum, account) => sum + account.amountLamports,
    0,
  );
  const rentLamports = packedList.reduce(
    (sum, account) => sum + Math.max(0, account.rentLamports),
    0,
  );
  const reclaimFeeLamports = feeEnabled
    ? packedList.reduce(
        (sum, account) =>
          sum +
          feeFromRentLamports(Math.max(0, account.rentLamports), RECLAIM_FEE_BPS),
        0,
      )
    : 0;

  return {
    packed: packedResult.transactions,
    simulations,
    warnings,
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
    estimatedFeeLamports:
      packedResult.transactions.length * (BASE_FEE_LAMPORTS + priorityFee),
    closeCount: packedAccounts.size,
    wrappedLamports,
    rentLamports,
    reclaimFeeLamports,
    netReturnedLamports: wrappedLamports + rentLamports - reclaimFeeLamports,
    hasFailures: simulations.some((simulation) => !simulation.ok),
  };
}
