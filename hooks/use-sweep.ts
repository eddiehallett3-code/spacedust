"use client";

import { playFlowSound } from "@/lib/ui/sound";

import { useCallback, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getConnection } from "@/lib/solana/connection";
import {
  isBlockhashExpired,
  BLOCKHASH_PROMPT_MARGIN_SLOTS,
} from "@/lib/solana/blockhash";
import { OUTPUT_ASSETS } from "@/lib/utils/constants";
import { planSweep, PlanError, refreshBlockhash, type PlanSweepResult } from "@/lib/sweep/plan-sweep";
import type { AuditResult } from "@/lib/security/instruction-audit";
import { buildSummary } from "@/lib/sweep/summary";
import { resolveAmount } from "@/lib/sweep/amounts";
import { isBusyPhase } from "@/lib/sweep/phase";
import {
  buildTokenOutcomes,
  signTransactions,
  submitTransactions,
  type OutcomeMeta,
} from "@/lib/solana/submit";
import { toFriendlyError, type FriendlyError } from "@/lib/utils/errors";
import type {
  OutputAsset,
  PackedTransaction,
  PlanResponse,
  SimulationOutcome,
  SweepPhase,
  SweepSummary,
  TokenOutcome,
} from "@/types/sweep";
import type { DustToken } from "@/types/token";

export interface SweepRequest {
  tokens: DustToken[];
  outputAsset: OutputAsset;
  slippageBps?: number;
  /**
   * mint → base-unit amount to swap, when the user wants less than everything.
   * A mint with no entry goes in full. See `lib/sweep/amounts.ts` — a partial
   * amount also means the account cannot be closed for its rent.
   */
  amounts?: ReadonlyMap<string, string>;
}

interface SweepState {
  phase: SweepPhase;
  plan: PlanResponse | null;
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  /** What the instruction audit saw in the bytes about to be signed. */
  audit: AuditResult | null;
  /**
   * Rent this batch's closes return, in lamports, summed from each account's own
   * verified deposit.
   *
   * Totals rather than a per-account figure: deposits differ, so the panel shows
   * the sum the closes will actually hand back.
   */
  rentLamports: number;
  /** The Spacedust fee on that rent. Zero when fees are off. */
  reclaimFeeLamports: number;
  outcomes: TokenOutcome[];
  summary: SweepSummary | null;
  error: FriendlyError | null;
  warnings: string[];
  isDryRun: boolean;
  /** Transactions confirmed so far, for the progress bar. */
  progress: { completed: number; total: number };
}

const INITIAL: SweepState = {
  phase: "idle",
  plan: null,
  packed: [],
  simulations: [],
  audit: null,
  rentLamports: 0,
  reclaimFeeLamports: 0,
  outcomes: [],
  summary: null,
  error: null,
  warnings: [],
  isDryRun: false,
  progress: { completed: 0, total: 0 },
};

/**
 * The sweep orchestrator.
 *
 * SECURITY: this hook holds no keys and cannot sign anything. `execute` asks
 * the user's own wallet (via the standard wallet adapter) to sign, then submits
 * the result. Everything a user might tamper with — mints, amounts, output
 * asset — is re-validated server-side before any instruction is built.
 */
export function useSweep() {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const connection = getConnection();

  // Ref guard: React state updates are async, so two rapid clicks would both
  // observe the stale `false` and both start a sweep.
  const busyRef = useRef(false);
  // Result of the last `prepare`, consumed by `execute`.
  const preparedRef = useRef<{
    result: PlanSweepResult;
    request: SweepRequest;
  } | null>(null);

  const [state, setState] = useState<SweepState>(INITIAL);


  const patch = useCallback((next: Partial<SweepState>): void => {
    setState((previous) => ({ ...previous, ...next }));
  }, []);

  const reset = useCallback((): void => {
    busyRef.current = false;
    preparedRef.current = null;
    setState(INITIAL);
  }, []);

  /**
   * Build, pack and simulate. Shared by Dry Run and the real sweep, so the
   * preview comes from the exact code path that will later submit — there is no
   * separate, drifting "preview" implementation to get wrong.
   *
   * Returns the plan it built, rather than `true`. Callers used to read
   * `sweep.packed` straight afterwards to report how many transactions there
   * were — but `prepare` sets state, and the caller's closure still holds the
   * object from the render *before* it ran, so that count was always the
   * previous plan's. It announced "0 transactions built" on a first run and a
   * stale number on a later one. Returning the result removes the trap instead
   * of documenting it.
   */
  const prepare = useCallback(
    async (
      request: SweepRequest,
      options?: { dryRun?: boolean },
    ): Promise<PlanSweepResult | null> => {
      const dryRun = options?.dryRun ?? false;
      if (busyRef.current) return null;

      if (!publicKey) {
        patch({
          error: {
            title: "Wallet not connected",
            message: "Connect your wallet before running a sweep.",
          },
        });
        return null;
      }
      if (request.tokens.length === 0) return null;

      busyRef.current = true;
      preparedRef.current = null;
      patch({
        phase: "planning",
        error: null,
        warnings: [],
        outcomes: [],
        summary: null,
        simulations: [],
        packed: [],
        isDryRun: dryRun,
        progress: { completed: 0, total: 0 },
      });

      try {
        const result = await planSweep({
          connection,
          owner: publicKey,
          tokens: request.tokens,
          outputAsset: request.outputAsset,
          slippageBps: request.slippageBps,
          amounts: request.amounts,
        });

        preparedRef.current = { result, request };
        patch({
          plan: result.plan,
          packed: result.packed,
          simulations: result.simulations,
          audit: result.audit,
          warnings: result.warnings,
          rentLamports: result.estimatedRentReclaimLamports,
          reclaimFeeLamports: result.estimatedReclaimFeeLamports,
        });

        if (dryRun) {
          patch({
            phase: "success",
            summary: buildSummary({
              plan: result.plan,
              packed: result.packed,
              simulations: result.simulations,
              outcomes: [],
              outputAsset: request.outputAsset,
              estimatedFeeLamports: result.estimatedFeeLamports,
              rentByMint: result.rentByMint,
              feeByMint: result.feeByMint,
              dryRun: true,
            }),
          });
        } else {
          patch({ phase: "idle" });
        }
        return result;
      } catch (caught) {
        if (caught instanceof PlanError) {
          patch({
            phase: "error",
            warnings: caught.warnings,
            error: {
              title: "Could not build the sweep",
              message: caught.message,
              ...(caught.hint ? { hint: caught.hint } : {}),
            },
          });
        } else {
          patch({ phase: "error", error: toFriendlyError(caught) });
        }
        return null;
      } finally {
        busyRef.current = false;
      }
    },
    [connection, patch, publicKey],
  );

  const isBusy = isBusyPhase(state.phase);

  /**
   * Sign and submit a previously prepared sweep.
   *
   * Refuses to run unless `prepare` succeeded first, so we never sign a
   * transaction the user has not already seen previewed and simulated.
   */
  const execute = useCallback(async (): Promise<boolean> => {
    const prepared = preparedRef.current;
    if (!prepared) {
      patch({
        error: {
          title: "Nothing to sweep",
          message:
            "Run a preview first so you can see exactly what will be signed.",
        },
      });
      return false;
    }
    if (busyRef.current) return false;

    // Some wallets expose only `signTransaction`, others only
    // `signAllTransactions`. Requiring both would lock out perfectly capable
    // wallets, so require at least one and let `signTransactions` pick.
    if (!publicKey || (!signTransaction && !signAllTransactions)) {
      patch({
        error: {
          title: "Wallet cannot sign",
          message: "This wallet does not support signing transactions.",
          hint: "Try a different wallet, such as Phantom or Solflare.",
        },
      });
      return false;
    }

    busyRef.current = true;
    const { request } = prepared;
    let result = prepared.result;

    try {
      // ── 0. Start the prompt with a nearly full blockhash window ───────────
      // The blockhash is captured when the preview is built, and the whole batch
      // is signed with it — so the window it buys is shared by every transaction
      // *and* by however long the user takes to approve them. Reading the
      // simulation report is exactly what the app asks the user to do, so a
      // preview can easily sit open longer than a blockhash lives; and a phone
      // that then needs half a minute to approve three prompts loses the tail of
      // the batch to "blockhash expired".
      //
      // The preview's simulation cannot catch this: it runs with
      // `replaceRecentBlockhash`, so it passes no matter how stale the real
      // blockhash is. So the window is refreshed here — in two tiers, because
      // they cost very different things.
      if (
        await isBlockhashExpired(connection, result.lastValidBlockHeight, 0)
      ) {
        // The blockhash is gone, which means this plan is a minute old or more
        // and Jupiter's quotes have moved with the market. Re-plan: new routes,
        // new amounts, a fresh simulation, and a fresh blockhash.
        patch({ phase: "planning", error: null });
        result = await planSweep({
          connection,
          owner: publicKey,
          tokens: request.tokens,
          outputAsset: request.outputAsset,
          slippageBps: request.slippageBps,
          amounts: request.amounts,
        });
        // Keep the fresh plan, so a retry starts from something valid.
        preparedRef.current = { result, request };
        // A re-quote changes what the preview is describing — the amounts, the
        // output, the fee, possibly the transaction count — so all of it is
        // replaced together. Otherwise the panel describes one batch while the
        // wallet is asked to sign another.
        patch({
          plan: result.plan,
          packed: result.packed,
          simulations: result.simulations,
          audit: result.audit,
          warnings: result.warnings,
          rentLamports: result.estimatedRentReclaimLamports,
          reclaimFeeLamports: result.estimatedReclaimFeeLamports,
        });
      } else if (
        await isBlockhashExpired(
          connection,
          result.lastValidBlockHeight,
          BLOCKHASH_PROMPT_MARGIN_SLOTS,
        )
      ) {
        // The window is short but the plan is still current, so pack it again
        // rather than quote it again: the same swaps, the same grouping, a new
        // blockhash. Cheap enough to insist on nearly the whole window before
        // anybody is asked to approve anything — which is the difference between
        // starting the prompt with ~18 seconds of slack and with ~56.
        patch({ phase: "planning", error: null });
        result = await refreshBlockhash(connection, result);
        preparedRef.current = { result, request };
        // Same instructions, new bytes. The grouping does not move, but the state
        // should still hold the transactions that will actually be signed.
        patch({
          packed: result.packed,
          rentLamports: result.estimatedRentReclaimLamports,
          reclaimFeeLamports: result.estimatedReclaimFeeLamports,
        });
      }

      patch({ phase: "awaiting-signature", error: null });

      // ── 1. Ask the wallet to sign everything in one approval ──────────────
      const signed = await signTransactions(
        { signTransaction, signAllTransactions },
        result.packed,
      );

      // ── 2. Submit and confirm, one transaction at a time ──────────────────
      patch({
        phase: "submitting",
        progress: { completed: 0, total: signed.length },
      });

      const submits = await submitTransactions(
        connection,
        signed,
        result.packed,
        {
          blockhash: result.blockhash,
          lastValidBlockHeight: result.lastValidBlockHeight,
        },
        (completed, total) => patch({ progress: { completed, total } }),
      );

      patch({ phase: "confirming" });

      // ── 3. Attribute the results back to individual tokens ────────────────
      // We packed these swaps ourselves, so we know exactly which mints rode in
      // which transaction. That is what turns "a batch failed" into a clear
      // per-token result.
      const config = OUTPUT_ASSETS[request.outputAsset];
      const meta: OutcomeMeta[] = result.plan.builds.map((build) => {
        const source = request.tokens.find((token) => token.mint === build.mint);
        const packedTx = result.packed.find((tx) => tx.mints.includes(build.mint));
        // The value of what was *swapped*, not of the whole holding. A token set
        // to 10% moved a tenth of its value, and both the success screen and the
        // local history ledger sum this figure — reporting the full balance
        // would overstate every partial sweep. A full swap resolves to a fraction
        // of exactly 1, so this changes nothing for the original behaviour.
        const swapped = resolveAmount(source?.rawAmount ?? "0", build.inAmount);
        return {
          mint: build.mint,
          symbol: build.symbol,
          logoUri: build.logoUri,
          valueUsd: source && swapped.ok ? source.valueUsd * swapped.fraction : 0,
          inputAmount: build.inAmount,
          outAmount: build.outAmount,
          priceImpactPct: build.priceImpactPct,
          routeLabels: build.routeLabels,
          rentReclaimMints: packedTx?.rentReclaimMints ?? [],
        };
      });

      const outcomes = buildTokenOutcomes(submits, meta, config.decimals);

      const summary = buildSummary({
        plan: result.plan,
        packed: result.packed,
        simulations: result.simulations,
        outcomes,
        outputAsset: request.outputAsset,
        estimatedFeeLamports: result.estimatedFeeLamports,
        rentByMint: result.rentByMint,
        feeByMint: result.feeByMint,
        dryRun: false,
      });

      playFlowSound(
        "success",
        outcomes.filter((outcome) => outcome.status !== "success").length,
      );
      patch({
        phase: "success",
        isDryRun: false,
        outcomes,
        summary,
        progress: { completed: signed.length, total: signed.length },
      });

      // A signed sweep is finished. Re-signing the same batch could only
      // re-report transactions the chain already saw; a retry builds a new plan.
      preparedRef.current = null;

      return true;
    } catch (caught) {
      playFlowSound("error");
      patch({ phase: "error", error: toFriendlyError(caught) });
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [connection, patch, publicKey, signAllTransactions, signTransaction]);

  return { ...state, prepare, execute, reset, isBusy };
}