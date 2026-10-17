import {
  PublicKey,
  type AddressLookupTableAccount,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
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
import {
  createComputeBudgetInstructions,
  getOwnerAta,
} from "@/lib/solana/instructions";
import {
  composePackUnits,
  plannedCloseAccounts,
} from "@/lib/solana/compose";
import { packTransactions, type PackUnit } from "@/lib/solana/pack";
import { simulateAll } from "@/lib/solana/simulate";
import { mintsWithoutRentReclaim } from "@/lib/sweep/amounts";
import { sumForMints } from "@/lib/sweep/totals";
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

/** What a packed sweep was built from, so it can be packed again later. */
export interface RepackInput {
  units: PackUnit[];
  prologue: TransactionInstruction[];
  payer: PublicKey;
  lookupTables: AddressLookupTableAccount[];
}

/** The same batch, packed against a fresh blockhash. */
export interface RepackedBatch {
  packed: PackedTransaction[];
  blockhash: string;
  lastValidBlockHeight: number;
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
   * The deposit each close in this batch returns, per mint, read from the chain.
   *
   * Per mint rather than one figure: deposits differ between accounts, and the
   * panel and the success screen both total these instead of multiplying a single
   * number by a count.
   */
  rentByMint: Map<string, number>;
  /** The Spacedust fee charged on each of those deposits, per mint. */
  feeByMint: Map<string, number>;
  /** Rent this batch's closes return, before the reclaim fee. */
  estimatedRentReclaimLamports: number;
  /** The Spacedust fee on that rent. Zero when fees are off. */
  estimatedReclaimFeeLamports: number;
  /** Rent minus that fee — what actually reaches the wallet. */
  estimatedNetRentLamports: number;
  /**
   * What this batch was packed from, kept so a stale blockhash window can be
   * refreshed by packing it again: the same instructions and the same grouping
   * against a new blockhash, with no new Jupiter quotes. See `refreshBlockhash`.
   */
  repackInput: RepackInput;
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
  // plain SOL transfer from the rent the close has just handed back. It is the
  // only fee a sweep carries — nothing is taken out of the swap's output.
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
  const { units, errors: composeErrors, warnings: composeWarnings, rentByMint, feeByMint } =
    await composePackUnits({
      owner,
      builds: plan.builds,
      skipCloseMints,
      tokenPrograms,
      // Lets the composer confirm a close target exists before we commit to
      // closing it — a missing account fails the whole transaction on-chain. It
      // also reads each target's own deposit, which is what the fee is priced
      // from.
      connection,
      feeWallet: feeEnabled ? feeWallet : null,
      // A rate, not an amount: the composer applies it to each account's own
      // deposit. Zero disables the transfer entirely.
      reclaimFeeBps: feeEnabled ? RECLAIM_FEE_BPS : 0,
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

  // Kept on the result, because this is everything a blockhash refresh would
  // need to pack the batch again — same instructions, same grouping, new
  // blockhash. See `refreshBlockhash`.
  const repackInput: RepackInput = {
    units,
    prologue,
    payer: owner,
    lookupTables,
  };

  const packedResult = packTransactions({
    ...repackInput,
    blockhash: blockhashInfo.blockhash,
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
  // dropped unit returns no rent — and totalled from each account's own measured
  // deposit, not from a count multiplied by one figure, so the panel's numbers are
  // the ones the closes will actually hand back.
  const packedCloseMints = new Set(
    packedResult.transactions.flatMap((tx) => tx.rentReclaimMints),
  );
  const estimatedRentReclaimLamports = sumForMints(rentByMint, packedCloseMints);
  const estimatedReclaimFeeLamports = sumForMints(feeByMint, packedCloseMints);

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
      // One fee rides in a sweep, and it reaches the chain as a System transfer
      // per closed account. The wallet is named here and the batch's own total is
      // the ceiling the audit checks each transfer against.
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
    rentByMint,
    feeByMint,
    estimatedRentReclaimLamports,
    estimatedReclaimFeeLamports,
    estimatedNetRentLamports:
      estimatedRentReclaimLamports - estimatedReclaimFeeLamports,
    repackInput,
  };
}

/**
 * Pack the same batch against a fresh blockhash.
 *
 * WHY THIS IS NOT `planSweep`: every transaction in a sweep is signed with ONE
 * blockhash, and the window it buys is shared by the whole batch *and* by however
 * long the human takes to approve it. So a phone has to be able to start signing
 * with a nearly full window — and re-running the plan to get one re-quotes
 * Jupiter, which is slow, burns rate limit, and quietly changes the amounts under
 * a preview the user has already read.
 *
 * None of that is what a blockhash refresh needs. The routes, the instructions,
 * the grouping and the simulations are all blockhash-independent: the same units
 * pack to the same transactions, and the simulations run with
 * `replaceRecentBlockhash`, so they stay valid. So the refresh is a re-pack —
 * milliseconds, one blockhash lookup, and a preview that still describes exactly
 * what will be signed.
 */
export async function repackWithFreshBlockhash(
  connection: Connection,
  input: RepackInput,
): Promise<RepackedBatch> {
  const blockhashInfo = await connection.getLatestBlockhash("confirmed");
  const packedResult = packTransactions({
    ...input,
    blockhash: blockhashInfo.blockhash,
  });

  if (packedResult.transactions.length === 0) {
    throw new PlanError(
      "The selected swaps are too large to send in one go.",
      "Try sweeping fewer tokens at a time.",
    );
  }

  return {
    packed: packedResult.transactions,
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
  };
}

/**
 * The whole result, refreshed onto a new blockhash.
 *
 * Everything except the packed bytes is carried across, and the figures derived
 * from the packing are recomputed from the new one — they cannot actually differ
 * (the grouping is the same, and a blockhash is 32 bytes either way), but reading
 * them from the new batch is what makes that a fact rather than an assumption.
 */
export async function refreshBlockhash(
  connection: Connection,
  result: PlanSweepResult,
): Promise<PlanSweepResult> {
  const fresh = await repackWithFreshBlockhash(connection, result.repackInput);
  const closedMints = new Set(
    fresh.packed.flatMap((transaction) => transaction.rentReclaimMints),
  );
  const estimatedRentReclaimLamports = sumForMints(result.rentByMint, closedMints);
  const estimatedReclaimFeeLamports = sumForMints(result.feeByMint, closedMints);

  return {
    ...result,
    packed: fresh.packed,
    blockhash: fresh.blockhash,
    lastValidBlockHeight: fresh.lastValidBlockHeight,
    estimatedRentReclaimLamports,
    estimatedReclaimFeeLamports,
    estimatedNetRentLamports:
      estimatedRentReclaimLamports - estimatedReclaimFeeLamports,
  };
}