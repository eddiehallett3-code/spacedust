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
  planPumpAccumulatorCloseTx,
  type PlanPumpAccumulatorCloseResult,
} from "@/lib/solana/close-pump-accumulator";
import { CloseError } from "@/lib/solana/close-accounts";
import { isBusyPhase } from "@/lib/sweep/phase";
import { toFriendlyError, type FriendlyError } from "@/lib/utils/errors";
import { useFeeSponsor } from "@/hooks/use-fee-sponsor";
import { totalRepaymentLamports } from "@/lib/sponsor/plan";
import type {
  PackedTransaction,
  SimulationOutcome,
  SweepPhase,
} from "@/types/sweep";
import type { PumpAccumulator } from "@/types/salvage";

/**
 * Close the wallet's Pump.fun volume account.
 *
 * The same preview → simulate → sign → submit → confirm pipeline as the other
 * reclaim flows, for one program-owned account. The direct Pump AMM instruction
 * returns the account's lamports to the owner; the Spacedust fee is appended as
 * a SOL transfer after it, exactly as in the empty-account close.
 */

export interface PumpAccumulatorCloseSummary {
  rentLamports: number;
  reclaimFeeLamports: number;
  netRentLamports: number;
  /** The network fee Spacedust advanced, repaid from this rent (0 if none). */
  sponsorRepaymentLamports: number;
  /** Network and priority fees, owed whatever the outcome. */
  feeLamports: number;
  signature: string | null;
}

interface PumpAccumulatorCloseState {
  phase: SweepPhase;
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  summary: PumpAccumulatorCloseSummary | null;
  error: FriendlyError | null;
  warnings: string[];
  progress: { completed: number; total: number };
  account: PumpAccumulator | null;
  rentLamports: number;
  reclaimFeeLamports: number;
  sponsorRepaymentLamports: number;
  netRentLamports: number;
  estimatedFeeLamports: number;
}

const INITIAL: PumpAccumulatorCloseState = {
  phase: "idle",
  packed: [],
  simulations: [],
  summary: null,
  error: null,
  warnings: [],
  progress: { completed: 0, total: 0 },
  account: null,
  rentLamports: 0,
  reclaimFeeLamports: 0,
  netRentLamports: 0,
  sponsorRepaymentLamports: 0,
  estimatedFeeLamports: 0,
};

export function usePumpAccumulatorClose() {
  const { publicKey, signTransaction, signAllTransactions, wallet } = useWallet();
  const connection = getConnection();
  const { address: feeSponsor } = useFeeSponsor();

  const busyRef = useRef(false);
  const preparedRef = useRef<{
    result: PlanPumpAccumulatorCloseResult;
    account: PumpAccumulator;
  } | null>(null);

  const [state, setState] = useState<PumpAccumulatorCloseState>(INITIAL);

  const patch = useCallback((next: Partial<PumpAccumulatorCloseState>): void => {
    setState((previous) => ({ ...previous, ...next }));
  }, []);

  const reset = useCallback((): void => {
    busyRef.current = false;
    preparedRef.current = null;
    setState(INITIAL);
  }, []);

  const applyPlan = useCallback(
    (result: PlanPumpAccumulatorCloseResult): void => {
      patch({
        phase: "idle",
        packed: result.packed,
        simulations: result.simulations,
        warnings: result.warnings,
        rentLamports: result.rentLamports,
        reclaimFeeLamports: result.reclaimFeeLamports,
        sponsorRepaymentLamports: totalRepaymentLamports(result.sponsor, result.packed.length),
        netRentLamports: result.netRentLamports,
        estimatedFeeLamports: result.estimatedFeeLamports,
      });
    },
    [patch],
  );

  const prepare = useCallback(
    async (account: PumpAccumulator): Promise<boolean> => {
      if (busyRef.current) return false;
      if (!publicKey) {
        patch({
          error: {
            title: "Wallet not connected",
            message: "Connect the wallet before closing this account.",
          },
        });
        return false;
      }

      busyRef.current = true;
      patch({ phase: "planning", error: null, warnings: [], account });
      try {
        const result = await planPumpAccumulatorCloseTx({
          connection,
          owner: publicKey,
          feeSponsor,
          account,
        });
        preparedRef.current = { result, account };
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
    [applyPlan, connection, feeSponsor, patch, publicKey],
  );


  const execute = useCallback(async (): Promise<boolean> => {
    const prepared = preparedRef.current;
    if (!prepared) {
      patch({
        error: {
          title: "Nothing to close",
          message: "Run the preview first so you can review the close.",
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
      // A preview can sit open as long as the user likes. The blockhash lives
      // about a minute, so rebuild at the click rather than sign stale bytes.
      if (
        await isBlockhashExpired(
          connection,
          result.lastValidBlockHeight,
          BLOCKHASH_PROMPT_MARGIN_SLOTS,
        )
      ) {
        patch({ phase: "planning", error: null });
        result = await planPumpAccumulatorCloseTx({
          connection,
          owner: publicKey,
          feeSponsor,
          account: prepared.account,
        });
        preparedRef.current = { result, account: prepared.account };
        applyPlan(result);
      }

      patch({ phase: "awaiting-signature", error: null });

      const signed = await signTransactions(
        { signTransaction, signAllTransactions, walletName: wallet?.adapter.name },
        result.packed,
        { sponsor: result.sponsor !== null },
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

      const landed = submits.find((submit) => submit.ok && submit.signature);
      if (!landed) {
        const failed = submits.find((submit) => !submit.ok);
        throw new Error(
          failed?.error ?? "The Pump.fun account close was not submitted.",
        );
      }

      const summary: PumpAccumulatorCloseSummary = {
        rentLamports: result.rentLamports,
        reclaimFeeLamports: result.reclaimFeeLamports,
        sponsorRepaymentLamports: totalRepaymentLamports(result.sponsor, result.packed.length),
        netRentLamports: result.netRentLamports,
        feeLamports: result.simulations.reduce(
          (sum, simulation) => sum + (simulation.feeLamports ?? 0),
          0,
        ),
        signature: landed.signature,
      };

      playFlowSound("success");
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
    feeSponsor,
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
