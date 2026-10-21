"use client";

import { useCallback, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getConnection } from "@/lib/solana/connection";
import {
  BLOCKHASH_PROMPT_MARGIN_SLOTS,
  isBlockhashExpired,
} from "@/lib/solana/blockhash";
import {
  UnwrapError,
  planWrappedSolUnwrapsTx,
  wrappedSolFeeLamports,
  type PlanUnwrapResult,
} from "@/lib/salvage/plan-unwrap";
import { signTransactions, submitTransactions } from "@/lib/solana/submit";
import { isBusyPhase } from "@/lib/sweep/phase";
import { playFlowSound } from "@/lib/ui/sound";
import { toFriendlyError, type FriendlyError } from "@/lib/utils/errors";
import type {
  PackedTransaction,
  SimulationOutcome,
  SweepPhase,
} from "@/types/sweep";
import type { WrappedSolAccount } from "@/types/salvage";

interface UnwrapState {
  phase: SweepPhase;
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  summary: UnwrapSummary | null;
  error: FriendlyError | null;
  warnings: string[];
  progress: { completed: number; total: number };
  accounts: WrappedSolAccount[];
  closeCount: number;
  wrappedLamports: number;
  rentLamports: number;
  reclaimFeeLamports: number;
  netReturnedLamports: number;
  estimatedFeeLamports: number;
}

export interface UnwrapSummary {
  requested: number;
  closedCount: number;
  failedCount: number;
  wrappedLamports: number;
  rentLamports: number;
  reclaimFeeLamports: number;
  netReturnedLamports: number;
  feeLamports: number;
  signatures: string[];
}

const INITIAL: UnwrapState = {
  phase: "idle",
  packed: [],
  simulations: [],
  summary: null,
  error: null,
  warnings: [],
  progress: { completed: 0, total: 0 },
  accounts: [],
  closeCount: 0,
  wrappedLamports: 0,
  rentLamports: 0,
  reclaimFeeLamports: 0,
  netReturnedLamports: 0,
  estimatedFeeLamports: 0,
};

/** Preview, sign and submit the unwrap of non-empty wrapped-SOL accounts. */
export function useUnwrapWrappedSol() {
  const { publicKey, signTransaction, signAllTransactions, wallet } = useWallet();
  const connection = getConnection();

  const busyRef = useRef(false);
  const preparedRef = useRef<{
    result: PlanUnwrapResult;
    accounts: WrappedSolAccount[];
  } | null>(null);

  const [state, setState] = useState<UnwrapState>(INITIAL);

  const patch = useCallback((next: Partial<UnwrapState>): void => {
    setState((previous) => ({ ...previous, ...next }));
  }, []);

  const reset = useCallback((): void => {
    busyRef.current = false;
    preparedRef.current = null;
    setState(INITIAL);
  }, []);

  const describe = useCallback(
    (result: PlanUnwrapResult): Partial<UnwrapState> => ({
      packed: result.packed,
      simulations: result.simulations,
      warnings: result.warnings,
      closeCount: result.closeCount,
      wrappedLamports: result.wrappedLamports,
      rentLamports: result.rentLamports,
      reclaimFeeLamports: result.reclaimFeeLamports,
      netReturnedLamports: result.netReturnedLamports,
      estimatedFeeLamports: result.estimatedFeeLamports,
    }),
    [],
  );

  const prepare = useCallback(
    async (accounts: WrappedSolAccount[]): Promise<number> => {
      if (busyRef.current) return 0;

      if (!publicKey) {
        patch({
          error: {
            title: "Wallet not connected",
            message: "Connect the wallet that holds the wrapped SOL.",
          },
        });
        return 0;
      }
      if (accounts.length === 0) {
        patch({
          error: {
            title: "Nothing to unwrap",
            message: "This wallet has no wrapped SOL accounts.",
          },
        });
        return 0;
      }

      busyRef.current = true;
      patch({ phase: "planning", error: null, warnings: [] });

      try {
        const result = await planWrappedSolUnwrapsTx({
          connection,
          owner: publicKey,
          accounts,
        });

        preparedRef.current = { result, accounts };
        patch({ phase: "idle", ...describe(result) });
        return result.packed.length;
      } catch (caught) {
        preparedRef.current = null;
        patch({
          phase: "error",
          packed: [],
          simulations: [],
          error: toFriendlyError(caught),
          warnings: caught instanceof UnwrapError ? caught.warnings : [],
        });
        return 0;
      } finally {
        busyRef.current = false;
      }
    },
    [connection, describe, patch, publicKey],
  );

  const execute = useCallback(async (): Promise<boolean> => {
    const prepared = preparedRef.current;
    if (!prepared) {
      patch({
        error: {
          title: "Nothing to unwrap",
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
    const { accounts } = prepared;
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
        result = await planWrappedSolUnwrapsTx({
          connection,
          owner: publicKey,
          accounts,
        });
        preparedRef.current = { result, accounts };
        patch(describe(result));
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

      const successful = submits.filter((submit) => submit.ok);
      const landed = new Set(successful.flatMap((submit) => submit.mints));
      const landedAccounts = accounts.filter((account) =>
        landed.has(account.address),
      );

      // Priced from what actually landed, exactly as the plan did. A close that
      // failed leaves its wrapped SOL and rent in the account, so claiming either
      // would be contradicted by the next scan.
      const wrappedLamports = landedAccounts.reduce(
        (sum, account) => sum + account.amountLamports,
        0,
      );
      const rentLamports = landedAccounts.reduce(
        (sum, account) => sum + Math.max(0, account.rentLamports),
        0,
      );
      const reclaimFeeLamports =
        result.reclaimFeeLamports > 0
          ? landedAccounts.reduce(
              (sum, account) => sum + wrappedSolFeeLamports(account),
              0,
            )
          : 0;

      const summary: UnwrapSummary = {
        requested: accounts.length,
        closedCount: landed.size,
        failedCount: accounts.length - landed.size,
        wrappedLamports,
        rentLamports,
        reclaimFeeLamports,
        netReturnedLamports:
          wrappedLamports + rentLamports - reclaimFeeLamports,
        feeLamports: result.simulations.reduce(
          (sum, simulation) => sum + (simulation.feeLamports ?? 0),
          0,
        ),
        signatures: successful
          .map((submit) => submit.signature)
          .filter((signature): signature is string => typeof signature === "string"),
      };

      playFlowSound("success", accounts.length - landed.size);
      patch({
        phase: "success",
        summary,
        packed: [],
        simulations: [],
        closeCount: 0,
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
    connection,
    describe,
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
