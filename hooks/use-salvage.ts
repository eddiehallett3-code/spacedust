"use client";

import { useCallback, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getConnection } from "@/lib/solana/connection";
import {
  BLOCKHASH_APPROVAL_MARGIN_SLOTS,
  isBlockhashExpired,
} from "@/lib/solana/blockhash";
import {
  DeleteError,
  planDomainDeletes,
  type PlanDeleteResult,
} from "@/lib/salvage/plan-delete";
import { feeFromRentLamports } from "@/lib/solana/rent";
import { signTransactions, submitTransactions } from "@/lib/solana/submit";
import { isBusyPhase } from "@/lib/sweep/phase";
import { apiFetch } from "@/lib/utils/api";
import { RECLAIM_FEE_BPS } from "@/lib/utils/constants";
import { toFriendlyError, type FriendlyError } from "@/lib/utils/errors";
import type { ApiInstruction } from "@/types/jupiter";
import type { PackedTransaction, SimulationOutcome, SweepPhase } from "@/types/sweep";
import type {
  DomainDeleteOutcome,
  DomainDeleteSummary,
  SalvageDomain,
} from "@/types/salvage";

/**
 * Salvage's domain-deleting orchestrator.
 *
 * The same pipeline as every other flow here — build and simulate locally, one
 * wallet approval, submit, confirm — with one extra hop at the start: the delete
 * instructions come from `POST /api/domains`, because they belong to the SNS
 * program and this app does not hand-encode another program's instructions. The
 * hop is inside `prepare` rather than in the panel so the UI never touches an
 * instruction it has not been handed.
 *
 * It holds no keys, and nothing is signed before a simulation says it will land.
 */

interface SalvageState {
  phase: SweepPhase;
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  outcomes: DomainDeleteOutcome[];
  summary: DomainDeleteSummary | null;
  error: FriendlyError | null;
  warnings: string[];
  progress: { completed: number; total: number };
  /** The domains the current preview was built from. */
  domains: SalvageDomain[];
  rentLamports: number;
  reclaimFeeLamports: number;
  netRentLamports: number;
  deleteCount: number;
  estimatedFeeLamports: number;
}

const INITIAL: SalvageState = {
  phase: "idle",
  packed: [],
  simulations: [],
  outcomes: [],
  summary: null,
  error: null,
  warnings: [],
  progress: { completed: 0, total: 0 },
  domains: [],
  rentLamports: 0,
  reclaimFeeLamports: 0,
  netRentLamports: 0,
  deleteCount: 0,
  estimatedFeeLamports: 0,
};

export function useSalvage() {
  const { publicKey, signTransaction, signAllTransactions, wallet } = useWallet();
  const connection = getConnection();

  const busyRef = useRef(false);
  const preparedRef = useRef<{
    result: PlanDeleteResult;
    domains: SalvageDomain[];
  } | null>(null);

  const [state, setState] = useState<SalvageState>(INITIAL);

  const patch = useCallback((next: Partial<SalvageState>): void => {
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
    async (domains: SalvageDomain[]): Promise<number> => {
      if (busyRef.current) return 0;

      if (!publicKey) {
        patch({
          error: {
            title: "Wallet not connected",
            message: "Connect the wallet that owns these domains.",
          },
        });
        return 0;
      }
      if (domains.length === 0) {
        patch({
          error: {
            title: "Nothing selected",
            message: "Choose at least one domain.",
          },
        });
        return 0;
      }

      busyRef.current = true;
      patch({ phase: "planning", error: null, warnings: [] });

      try {
        const built = await apiFetch<{ instructions: ApiInstruction[] }>(
          "/api/domains",
          {
            method: "POST",
            body: {
              owner: publicKey.toBase58(),
              domains: domains.map((domain) => ({
                name: domain.name,
                address: domain.address,
              })),
            },
          },
        );

        const result = await planDomainDeletes({
          connection,
          owner: publicKey,
          domains,
          instructions: built.instructions,
        });

        preparedRef.current = { result, domains };
        patch({
          // Back to `idle`, deliberately: `isBusy` counts "simulating" as busy, and
          // leaving it set would render a preview beside a permanently dead button.
          phase: "idle",
          packed: result.packed,
          simulations: result.simulations,
          warnings: result.warnings,
          domains,
          rentLamports: result.rentLamports,
          reclaimFeeLamports: result.reclaimFeeLamports,
          netRentLamports: result.netRentLamports,
          deleteCount: result.deleteCount,
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
          warnings: caught instanceof DeleteError ? caught.warnings : [],
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
          title: "Nothing to delete",
          message: "Run the preview first, so you can review what will be signed.",
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
    const { domains } = prepared;
    let result = prepared.result;

    try {
      // A preview can outlive its blockhash, and the batch is signed with the one
      // taken at preview time. Rebuild — including re-asking the server for the
      // instructions — rather than hand the wallet something it will refuse.
      if (
        await isBlockhashExpired(
          connection,
          result.lastValidBlockHeight,
          BLOCKHASH_APPROVAL_MARGIN_SLOTS,
        )
      ) {
        patch({ phase: "planning", error: null });
        const rebuilt = await apiFetch<{ instructions: ApiInstruction[] }>(
          "/api/domains",
          {
            method: "POST",
            body: {
              owner: publicKey.toBase58(),
              domains: domains.map((domain) => ({
                name: domain.name,
                address: domain.address,
              })),
            },
          },
        );
        result = await planDomainDeletes({
          connection,
          owner: publicKey,
          domains,
          instructions: rebuilt.instructions,
        });
        preparedRef.current = { result, domains };
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

      // Attribute the batch back to individual domains. The plan keyed every unit by
      // its name account, so that is the join.
      const submitByAccount = new Map(
        submits.flatMap((submit) =>
          submit.mints.map((account) => [account, submit] as const),
        ),
      );

      const outcomes: DomainDeleteOutcome[] = domains.map((domain) => {
        const submit = submitByAccount.get(domain.address);
        const deleted = submit?.ok === true;
        // Rent and fee are only real when the delete landed — both were built into
        // the transaction whose landing proves they happened. A failed delete leaves
        // the account, and its rent, exactly where they were.
        return {
          address: domain.address,
          name: domain.name,
          status: deleted ? "deleted" : "failed",
          signature: submit?.signature ?? null,
          error: deleted ? null : (submit?.error ?? "Not submitted"),
          rentLamports: deleted ? domain.lamports : 0,
          feeLamports: deleted
            ? feeFromRentLamports(domain.lamports, RECLAIM_FEE_BPS)
            : 0,
        };
      });

      const deletedOnChain = outcomes.filter(
        (outcome) => outcome.status === "deleted",
      );
      const rentLamports = deletedOnChain.reduce(
        (sum, outcome) => sum + outcome.rentLamports,
        0,
      );
      const reclaimFeeLamports = deletedOnChain.reduce(
        (sum, outcome) => sum + outcome.feeLamports,
        0,
      );

      const summary: DomainDeleteSummary = {
        requested: outcomes.length,
        deletedCount: deletedOnChain.length,
        failedCount: outcomes.length - deletedOnChain.length,
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
        packed: [],
        simulations: [],
        deleteCount: 0,
        progress: { completed: signed.length, total: signed.length },
      });
      // The names are gone; signing this batch again could only fail and cost fees.
      preparedRef.current = null;
      return true;
    } catch (caught) {
      patch({ phase: "error", error: toFriendlyError(caught) });
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [connection, patch, publicKey, signAllTransactions, signTransaction, wallet?.adapter.name]);

  return {
    ...state,
    prepare,
    execute,
    reset,
    isBusy: isBusyPhase(state.phase),
  };
}
