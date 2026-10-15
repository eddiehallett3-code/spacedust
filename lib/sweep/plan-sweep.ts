import { PublicKey, type Connection } from "@solana/web3.js";
import { apiFetch } from "@/lib/utils/api";
import { getPublicFeeWallet } from "@/lib/config/public-env";
import {
  BASE_FEE_LAMPORTS,
  COMPUTE_UNIT_LIMIT,
  DEFAULT_SLIPPAGE_BPS,
  OUTPUT_ASSETS,
  PRIORITY_FEE_MICRO_LAMPORTS,
  RECLAIM_FEE_BPS,
  TOKEN_PROGRAM_ID,
} from "@/lib/utils/constants";
import { auditPlanBeforeSigning } from "@/lib/security/audit-plan";
import type { AuditResult } from "@/lib/security/instruction-audit";
import { loadLookupTables } from "@/lib/solana/connection";
import { feeFromRentLamports } from "@/lib/solana/rent";
import {
  createComputeBudgetInstructions,
  getOwnerAta,
} from "@/lib/solana/instructions";
import {
  composePackUnits,
  plannedCloseAccounts,
} from "@/lib/solana/compose";
import { packTransactions } from "@/lib/solana/pack";
import { simulateAll } from "@/lib/solana/simulate";
import { mintsWithoutRentReclaim } from "@/lib/sweep/amounts";
import type {
  OutputAsset,
  PackedTransaction,
  PlanResponse,
  SimulationOutcome,
} from "@/types/sweep";
import type { DustToken } from "@/types/token";

/**
 * The planning pipeline.
 *
 * Deliberately a plain async function rather than a hook: it is plumbing with no
 * React in it, which keeps the security-critical ordering
 * (build → compose → pack → simulate) readable and reviewable in one place.
 *
 * Nothing in here signs or sends anything.
 */

export interface PlanSweepInput {
  connection: Connection;
  owner: PublicKey;
  tokens: DustToken[];
  outputAsset: OutputAsset;
  slippageBps?: number;
  /**
   * mint → the base-unit amount to swap, when the user wants less than the whole
   * balance. A mint with no entry swaps in full.
   *
   * Carried alongside `tokens` rather than folded into their `rawAmount` on
   * purpose: the full balance is still needed, because only a swap that empties
   * the account may be followed by a `closeAccount`.
   */
  amounts?: ReadonlyMap<string, string>;
}

export interface PlanSweepResult {
  plan: PlanResponse;
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  warnings: string[];
  blockhash: string;
  lastValidBlockHeight: number;
  /** Precise fee estimate, based on the real transaction count. */
  estimatedFeeLamports: number;
  /**
   * The Spacedust fee for closing ONE account for its rent, in lamports, floored.
   *
   * Zero when fees are off — so a caller can multiply it by a closed-account
   * count without checking whether fees were charged first.
   */
  reclaimFeeLamportsPerAccount: number;
  /** Rent this batch's closes return, before the reclaim fee. */
  estimatedRentReclaimLamports: number;
  /** The Spacedust fee on that rent. Zero when fees are off. */
  estimatedReclaimFeeLamports: number;
  /** Rent minus that fee — what actually reaches the wallet. */
  estimatedNetRentLamports: number;
  /** True when at least one transaction failed to simulate. */
  hasFailures: boolean;
  /**
   * What the instruction audit found in the bytes that are about to be signed:
   * every program in the batch, and anything it refused or flagged. A plan that
   * reaches here already passed the gate — a refusal throws — so this is the
   * evidence shown to the user rather than a verdict they wait on.
   */
  audit: AuditResult;
}

/** A planning failure with a user-facing message and recovery hint. */
export class PlanError extends Error {
  override readonly name = "PlanError";
  constructor(
    message: string,
    readonly hint?: string,
    readonly warnings: string[] = [],
  ) {
    super(message);
  }
}

export async function planSweep(
  input: PlanSweepInput,
): Promise<PlanSweepResult> {
  const { connection, owner, tokens, outputAsset } = input;
  /** Per-token amount overrides. Empty means every token goes in full. */
  const amounts = input.amounts ?? new Map<string, string>();
  const outputConfig = OUTPUT_ASSETS[outputAsset];
  const slippageBps = input.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

  // ── 1. Server builds one Jupiter route per token ──────────────────────────
  // The server re-validates every mint and amount and enforces the SOL/USDC/JUP
  // allow-list, so a tampered client cannot redirect the sweep.
  const plan = await apiFetch<PlanResponse>("/api/plan", {
    method: "POST",
    body: {
      owner: owner.toBase58(),
      outputMint: outputConfig.mint,
      slippageBps,
      tokens: tokens.map((token) => {
        const chosen = amounts.get(token.mint);
        return {
          mint: token.mint,
          symbol: token.symbol,
          logoUri: token.logoUri,
          rawAmount: token.rawAmount,
          // Absent means "all of it". The server resolves this against the
          // balance and refuses anything it cannot honour — the client does not
          // decide what a valid amount is.
          swapAmountRaw:
            chosen != null && chosen !== token.rawAmount ? chosen : undefined,
          program: token.program,
          // The exact account holding the balance. Rent reclaim closes this
          // rather than re-deriving an ATA, which can be a different (and
          // non-existent) address for a non-canonical holding.
          tokenAccount: token.tokenAccount,
          hasTransferFee: token.hasTransferFee,
          valueUsd: token.valueUsd,
        };
      }),
    },
    timeoutMs: 60_000,
  });

  if (plan.builds.length === 0) {
    throw new PlanError(
      plan.failures[0]?.reason ??
        "Jupiter could not route any of the selected tokens.",
      "Tokens with no liquidity cannot be swapped. Raise the threshold, or turn off the smart filter to see what is being skipped.",
    );
  }

  // ── 2. Resolve the address lookup tables Jupiter's routes reference ───────
  const altAddresses = new Set<string>();
  for (const build of plan.builds) {
    for (const address of Object.keys(build.addressesByLookupTableAddress ?? {})) {
      altAddresses.add(address);
    }
  }
  const lookupTables = await loadLookupTables(connection, [...altAddresses]);

  // ── 3. Compose instructions, inserting rent reclaim ───────────────────────
  const tokenPrograms = new Map<string, "legacy" | "token2022">(
    tokens.map((token) => [token.mint, token.program]),
  );
  // A Token-2022 transfer-fee mint leaves a residue in the source ATA, and a
  // **partial** amount leaves a balance in any ATA — either way `closeAccount`
  // would fail, and because the packer batches many swaps into one transaction
  // that single bad close would take the whole sweep down. See
  // `mintsWithoutRentReclaim`, which is the same rule the server counts against.
  const skipCloseMints = mintsWithoutRentReclaim(tokens, amounts);

  // ── The rent-reclaim fee ──────────────────────────────────────────────────
  // A sweep returns the rent locked in every token account it empties, and that
  // reclaim is charged like every other flow here: 1.5% of the rent, taken as a
  // plain SOL transfer from the rent the close has just handed back. It is a
  // *second* fee, on a different base from the 0.5% swap fee — that one is
  // charged inside Jupiter's call on the swap's output, this one on the rent.
  //
  // Priced from the plan's own rent figure, so the fee is exactly 1.5% of the
  // "rent reclaimable" the panel shows. Read from the *public* config because
  // this pipeline runs in the browser and builds the transfer itself.
  const feeWallet = getPublicFeeWallet();
  const feeWarnings: string[] = [];
  let feeEnabled = false;
  if (feeWallet) {
    // A configured fee wallet still has to be *funded*: Solana refuses to create
    // an account below the rent-exempt minimum, and this fee is tens of
    // thousands of lamports — far below it — so sending it to a fresh address
    // fails the whole transaction with `InsufficientFundsForRent` instead of
    // creating anything. Verified once for The Void; the trap is identical here.
    try {
      const info = await connection.getAccountInfo(new PublicKey(feeWallet));
      feeEnabled = (info?.lamports ?? 0) >= plan.emptyAccountRentLamports;
    } catch {
      // Could not check — skip the fee rather than risk the whole sweep.
      feeEnabled = false;
    }
    if (!feeEnabled) {
      feeWarnings.push(
        "No fee was charged: the fee wallet has not been funded yet, and a fee this small cannot create it.",
      );
    }
  }
  const reclaimFeePerAccount = feeEnabled
    ? feeFromRentLamports(plan.tokenAccountRentLamports, RECLAIM_FEE_BPS)
    : 0;

  const { units, errors: composeErrors, warnings: composeWarnings } =
    await composePackUnits({
      owner,
      builds: plan.builds,
      skipCloseMints,
      tokenPrograms,
      // Lets the composer confirm a close target exists before we commit to
      // closing it — a missing account fails the whole transaction on-chain.
      connection,
      feeWallet: feeEnabled ? feeWallet : null,
      feeLamportsPerAccount: reclaimFeePerAccount,
    });

  const warnings = [
    ...plan.failures.map((failure) => `${failure.symbol}: ${failure.reason}`),
    ...plan.warnings,
    ...composeWarnings,
    ...composeErrors.map(
      (error) => `Skipped ${error.mint.slice(0, 6)}…: ${error.reason}`,
    ),
    ...feeWarnings,
  ];

  if (units.length === 0) {
    throw new PlanError(
      "None of the selected routes produced valid instructions.",
      "Usually a transient Jupiter issue — try again in a moment.",
      warnings,
    );
  }
  // ── 4. Pack into the fewest possible transactions ─────────────────────────
  const blockhashInfo = await connection.getLatestBlockhash("confirmed");
  const prologue = createComputeBudgetInstructions(
    COMPUTE_UNIT_LIMIT,
    PRIORITY_FEE_MICRO_LAMPORTS,
  );

  const priorityFee =
    Math.ceil((COMPUTE_UNIT_LIMIT * PRIORITY_FEE_MICRO_LAMPORTS) / 1_000_000);

  const packedResult = packTransactions({
    units,
    prologue,
    payer: owner,
    blockhash: blockhashInfo.blockhash,
    lookupTables,
  });

  if (packedResult.transactions.length === 0) {
    throw new PlanError(
      "The selected swaps are too large to send in one go.",
      "Try sweeping fewer tokens at a time.",
      warnings,
    );
  }

  warnings.push(
    ...packedResult.dropped.map(
      (dropped) => `Skipped ${dropped.mint.slice(0, 6)}…: ${dropped.reason}`,
    ),
  );

  // Rent actually reclaimed, and the fee on it. Counted from the accounts that
  // made it into a transaction rather than the ones we set out to close: a
  // dropped unit returns no rent, and one fee transfer was built per closed
  // account, so the same count prices the fee.
  const packedCloseMints = new Set(
    packedResult.transactions.flatMap((tx) => tx.rentReclaimMints),
  );
  const estimatedRentReclaimLamports =
    packedCloseMints.size * plan.tokenAccountRentLamports;
  const estimatedReclaimFeeLamports =
    packedCloseMints.size * reclaimFeePerAccount;

  // ── The audit: what is about to be signed, checked before it is simulated ─
  // Runs on the instructions that actually made it into a transaction and on the
  // packed bytes themselves. A plan that fails here never reaches a wallet
  // prompt, and never even costs a simulation.
  const audit = auditPlanBeforeSigning({
    prologue,
    units,
    packed: packedResult.transactions,
    expected: {
      flow: "sweep",
      owner: owner.toBase58(),
      // Two fees ride in a sweep, and they reach the chain differently. The swap
      // fee is a `platformFeeBps` charge inside the aggregator's own call, so it
      // never appears as a System instruction. The rent-reclaim fee *is* one
      // System transfer per closed account, so the wallet is named here and the
      // batch's own total is the ceiling the audit checks each transfer against.
      feeWallet: feeEnabled ? feeWallet : null,
      expectedFeeLamports: estimatedReclaimFeeLamports,
      // Told to the audit through the composer's own function, so the two can
      // never disagree about which accounts this batch closes — including the
      // derived-ATA fallback for a holding the scanner could not name. See
      // `plannedCloseAccounts`.
      expectedCloses: plannedCloseAccounts({
        owner,
        builds: plan.builds,
        skipCloseMints,
        tokenPrograms,
      }),
      // A sweep that outputs SOL wraps it, which moves lamports into the
      // wallet's own wrapped-SOL account. Declaring that account here is what
      // stops the wrap being mistaken for SOL leaving.
      allowedSolDestinations:
        outputAsset === "SOL"
          ? [
              getOwnerAta(
                owner,
                new PublicKey(OUTPUT_ASSETS.SOL.mint),
                new PublicKey(TOKEN_PROGRAM_ID),
              ).toBase58(),
            ]
          : [],
    },
  });

  // ── 5. Simulate everything before asking for a signature ──────────────────
  // This is the safety gate. A user is never prompted to sign a transaction we
  // already know would fail.
  const simulations = await simulateAll(connection, packedResult.transactions);
  const hasFailures = simulations.some((simulation) => !simulation.ok);

  if (simulations.every((simulation) => !simulation.ok)) {
    const firstError = simulations.find((simulation) => !simulation.ok);
    throw new PlanError(
      firstError?.error ?? "Every transaction failed to simulate.",
      // Deliberately not "stale quote": that blamed Jupiter for what is almost
      // always an on-chain account problem (a token account that has moved or
      // was already closed). Nothing is signed or sent either way.
      "Nothing was signed and no funds moved. Rescan the wallet and try again — if it keeps failing, this token's on-chain accounts have changed since the scan.",
      warnings,
    );
  }

  // One signature per transaction, so scale the fee by the real transaction count.
  const estimatedFeeLamports =
    packedResult.transactions.length * (BASE_FEE_LAMPORTS + priorityFee);

  return {
    plan,
    packed: packedResult.transactions,
    simulations,
    warnings,
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
    estimatedFeeLamports,
    hasFailures,
    audit,
    reclaimFeeLamportsPerAccount: reclaimFeePerAccount,
    estimatedRentReclaimLamports,
    estimatedReclaimFeeLamports,
    estimatedNetRentLamports:
      estimatedRentReclaimLamports - estimatedReclaimFeeLamports,
  };
}