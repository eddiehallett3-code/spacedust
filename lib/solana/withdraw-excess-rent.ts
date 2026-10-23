import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import {
  BASE_FEE_LAMPORTS,
  CLOSE_COMPUTE_UNIT_LIMIT,
  PRIORITY_FEE_MICRO_LAMPORTS,
  RECLAIM_FEE_BPS,
} from "@/lib/utils/constants";
import { getPublicFeeWallet } from "@/lib/config/public-env";
import { createComputeBudgetInstructions } from "@/lib/solana/instructions";
import { fetchRentMinimums, feeFromRentLamports } from "@/lib/solana/rent";
import { packTransactions, type PackUnit } from "@/lib/solana/pack";
import { simulateAll, splitBySimulation } from "@/lib/solana/simulate";
import { auditPlanBeforeSigning } from "@/lib/security/audit-plan";
import { CloseError } from "@/lib/solana/close-accounts";
import {
  TOKEN_2022_PROGRAM,
  buildWithdrawExcessLamportsInstruction,
  computeExcessLamports,
} from "@/lib/salvage/excess-rent";
import type { PackedTransaction, SimulationOutcome } from "@/types/sweep";
import type { ExcessRentAccount } from "@/types/salvage";

/**
 * Plan withdrawing excess rent from Token-2022 accounts.
 *
 * The instruction withdraws everything above the account's rent-exempt minimum
 * at execution — it does not accept an amount. The planner therefore re-reads
 * each selected account against the chain, recomputes its excess from its own
 * data size, and prices the fee from that current figure. A preview left open
 * while the account changes cannot quote the wrong amount.
 *
 * Nothing here closes an account or moves a token. The account and its balance
 * remain; only spare lamports are returned.
 */

export interface PlanExcessRentResult {
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  warnings: string[];
  blockhash: string;
  lastValidBlockHeight: number;
  estimatedFeeLamports: number;
  /** Total current excess across the accounts that made it into the plan. */
  excessLamports: number;
  reclaimFeeLamports: number;
  netRentLamports: number;
  accountCount: number;
  /** Excess attributed to each token account that made it into the plan. */
  excessByAccount: Record<string, number>;
  /** Spacedust fee attributed to each account, in lamports. */
  feeByAccount: Record<string, number>;
  hasFailures: boolean;
}

interface ParsedTokenInfo {
  mint?: string;
  owner?: string;
  state?: string;
  isNative?: boolean;
  tokenAmount?: { amount?: string };
}

function readParsedAccount(entry: {
  lamports: number;
  data: unknown;
}): { lamports: number; space: number; info: ParsedTokenInfo } | null {
  const data = entry.data as
    | { space?: number; parsed?: { info?: ParsedTokenInfo } }
    | undefined;
  const space = data?.space;
  const info = data?.parsed?.info;
  if (
    typeof space !== "number" ||
    !Number.isFinite(space) ||
    space <= 0 ||
    !info
  ) {
    return null;
  }
  if (typeof entry.lamports !== "number" || !Number.isFinite(entry.lamports)) {
    return null;
  }
  return { lamports: entry.lamports, space, info };
}

export async function planExcessRentTx(input: {
  connection: Connection;
  owner: PublicKey;
  accounts: readonly ExcessRentAccount[];
}): Promise<PlanExcessRentResult> {
  const { connection, owner, accounts } = input;
  const warnings: string[] = [];
  const units: PackUnit[] = [];

  // One owner-wide read gives the current lamports and data size for every
  // selected account, rather than trusting numbers captured by an earlier scan.
  const response = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_2022_PROGRAM,
  });
  const current = new Map<
    string,
    { lamports: number; space: number; info: ParsedTokenInfo }
  >();
  for (const entry of response.value) {
    const parsed = readParsedAccount(entry.account);
    if (parsed) current.set(entry.pubkey.toBase58(), parsed);
  }

  const rentBySpace = new Map<number, number>();
  const rentExempt = async (space: number): Promise<number | null> => {
    const cached = rentBySpace.get(space);
    if (cached !== undefined) return cached;
    const minimum = await connection.getMinimumBalanceForRentExemption(space);
    if (!Number.isFinite(minimum) || minimum <= 0) return null;
    rentBySpace.set(space, minimum);
    return minimum;
  };

  const feeWallet = getPublicFeeWallet();
  let feeEnabled = false;
  if (feeWallet) {
    const rent = await fetchRentMinimums(connection);
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

  const excessByAccount: Record<string, number> = {};
  const feeByAccount: Record<string, number> = {};
  const seenSelected = new Set<string>();

  for (const selected of accounts) {
    if (seenSelected.has(selected.address)) continue;
    seenSelected.add(selected.address);

    const onChain = current.get(selected.address);
    if (!onChain) {
      warnings.push(
        `Skipped ${selected.address.slice(0, 6)}…: the account no longer exists.`,
      );
      continue;
    }
    const info = onChain.info;
    if (info.owner !== owner.toBase58()) {
      warnings.push(
        `Skipped ${selected.address.slice(0, 6)}…: the connected wallet is not its owner.`,
      );
      continue;
    }
    if (info.mint !== selected.mint) {
      warnings.push(
        `Skipped ${selected.address.slice(0, 6)}…: the mint no longer matches the scan.`,
      );
      continue;
    }
    if (info.isNative === true) {
      warnings.push(
        `Skipped ${selected.address.slice(0, 6)}…: it holds wrapped SOL, not spare rent.`,
      );
      continue;
    }
    if (info.state !== "initialized" && info.state !== "frozen") {
      warnings.push(
        `Skipped ${selected.address.slice(0, 6)}…: the account is not initialized.`,
      );
      continue;
    }
    if (info.tokenAmount?.amount === "0") {
      warnings.push(
        `Skipped ${selected.address.slice(0, 6)}…: it is empty — close it instead, which returns the whole deposit.`,
      );
      continue;
    }

    const minimum = await rentExempt(onChain.space);
    if (minimum === null) {
      warnings.push(
        `Skipped ${selected.address.slice(0, 6)}…: its rent minimum could not be read.`,
      );
      continue;
    }

    const excess = computeExcessLamports(onChain.lamports, minimum);
    if (excess <= 0) {
      warnings.push(
        `Skipped ${selected.address.slice(0, 6)}…: it no longer holds excess rent.`,
      );
      continue;
    }

    const instructions = [
      buildWithdrawExcessLamportsInstruction(
        new PublicKey(selected.address),
        owner,
        owner,
      ),
    ];

    const accountFee = feeEnabled
      ? feeFromRentLamports(excess, RECLAIM_FEE_BPS)
      : 0;
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
      mint: selected.address,
      instructions,
      // No closeAccount: the account and its tokens stay exactly where they are.
      rentReclaim: false,
    });
    excessByAccount[selected.address] = excess;
    feeByAccount[selected.address] = accountFee;
  }

  if (units.length === 0) {
    throw new CloseError(
      "None of these accounts still holds excess rent.",
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
    throw new CloseError(
      "These withdrawals could not be packed into a transaction.",
      "Nothing was signed. Rescan the wallet and try again.",
      warnings,
    );
  }

  // ── The audit: what is about to be signed ────────────────────────────────
  // Every account here was found by a scan and priced from the cluster's rent
  // minimum. The audit re-proves the parts that matter: the authority and the
  // destination are the wallet, each account is one the plan named, and the only
  // SOL that may leave is the fee this plan computed.
  const packedAddresses = [...seenSelected].filter((address) =>
    packedResult.transactions.some((tx) => tx.mints.includes(address)),
  );
  const auditedFeeLamports = packedAddresses.reduce(
    (sum, address) => sum + (feeByAccount[address] ?? 0),
    0,
  );

  auditPlanBeforeSigning({
    prologue,
    units,
    packed: packedResult.transactions,
    expected: {
      flow: "excess-rent",
      owner: owner.toBase58(),
      feeWallet,
      expectedFeeLamports: auditedFeeLamports,
      expectedSubjects: packedAddresses,
    },
  });

  const simulated = await simulateAll(connection, packedResult.transactions);
  if (simulated.every((simulation) => !simulation.ok)) {
    const firstError = simulated.find((simulation) => !simulation.ok);
    throw new CloseError(
      firstError?.error ?? "The excess-rent withdrawal failed to simulate.",
      "Nothing was signed or sent. Rescan the wallet and try again.",
      warnings,
    );
  }

  // Only the transactions that simulated are signed. One that failed is a known
  // failure: signing it spends a fee to be refused, and it would make the batch
  // look larger than it is.
  const { packed, simulations, failed } = splitBySimulation(
    packedResult.transactions,
    simulated,
  );
  for (const failure of failed) {
    warnings.push(
      `Skipped one transaction: it failed its simulation (${failure.error ?? "no detail"}).`,
    );
  }

  const priorityFee = Math.ceil(
    (CLOSE_COMPUTE_UNIT_LIMIT * PRIORITY_FEE_MICRO_LAMPORTS) / 1_000_000,
  );

  // Priced from the accounts that actually made it into a signed transaction, so
  // a unit that was dropped or failed its simulation neither promises its rent
  // nor charges a fee on it.
  const signedAddresses = new Set(packed.flatMap((tx) => tx.mints));
  const signedExcessLamports = [...signedAddresses].reduce(
    (sum, address) => sum + (excessByAccount[address] ?? 0),
    0,
  );
  const signedFeeLamports = [...signedAddresses].reduce(
    (sum, address) => sum + (feeByAccount[address] ?? 0),
    0,
  );

  return {
    packed,
    simulations,
    warnings,
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
    estimatedFeeLamports: packed.length * (BASE_FEE_LAMPORTS + priorityFee),
    excessLamports: signedExcessLamports,
    reclaimFeeLamports: signedFeeLamports,
    netRentLamports: signedExcessLamports - signedFeeLamports,
    accountCount: signedAddresses.size,
    excessByAccount,
    feeByAccount,
    hasFailures: failed.length > 0,
  };
}
