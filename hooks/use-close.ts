"use client";

import { useCallback, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getConnection } from "@/lib/solana/connection";
import {
  BLOCKHASH_APPROVAL_MARGIN_SLOTS,
  isBlockhashExpired,
} from "@/lib/solana/blockhash";
import {
  CloseError,
  planEmptyAccountClosesTx,
  type PlanCloseResult,
} from "@/lib/solana/close-accounts";
import { feeFromRentLamports } from "@/lib/solana/rent";
import { RECLAIM_FEE_BPS } from "@/lib/utils/constants";
import { signTransactions, submitTransactions } from "@/lib/solana/submit";
import { isBusyPhase } from "@/lib/sweep/phase";
import { toFriendlyError, type FriendlyError } from "@/lib/utils/errors";
import type {
  CloseOutcome,
  CloseSummary,
  PackedTransaction,
  SimulationOutcome,
  SweepPhase,
} from "@/types/sweep";
import type { EmptyTokenAccount } from "@/types/token";

/**
 * Rent reclaim orchestrator.
 *
 * The same pipeline as the other three flows — build and simulate locally, one
 * wallet approval, submit, confirm — for the smallest possible job: closing
 * token accounts that are already empty.
 *
 * It is a separate hook rather than part of the sweep because it shares nothing
 * with a sweep. There is no route, no price, no slippage and no selection: the
 * accounts hold no assets, so the only decision in the whole flow is whether to
 * take the rent back. It runs even when the wallet holds no dust at all.
 */

export interface CloseRequest {
  accounts: EmptyTokenAccount[];
}

interface CloseState {
  phase: SweepPhase;
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  outcomes: CloseOutcome[];
  summary: CloseSummary | null;
  error: FriendlyError | null;
  warnings: string[];
  /** Transactions confirmed so far, for the progress bar. */
  progress: { completed: number; total: number };
  /** The accounts the current preview was prepared from. */
  accounts: EmptyTokenAccount[];
  /** Rent the current preview will return, in lamports. */
  rentLamports: number;
  /** The Spacedust fee on that rent. */
  reclaimFeeLamports: number;
  /** Rent minus the fee: what the wallet actually receives. */
  netRentLamports: number;
  /** Accounts the current preview will close. */
  closeCount: number;
  /** Network fee the current preview will cost. */
  estimatedFeeLamports: number;
}

const INITIAL: CloseState = {
  phase: "idle",
  packed: [],
  simulations: [],
  outcomes: [],
  summary: null,
  error: null,
  warnings: [],
  progress: { completed: 0, total: 0 },
  accounts: [],
  rentLamports: 0,
  reclaimFeeLamports: 0,
  netRentLamports: 0,
  closeCount: 0,
  estimatedFeeLamports: 0,
};

export function useClose() {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const connection = getConnection();

  const busyRef = useRef(false);
  const preparedRef = useRef<{
    result: PlanCloseResult;
    request: CloseRequest;
  } | null>(null);

  const [state, setState] = useState<CloseState>(INITIAL);

  const patch = useCallback((next: Partial<CloseState>): void => {
    setState((previous) => ({ ...previous, ...next }));
  }, []);

  const reset = useCallback((): void => {
    busyRef.current = false;
    preparedRef.current = null;
    setState(INITIAL);
  }, []);


  /**
   * Build, pack and simulate. Returns the transaction count (0 = failed) so the
   * caller can show the real number without waiting for a re-render.
   */
  const prepare = useCallback(
    async (request: CloseRequest): Promise<number> => {
      if (busyRef.current) return 0;

      if (!publicKey) {
        patch({
          error: {
            title: "Wallet not connected",
            message: "Connect your wallet before reclaiming any rent.",
          },
        });
        return 0;
      }
      if (request.accounts.length === 0) {
        patch({
          error: {
            title: "Nothing to close",
            message: "This wallet has no empty token accounts holding rent.",
          },
        });
        return 0;
      }

      busyRef.current = true;
      patch({ phase: "planning", error: null, warnings: [] });

      try {
        const result = await planEmptyAccountClosesTx({
          connection,
          owner: publicKey,
          accounts: request.accounts,
        });

        // A preview is only ever trusted against the accounts it was built from,
        // so what it was built from is stored beside it. Nothing is signed later
        // than this object's own result.
        preparedRef.current = { result, request };
        patch({
          phase: "idle",
          packed: result.packed,
          simulations: result.simulations,
          warnings: result.warnings,
          accounts: request.accounts,
          rentLamports: result.rentLamports,
          reclaimFeeLamports: result.reclaimFeeLamports,
          netRentLamports: result.netRentLamports,
          closeCount: result.closeCount,
          estimatedFeeLamports: result.estimatedFeeLamports,
        });
        return result.packed.length;
      } catch (caught) {
        preparedRef.current = null;
        patch({
          phase: "error",
          packed: [],
          simulations: [],
          error: toFriendlyError(caught),
          warnings: caught instanceof CloseError ? caught.warnings : [],
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
          title: "Nothing to close",
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
      // The batch is signed under the blockhash captured at preview time, and a
      // preview can sit open longer than one lives. Rebuild against the
      // *approval* margin, so the user starts signing with a window that
      // survives them reading the prompt.
      if (
        await isBlockhashExpired(
          connection,
          result.lastValidBlockHeight,
          BLOCKHASH_APPROVAL_MARGIN_SLOTS,
        )
      ) {
        patch({ phase: "planning", error: null });
        result = await planEmptyAccountClosesTx({
          connection,
          owner: publicKey,
          accounts: request.accounts,
        });
        preparedRef.current = { result, request };
      }

      patch({ phase: "awaiting-signature", error: null });

      const signed = await signTransactions(
        { signTransaction, signAllTransactions },
        result.packed,
      );

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

      // Attribute the batch back to individual accounts. The plan labelled every
      // unit by its token account address, so that is the key.
      const submitByAccount = new Map(
        submits.flatMap((submit) =>
          submit.mints.map((account) => [account, submit] as const),
        ),
      );

      const lamportsByAccount = new Map(
        request.accounts.map((account) => [account.address, account.lamports]),
      );

      const outcomes: CloseOutcome[] = request.accounts.map((account) => {
        const submit = submitByAccount.get(account.address);
        const closed = submit?.ok === true;
        return {
          account: account.address,
          mint: account.mint,
          status: closed ? "closed" : "failed",
          signature: submit?.signature ?? null,
          error: closed ? null : (submit?.error ?? "Not submitted"),
          rentLamports: closed
            ? (lamportsByAccount.get(account.address) ?? 0)
            : 0,
        };
      });

      const closed = outcomes.filter((outcome) => outcome.status === "closed");

      // Only what landed. Rent from a close that failed is still sitting in the
      // account, and reporting it as returned would be a claim the very next scan
      // contradicts — and the fee is only real for the same reason: both were built
      // into the transaction whose landing proves they happened.
      const rentLamports = closed.reduce(
        (sum, outcome) => sum + outcome.rentLamports,
        0,
      );
      const reclaimFeeLamports = closed.reduce(
        (sum, outcome) =>
          sum + feeFromRentLamports(outcome.rentLamports, RECLAIM_FEE_BPS),
        0,
      );

      const summary: CloseSummary = {
        requested: outcomes.length,
        closedCount: closed.length,
        failedCount: outcomes.length - closed.length,
        rentLamports,
        reclaimFeeLamports,
        netRentLamports: rentLamports - reclaimFeeLamports,
        // Owed for every transaction submitted, whatever its on-chain outcome.
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

  return {
    ...state,
    prepare,
    execute,
    reset,
    isBusy: isBusyPhase(state.phase),
  };
}
