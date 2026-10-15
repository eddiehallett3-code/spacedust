import type { ApiInstruction, RoutePlanStep } from "./jupiter";

/** Asset the user sweeps their dust into. */
export type OutputAsset = "SOL" | "USDC" | "JUP";

/**
 * Jupiter's instructions for one token, kept in Jupiter's documented order so we
 * can splice our own `closeAccount` between the swap and the cleanup step.
 * Order: setup → [our pre-swap] → swap → [our post-swap] → cleanup → other.
 */
export interface SwapInstructionBundle {
  setup: ApiInstruction[];
  swap: ApiInstruction;
  cleanup: ApiInstruction | null;
  other: ApiInstruction[];
}

/** One token's swap, fully built server-side. */
export interface SwapBuild {
  /** Input mint. */
  mint: string;
  symbol: string;
  logoUri: string | null;
  /** Input amount in base units. */
  inAmount: string;
  /**
   * The on-chain token account that holds the input balance, as reported by the
   * scanner. Not necessarily the canonical ATA. Rent reclaim must close *this*
   * address: closing a derived ATA that holds no account is rejected on-chain
   * with `InvalidAccountData`.
   */
  tokenAccount: string | null;
  /** Expected output in base units at build time. */
  outAmount: string;
  /** Minimum acceptable output given slippage, in base units. */
  otherAmountThreshold: string;
  outputMint: string;
  /** e.g. 0.013 means 1.3% price impact. Null when Jupiter omitted it. */
  priceImpactPct: number | null;
  routeLabels: string[];
  /** Jupiter already adds its own compute budget; we strip it and set our own. */
  computeBudgetInstructions: ApiInstruction[];
  bundle: SwapInstructionBundle;
  addressesByLookupTableAddress: Record<string, string[]> | null;
  lastValidBlockHeight: number;
  /** Set when Jupiter could not route this token. Other tokens still proceed. */
  error: string | null;
}

/** Server response of `POST /api/plan`. */
export interface PlanResponse {
  builds: SwapBuild[];
  /** Tokens that could not be quoted, with the reason. */
  failures: Array<{ mint: string; symbol: string; reason: string }>;
  totalInValueUsd: number;
  totalExpectedOutUsd: number;
  /** Total rent (lamports) we expect to reclaim by closing emptied ATAs. */
  estimatedRentReclaimLamports: number;
  /**
   * Rent-exempt minimum for ONE token account, fetched from the chain during
   * this plan.
   *
   * Anything that prices rent must use *this*, not a constant: the network
   * changes its rent rate, and a stale figure inflated both the rent we report
   * and The Void's percentage fee. See `lib/solana/rent.ts`.
   */
  tokenAccountRentLamports: number;
  /**
   * Integrator fee actually applied to this plan, in basis points. Zero when the
   * fee wallet is not configured, or when its token account for the output asset
   * is missing or unusable (see `warnings`).
   */
  feeBps: number;
  /**
   * The token account the fee is paid into, or null when no fee was applied.
   *
   * A token account rather than a wallet, because the fee is charged in the
   * output asset: it lands in the fee wallet's account for that mint. Nothing
   * claims it out afterwards — it is that wallet's balance from the moment the
   * swap lands.
   */
  feeAccount: string | null;
  /** Operator-facing notes, e.g. a fee that could not be collected. */
  warnings: string[];
  /** Per-transaction SOL fee estimate at the current priority level. */
  estimatedFeeLamports: number;
  createdAt: number;
}

/**
 * A client-composed VersionedTransaction holding as many instruction units as
 * fit under the 1232-byte limit, with `closeAccount` (rent reclaim) already
 * appended in the correct order.
 *
 * Produced by both flows in the app: the swap packer (`plan-sweep`) and the
 * Void (`plan-theVoid`). They never share a transaction.
 */
export interface PackedTransaction {
  index: number;
  /** Base64 wire transaction with an empty signature array — NOT signed yet. */
  base64: string;
  /** Input mints swept by this transaction. */
  mints: string[];
  sizeBytes: number;
  instructionCount: number;
  includesRentReclaim: boolean;
  /** Mints whose emptied ATA this transaction closes. */
  rentReclaimMints: string[];
}

/** Result of `simulateTransaction` for one packed transaction. */
export interface SimulationOutcome {
  index: number;
  ok: boolean;
  unitsConsumed: number | null;
  /** Human-readable failure, already mapped from Solana's error codes. */
  error: string | null;
  /** Base fee + priority fee the wallet will pay for this transaction. */
  feeLamports: number | null;
  /** Rent the transaction reclaims via closeAccount (negative = paid out). */
  rentDeltaLamports: number | null;
  /** Whether this simulation was part of a Dry Run. */
  dryRun: boolean;
}

/** Where the sweep flow currently is. Drives the progress UI. */
export type SweepPhase =
  | "idle"
  | "planning"
  | "simulating"
  | "awaiting-signature"
  | "submitting"
  | "confirming"
  | "success"
  | "error";

/** Per-token outcome of a completed sweep. */
export interface TokenOutcome {
  mint: string;
  symbol: string;
  logoUri: string | null;
  status: "success" | "failed" | "skipped";
  signature: string | null;
  /** Value of the input token, in USD, at scan time. */
  valueUsd: number;
  inputAmount: string;
  outputAmount: string | null;
  /** Output in whole units, for display. */
  outputAmountFormatted: number | null;
  priceImpactPct: number | null;
  routeLabels: string[];
  error: string | null;
  /** True when this token's ATA was closed in the same flow. */
  rentReclaimed: boolean;
}

/**
 * Per-token outcome of a completed Void burn.
 *
 * A burn has no "output amount": the token balance is destroyed on purpose.
 * What the user gets back is the rent that was locked in the token account.
 */
export interface VoidOutcome {
  mint: string;
  symbol: string;
  logoUri: string | null;
  status: "burned" | "failed";
  signature: string | null;
  /** Whole-token balance that was burned, at scan time. */
  balance: number;
  error: string | null;
  /** True when the token account was closed and its rent returned. */
  rentReclaimed: boolean;
}

/** Aggregate numbers for the Void result. */
export interface VoidSummary {
  /** Tokens offered to the fire. */
  tokenCount: number;
  burnedCount: number;
  failedCount: number;
  /** Token accounts actually closed — the rent-bearing ones. */
  closedCount: number;
  /** Rent that actually reached the wallet, after The Void's fee. */
  rentReclaimedLamports: number;
  /** The Void's fee on that rent. Zero when fees are switched off. */
  voidFeeLamports: number;
  /** Network fees paid to send the burn transactions. */
  feeLamports: number;
  signatures: string[];
}

/**
 * Per-approval outcome of a revoke run.
 *
 * A revoke produces no value: nothing is swapped and no rent comes back. What
 * changed is that a third party can no longer move the balance, so the success
 * screen reports authority rather than lamports.
 */
export interface RevokeOutcome {
  /** The token account the delegate was cleared from. */
  tokenAccount: string;
  mint: string;
  /** The address that held the permission. */
  delegate: string;
  status: "revoked" | "failed";
  signature: string | null;
  error: string | null;
}

/** Aggregate numbers for a revoke run. */
export interface RevokeSummary {
  /** Approvals the user asked to revoke. */
  requested: number;
  revokedCount: number;
  failedCount: number;
  /** Network fees paid to send the revoke transactions. */
  feeLamports: number;
  signatures: string[];
}

/** One account's fate in a rent-reclaim run. */
export interface CloseOutcome {
  /** The token account that was closed, or would have been. */
  account: string;
  mint: string;
  status: "closed" | "failed";
  signature: string | null;
  error: string | null;
  /** Lamports this close returned. Zero when it failed. */
  rentLamports: number;
}

/** Aggregate numbers for a rent-reclaim run. */
export interface CloseSummary {
  /** Accounts the user asked to close. */
  requested: number;
  closedCount: number;
  failedCount: number;
  /** Rent actually returned by the closes that landed, in lamports. */
  rentLamports: number;
  /** The Spacedust fee taken from that rent, in lamports. */
  reclaimFeeLamports: number;
  /** Rent minus the fee: what actually reached the wallet. */
  netRentLamports: number;
  /** Network fees paid to send them. */
  feeLamports: number;
  signatures: string[];
}

/** A sweep persisted in localStorage for the "Past sweeps" panel. */
export interface SweepHistoryEntry {
  id: string;
  createdAt: number;
  outputAsset: OutputAsset;
  outputMint: string;
  /** Whole units of output token received. */
  totalOutput: number;
  totalValueUsd: number;
  tokenCount: number;
  successCount: number;
  failedCount: number;
  rentReclaimedLamports: number;
  feeLamports: number;
  signatures: string[];
  /** Input mints, so we can highlight tokens already swept. */
  mints: string[];
}

/** Aggregate numbers for the success screen. */
export interface SweepSummary {
  totalOutput: number;
  totalOutputSymbol: string;
  totalValueUsd: number;
  tokenCount: number;
  successCount: number;
  failedCount: number;
  rentReclaimedLamports: number;
  feeLamports: number;
  signatures: string[];
  routeLabels: string[];
  /**
   * Integrator fee taken on the swap output, in whole output units. Jupiter
   * charges it inside the swap instruction, in the output asset, so it is
   * separate from the network fee and never touches the dust being recovered.
   */
  spacedustFeeAmount: number;
  /** The fee rate applied, in basis points. Zero when fees were switched off. */
  spacedustFeeBps: number;
  /** Set when the user ran a Dry Run instead of a real sweep. */
  dryRun: boolean;
}

export type { ApiInstruction, RoutePlanStep };