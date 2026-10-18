"use client";

import { useFlowSound } from "@/lib/ui/sound";

import { useCallback, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getConnection } from "@/lib/solana/connection";
import { isBlockhashExpired, BLOCKHASH_PROMPT_MARGIN_SLOTS } from "@/lib/solana/blockhash";
import {
  planVoid,
  VoidError,
  type PlanVoidResult,
} from "@/lib/sweep/plan-void";
import { signTransactions, submitTransactions } from "@/lib/solana/submit";
import { sumForMints } from "@/lib/sweep/totals";
import { toFriendlyError, type FriendlyError } from "@/lib/utils/errors";
import { isBusyPhase } from "@/lib/sweep/phase";
import {
  TOKEN_ACCOUNT_RENT_LAMPORTS,
} from "@/lib/utils/constants";
import type {
  VoidOutcome,
  VoidSummary,
  PackedTransaction,
  SimulationOutcome,
  SweepPhase,
} from "@/types/sweep";
import type { DustToken } from "@/types/token";

export interface VoidRequest {
  tokens: DustToken[];
}

interface VoidState {
  phase: SweepPhase;
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  outcomes: VoidOutcome[];
  summary: VoidSummary | null;
  error: FriendlyError | null;
  warnings: string[];
  /** Transactions confirmed so far, for the progress bar. */
  progress: { completed: number; total: number };
  /** The token list the Void was prepared with. */
  tokens: DustToken[];
  /**
   * Rent-exempt minimum for one token account, as last reported by the chain.
   * Starts at the fallback constant so pre-plan renders have a number.
   */
  tokenAccountRentLamports: number;
  /**
   * The deposit each close returns, per mint, read from the account itself by the
   * plan; and The Void's fee on each. Empty before a preview exists.
   */
  rentByMint: Map<string, number>;
  feeByMint: Map<string, number>;
}

const INITIAL: VoidState = {
  phase: "idle",
  packed: [],
  simulations: [],
  outcomes: [],
  summary: null,
  error: null,
  warnings: [],
  progress: { completed: 0, total: 0 },
  tokens: [],
  // Fallbacks, replaced by the plan's fetched rent as soon as one exists.
  tokenAccountRentLamports: TOKEN_ACCOUNT_RENT_LAMPORTS,
  rentByMint: new Map(),
  feeByMint: new Map(),
};

/**
 * The Void orchestrator.
 *
 * Deliberately a *separate* pipeline from `useSweep`: swaps and burns never
 * share a transaction, a preview, or a signature prompt. The user picks one
 * flow and finishes it, then the other — the app suggests swapping first and
 * burning what is left over.
 *
 * Like the sweep hook, this one holds no keys. It builds and simulates locally,
 * asks the wallet to sign, then submits and confirms.
 */
export function useVoid() {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const connection = getConnection();

  const busyRef = useRef(false);
  const preparedRef = useRef<{
    result: PlanVoidResult;
    request: VoidRequest;
  } | null>(null);

  const [state, setState] = useState<VoidState>(INITIAL);

  // One sound per flow, played when it comes to rest — not per batch.
  useFlowSound(
    state.phase,
    state.outcomes.filter((outcome) => outcome.status !== "burned").length,
  );

  const patch = useCallback((next: Partial<VoidState>): void => {
    setState((previous) => ({ ...previous, ...next }));
  }, []);

  const reset = useCallback((): void => {
    busyRef.current = false;
    preparedRef.current = null;
    setState(INITIAL);
  }, []);

  /**
   * Build, pack and simulate. Returns the transaction count (0 = failed) so
   * the caller can show the real number without waiting for a re-render.
   */
  const prepare = useCallback(
    async (request: VoidRequest): Promise<number> => {
      if (busyRef.current) return 0;

      if (!publicKey) {
        patch({
          error: {
            title: "Wallet not connected",
            message: "Connect your wallet before sending anything into The Void.",
          },
        });
        return 0;
      }
      if (request.tokens.length === 0) {
        patch({
          error: {
            title: "Nothing selected",
            message: "Select at least one token to send into The Void.",
          },
        });
        return 0;
      }

      busyRef.current = true;
      patch({
        phase: "planning",
        tokens: request.tokens,
        error: null,
        warnings: [],
      });

      try {
        const result = await planVoid({
          connection,
          owner: publicKey,
          tokens: request.tokens,
        });

        preparedRef.current = { result, request };
        patch({
          // Back to `idle`, deliberately — *not* a resting "simulating".
          // `isBusy` counts "simulating" as busy, so leaving it set here kept
          // the phase machine busy for good and left the "Sign & send" button
          // permanently `disabled`. The preview itself rendered correctly, so
          // it looked like the button was broken rather than the phase.
          phase: "idle",
          packed: result.packed,
          simulations: result.simulations,
          warnings: result.warnings,
          tokenAccountRentLamports: result.tokenAccountRentLamports,
          rentByMint: result.rentByMint,
          feeByMint: result.feeByMint,
        });
        return result.packed.length;
      } catch (caught) {
        preparedRef.current = null;
        patch({
          phase: "error",
          packed: [],
          simulations: [],
          error: toFriendlyError(caught),
          warnings: caught instanceof VoidError ? caught.warnings : [],
        });
        return 0;
      } finally {
        busyRef.current = false;
      }
    },
    [connection, patch, publicKey],
  );

  /** Sign everything in one approval, then submit and attribute the results. */
  const execute = useCallback(async (): Promise<boolean> => {
    const prepared = preparedRef.current;
    if (!prepared) {
      patch({
        error: {
          title: "Nothing to send",
          message: "Run the preview first so you can review what will be signed.",
        },
      });
      return false;
    }
    if (busyRef.current) return false;
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
      // A preview can sit open as long as the user wants to read it. The batch
      // was built against a blockhash that lives about a minute, so it is rebuilt
      // at the moment of the click — and against the *prompt* margin, not the
      // approval one: by then the old blockhash is seconds from expiry, and ~30
      // seconds is not enough for a phone approval plus the send burst.
      //
      // The rebuild is a re-plan because that is what The Void's plan costs: one
      // batched read for frozen flags and deposits, one rent read, a pack and a
      // simulation per transaction. Seconds, paid once, by the person who is
      // already waiting — in exchange for reading for as long as they like.
      if (
        await isBlockhashExpired(
          connection,
          result.lastValidBlockHeight,
          BLOCKHASH_PROMPT_MARGIN_SLOTS,
        )
      ) {
        patch({ phase: "planning", error: null });
        result = await planVoid({
          connection,
          owner: publicKey,
          tokens: request.tokens,
        });
        preparedRef.current = { result, request };
        // Everything the preview reads comes from the plan, so all of it moves
        // together. Otherwise the panel describes the old batch — its count, its
        // warnings, its rent — while the wallet is asked to sign the new one.
        patch({
          packed: result.packed,
          simulations: result.simulations,
          warnings: result.warnings,
          tokenAccountRentLamports: result.tokenAccountRentLamports,
          rentByMint: result.rentByMint,
          feeByMint: result.feeByMint,
        });
      }

      patch({ phase: "awaiting-signature", error: null });

      // ── 1. One approval for the whole batch ───────────────────────────────
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

      // ── 3. Attribute the batch results back to individual tokens ──────────
      // We packed these burns ourselves, so we know exactly which mints rode
      // in which transaction.
      const txByMint = new Map(
        result.packed.flatMap((tx) =>
          tx.mints.map((mint) => [mint, tx] as const),
        ),
      );
      const submitByMint = new Map(
        submits.flatMap((submit) =>
          submit.mints.map((mint) => [mint, submit] as const),
        ),
      );

      const outcomes: VoidOutcome[] = request.tokens.map((token) => {
        const tx = txByMint.get(token.mint);
        const submit = submitByMint.get(token.mint);
        const burned = submit?.ok === true;
        return {
          mint: token.mint,
          symbol: token.symbol,
          logoUri: token.logoUri,
          status: burned ? "burned" : "failed",
          signature: submit?.signature ?? null,
          balance: token.balance,
          error: burned ? null : (submit?.error ?? "Not submitted"),
          rentReclaimed:
            burned && tx?.rentReclaimMints.includes(token.mint) === true,
        };
      });

      const closedCount = outcomes.filter((o) => o.rentReclaimed).length;
      // Each successfully closed account carried exactly one fee transfer in
      // the same transaction, so the fee is exact rather than estimated — the
      // transaction landing is what proves both the close and its fee happened.
      //
      // Both figures come from the plan, which read each account's own deposit.
      // The fee is NOT recomputed from a constant here: it was priced when the
      // transfer was built, and restating it is how the two drifted apart before.
      //
      // Summed over the closes that landed, per mint — the same rule the sweep
      // uses, so the two flows cannot report the same wallet differently.
      const settledRentMints = new Set(
        outcomes
          .filter(
            (outcome) => outcome.status === "burned" && outcome.rentReclaimed,
          )
          .map((outcome) => outcome.mint),
      );
      const grossRentLamports = sumForMints(result.rentByMint, settledRentMints);
      const voidFeeLamports = sumForMints(result.feeByMint, settledRentMints);

      const summary: VoidSummary = {
        tokenCount: outcomes.length,
        burnedCount: outcomes.filter((o) => o.status === "burned").length,
        failedCount: outcomes.filter((o) => o.status === "failed").length,
        closedCount,
        // Report what the user actually received, not the gross rent. Showing
        // the pre-fee figure would overstate every number on the success screen.
        rentReclaimedLamports: grossRentLamports - voidFeeLamports,
        voidFeeLamports,
        // Fees are paid for every transaction we submitted, whatever the
        // on-chain outcome — reporting anything else would understate the cost.
        feeLamports: result.simulations.reduce(
          (sum, simulation) => sum + (simulation.feeLamports ?? 0),
          0,
        ),
        signatures: submits
          .filter((submit) => submit.ok && submit.signature)
          .map((submit) => submit.signature as string),
      };

      patch({
        phase: "success",
        outcomes,
        summary,
        tokenAccountRentLamports: result.tokenAccountRentLamports,
        rentByMint: result.rentByMint,
        feeByMint: result.feeByMint,
        progress: { completed: signed.length, total: signed.length },
      });
      return true;
    } catch (caught) {
      patch({ phase: "error", error: toFriendlyError(caught) });
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [connection, patch, publicKey, signAllTransactions, signTransaction]);

  const isBusy = isBusyPhase(state.phase);

  return { ...state, prepare, execute, reset, isBusy };
}
