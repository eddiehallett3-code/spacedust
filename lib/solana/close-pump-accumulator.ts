import {
  PublicKey,
  SystemProgram,
  type Connection,
} from "@solana/web3.js";
import {
  BASE_FEE_LAMPORTS,
  CLOSE_COMPUTE_UNIT_LIMIT,
  PRIORITY_FEE_MICRO_LAMPORTS,
  RECLAIM_FEE_BPS,
} from "@/lib/utils/constants";
import { getPublicFeeWallet } from "@/lib/config/public-env";
import { createComputeBudgetInstructions } from "@/lib/solana/instructions";
import { fetchRentMinimums, feeFromRentLamports } from "@/lib/solana/rent";
import { packTransactions } from "@/lib/solana/pack";
import { simulateAll, splitBySimulation } from "@/lib/solana/simulate";
import { auditPlanBeforeSigning } from "@/lib/security/audit-plan";
import { CloseError } from "@/lib/solana/close-accounts";
import type { PackedTransaction, SimulationOutcome } from "@/types/sweep";
import type { PumpAccumulator } from "@/types/salvage";
import {
  PUMP_AMM_PROGRAM,
  buildClosePumpAccumulatorInstruction,
  derivePumpAccumulator,
  isUserVolumeAccumulatorData,
} from "@/lib/salvage/pump-accumulator";

/**
 * Plan the close of one Pump.fun user volume accumulator.
 *
 * This is a rent reclaim like an empty token account: the account holds no
 * asset, so the only thing to price is the rent it returns. The one difference
 * is the instruction — Pump AMM's `close_user_volume_accumulator` — and the fee
 * transfer that follows it, which is the same 1.5% of reclaimed rent the other
 * close flows charge.
 *
 * The account is re-read at plan time. Between the scan and the click the user
 * may have closed it elsewhere or Pump may have removed it; in either case the
 * honest answer is "already gone", not a transaction that fails at simulation.
 */

export interface PlanPumpAccumulatorCloseResult {
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  warnings: string[];
  blockhash: string;
  lastValidBlockHeight: number;
  estimatedFeeLamports: number;
  rentLamports: number;
  reclaimFeeLamports: number;
  netRentLamports: number;
  hasFailures: boolean;
}

export interface PlanPumpAccumulatorCloseInput {
  connection: Connection;
  owner: PublicKey;
  account: PumpAccumulator;
}

export async function planPumpAccumulatorCloseTx(
  input: PlanPumpAccumulatorCloseInput,
): Promise<PlanPumpAccumulatorCloseResult> {
  const { connection, owner, account } = input;
  const warnings: string[] = [];

  const address = new PublicKey(account.address);
  const expected = derivePumpAccumulator(owner);
  if (!address.equals(expected)) {
    throw new CloseError(
      "This Pump.fun volume account does not belong to the connected wallet.",
      "Rescan the wallet and try again.",
    );
  }

  const info = await connection.getAccountInfo(address);
  if (!info || !info.owner.equals(PUMP_AMM_PROGRAM)) {
    throw new CloseError(
      "This Pump.fun volume account is already closed.",
      "Rescan the wallet to see what is left.",
    );
  }
  if (!isUserVolumeAccumulatorData(info.data)) {
    throw new CloseError(
      "The account at this address is not a Pump.fun volume account.",
      "Nothing was signed. Rescan the wallet and try again.",
    );
  }

  const lamports = info.lamports;
  if (!Number.isFinite(lamports) || lamports <= 0) {
    throw new CloseError(
      "This Pump.fun volume account holds no rent to return.",
      "Nothing was signed. Rescan the wallet and try again.",
    );
  }


  // The fee wallet must be funded before a tiny fee can be sent to it — the same
  // rule the empty-account close follows. When it is not, the close still runs
  // and the warning says why no fee was charged.
  const rent = await fetchRentMinimums(connection);
  const feeWallet = getPublicFeeWallet();
  let feeEnabled = false;
  if (feeWallet) {
    try {
      const feeInfo = await connection.getAccountInfo(new PublicKey(feeWallet));
      feeEnabled = (feeInfo?.lamports ?? 0) >= rent.emptyAccount;
    } catch {
      feeEnabled = false;
    }
    if (!feeEnabled) {
      warnings.push(
        "No fee was charged: the fee wallet has not been funded yet, and a fee this small cannot create it.",
      );
    }
  }

  const accountFee = feeEnabled
    ? feeFromRentLamports(lamports, RECLAIM_FEE_BPS)
    : 0;

  const instructions = [
    buildClosePumpAccumulatorInstruction(owner, address),
  ];
  if (feeEnabled && feeWallet && accountFee > 0) {
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: new PublicKey(feeWallet),
        lamports: accountFee,
      }),
    );
  }

  const blockhashInfo = await connection.getLatestBlockhash("confirmed");
  const prologue = createComputeBudgetInstructions(
    CLOSE_COMPUTE_UNIT_LIMIT,
    PRIORITY_FEE_MICRO_LAMPORTS,
  );

  const units = [
    {
      mint: account.address,
      instructions,
      rentReclaim: true,
    },
  ];

  const packedResult = packTransactions({
    units,
    prologue,
    payer: owner,
    blockhash: blockhashInfo.blockhash,
    // One account and the owner: nothing an address lookup table could shrink.
    lookupTables: [],
  });

  if (packedResult.transactions.length === 0) {
    throw new CloseError(
      "The Pump.fun account close could not be packed into a transaction.",
      "Nothing was signed. Rescan the wallet and try again.",
      warnings,
    );
  }

  // ── The audit: what is about to be signed ────────────────────────────────
  // Closing this account is a single instruction, and the audit is what proves
  // it is the close of the account the plan named, signed by the wallet whose
  // PDA it is, with the fee as the only SOL leaving.
  auditPlanBeforeSigning({
    prologue,
    units,
    packed: packedResult.transactions,
    expected: {
      flow: "pump-accumulator",
      owner: owner.toBase58(),
      feeWallet,
      expectedFeeLamports: accountFee,
      expectedSubjects: [account.address],
    },
  });

  const simulated = await simulateAll(connection, packedResult.transactions);
  if (simulated.every((simulation) => !simulation.ok)) {
    const firstError = simulated.find((simulation) => !simulation.ok);
    throw new CloseError(
      firstError?.error ?? "The Pump.fun account close failed to simulate.",
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
      `The close was not signed: it failed its simulation (${failure.error ?? "no detail"}).`,
    );
  }
  if (packed.length === 0) {
    throw new CloseError(
      "The Pump.fun account close could not be simulated.",
      "Nothing was signed or sent. Rescan the wallet and try again.",
      warnings,
    );
  }

  const priorityFee = Math.ceil(
    (CLOSE_COMPUTE_UNIT_LIMIT * PRIORITY_FEE_MICRO_LAMPORTS) / 1_000_000,
  );

  return {
    packed,
    simulations,
    warnings,
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
    estimatedFeeLamports: packed.length * (BASE_FEE_LAMPORTS + priorityFee),
    rentLamports: lamports,
    reclaimFeeLamports: accountFee,
    netRentLamports: lamports - accountFee,
    hasFailures: failed.length > 0,
  };
}
