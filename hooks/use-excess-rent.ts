"use client";

import { useCallback, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getConnection } from "@/lib/solana/connection";
import {
  BLOCKHASH_PROMPT_MARGIN_SLOTS,
  isBlockhashExpired,
} from "@/lib/solana/blockhash";
import { playFlowSound } from "@/lib/ui/sound";
import { signTransactions, submitTransactions } from "@/lib/solana/submit";
import {
  planExcessRentTx,
  type PlanExcessRentResult,
} from "@/lib/solana/withdraw-excess-rent";
import { CloseError } from "@/lib/solana/close-accounts";
import { isBusyPhase } from "@/lib/sweep/phase";
import { toFriendlyError, type FriendlyError } from "@/lib/utils/errors";
import type {
  PackedTransaction,
  SimulationOutcome,
  SweepPhase,
} from "@/types/sweep";
import type { ExcessRentAccount } from "@/types/salvage";

/**
 * Refund surplus rent from Token-2022 accounts.
 *
 * Same preview → simulate → sign → submit pipeline as the close flows, but no
 * account is closed: each instruction returns the lamports above that account's
 * own rent-exempt minimum and leaves the tokens untouched.
 */

export interface ExcessRentSummary {
  excessLamports: number;
  reclaimFeeLamports: number;
  netRentLamports: number;
  feeLamports: number;
  signatures: string[];
  accountCount: number;
  failedCount: number;
}

interface ExcessRentState {
  phase: SweepPhase;
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  summary: ExcessRentSummary | null;
  error: FriendlyError | null;
  warnings: string[];
  progress: { completed: number; total: number };
  accounts: ExcessRentAccount[];
  excessLamports: number;
  reclaimFeeLamports: number;
  netRentLamports: number;
  estimatedFeeLamports: number;
  accountCount: number;
}

const INITIAL: ExcessRentState = {
  phase: "idle",
  packed: [],
  simulations: [],
  summary: null,
  error: null,
  warnings: [],
  progress: { completed: 0, total: 0 },
  accounts: [],
  excessLamports: 0,
  reclaimFeeLamports: 0,
  netRentLamports: 0,
  estimatedFeeLamports: 0,
  accountCount: 0,
};

export function useExcessRent() {
  const { publicKey, signTransaction, signAllTransactions, wallet } = useWallet();
  const connection = getConnection();

  const busyRef = useRef(false);
  const preparedRef = useRef<{
    result: PlanExcessRentResult;
    accounts: ExcessRentAccount[];
  } | null>(null);

  const [state, setState] = useState<ExcessRentState>(INITIAL);

  const patch = useCallback((next: Partial<ExcessRentState>): void => {
    setState((previous) => ({ ...previous, ...next }));
  }, []);

  const reset = useCallback((): void => {
    busyRef.current = false;
    preparedRef.current = null;
    setState(INITIAL);
  }, []);

  const applyPlan = useCallback(
    (result: PlanExcessRentResult): void => {
      patch({
        phase: "idle",
        packed: result.packed,
        simulations: result.simulations,
        warnings: result.warnings,
        excessLamports: result.excessLamports,
        reclaimFeeLamports: result.reclaimFeeLamports,
        netRentLamports: result.netRentLamports,
        estimatedFeeLamports: result.estimatedFeeLamports,
        accountCount: result.accountCount,
      });
    },
    [patch],
  );

  const prepare = useCallback(
    async (accounts: ExcessRentAccount[]): Promise<boolean> => {
      if (busyRef.current) return false;
      if (!publicKey) {
        patch({
          error: {
            title: "Wallet not connected",
            message: "Connect the wallet before refunding rent.",
          },
        });
        return false;
      }

      busyRef.current = true;
      patch({
        phase: "planning",
        error: null,
        warnings: [],
        accounts,
        packed: [],
        simulations: [],
        summary: null,
        excessLamports: 0,
        reclaimFeeLamports: 0,
        netRentLamports: 0,
        estimatedFeeLamports: 0,
        accountCount: 0,
      });
      try {
        const result = await planExcessRentTx({
          connection,
          owner: publicKey,
          accounts,
        });
        preparedRef.current = { result, accounts };
        applyPlan(result);
        return true;
      } catch (caught) {
        preparedRef.current = null;
        patch({
          phase: "error",
          error: toFriendlyError(caught),
          warnings: caught instanceof CloseError ? caught.warnings : [],
        });
        return false;
      } finally {
        busyRef.current = false;
      }
    },
    [applyPlan, connection, patch, publicKey],
  );


  const execute = useCallback(async (): Promise<boolean> => {
    const prepared = preparedRef.current;
    if (!prepared) {
      patch({
        error: {
          title: "Nothing to withdraw",
          message: "Run the preview first so you can review the withdrawal.",
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
    let result = prepared.result;

    try {
      if (
        await isBlockhashExpired(
          connection,
          result.lastValidBlockHeight,
          BLOCKHASH_PROMPT_MARGIN_SLOTS,
        )
      ) {
        patch({ phase: "planning", error: null });
        result = await planExcessRentTx({
          connection,
          owner: publicKey,
          accounts: prepared.accounts,
        });
        preparedRef.current = { result, accounts: prepared.accounts };
        applyPlan(result);
      }

      patch({ phase: "awaiting-signature", error: null });

      const signed = await signTransactions(
        { signTransaction, signAllTransactions, walletName: wallet?.adapter.name },
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

      const landed = submits.filter((submit) => submit.ok);
      if (landed.length === 0) {
        const failed = submits.find((submit) => !submit.ok);
        throw new Error(
          failed?.error ?? "The rent refund was not submitted.",
        );
      }

      const landedAccounts = new Set(landed.flatMap((submit) => submit.mints));
      const excessLamports = [...landedAccounts].reduce(
        (sum, address) => sum + (result.excessByAccount[address] ?? 0),
        0,
      );
      const reclaimFeeLamports = [...landedAccounts].reduce(
        (sum, address) => sum + (result.feeByAccount[address] ?? 0),
        0,
      );
      const failedAccounts = result.accountCount - landedAccounts.size;

      const summary: ExcessRentSummary = {
        excessLamports,
        reclaimFeeLamports,
        netRentLamports: excessLamports - reclaimFeeLamports,
        feeLamports: result.simulations.reduce(
          (sum, simulation) => sum + (simulation.feeLamports ?? 0),
          0,
        ),
        signatures: landed
          .map((submit) => submit.signature)
          .filter((signature): signature is string => Boolean(signature)),
        accountCount: landedAccounts.size,
        failedCount: Math.max(0, failedAccounts),
      };

      playFlowSound("success", Math.max(0, failedAccounts));
      patch({
        phase: "success",
        summary,
        progress: { completed: signed.length, total: signed.length },
      });
      preparedRef.current = null;
      return true;
    } catch (caught) {
      playFlowSound("error");
      patch({ phase: "error", error: toFriendlyError(caught) });
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [
    applyPlan,
    connection,
    patch,
    publicKey,
    signAllTransactions,
    signTransaction,
    wallet?.adapter.name,
  ]);

  return {
    ...state,
    prepare,
    execute,
    reset,
    isBusy: isBusyPhase(state.phase),
  };
}
