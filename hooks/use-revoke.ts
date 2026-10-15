"use client";

import { useCallback, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSolanaConnection } from "@/lib/solana/connection";
import {
  BLOCKHASH_APPROVAL_MARGIN_SLOTS,
  isBlockhashExpired,
} from "@/lib/solana/blockhash";
import {
  planRevokes,
  readTokenApprovals,
  RevokeError,
  type PlanRevokeResult,
  type TokenApproval,
} from "@/lib/solana/approvals";
import { signTransactions, submitTransactions } from "@/lib/solana/submit";
import { isBusyPhase } from "@/lib/sweep/phase";
import { toFriendlyError, type FriendlyError } from "@/lib/utils/errors";
import type {
  PackedTransaction,
  RevokeOutcome,
  RevokeSummary,
  SimulationOutcome,
  SweepPhase,
} from "@/types/sweep";

/**
 * The approvals orchestrator.
 *
 * Structurally the same pipeline as the sweep and The Void: read from the chain,
 * build and simulate locally, one wallet approval, then submit and confirm. It
 * holds no keys.
 *
 * Two things are deliberately different from the other two flows:
 *
 *  - **Reading the approvals is its own step.** The list *is* the decision — "who
 *    currently has power over my balance?" — so it is visible before anything is
 *    selected or prepared.
 *  - **It fails closed.** If the chain cannot be read, the state is an error, not
 *    an empty list. Reporting "no approvals" when we could not look would be the
 *    one genuinely dangerous thing this screen could do.
 */

export interface RevokeState {
  phase: SweepPhase;
  approvals: TokenApproval[];
  /** True once a read has come back, so "none found" is told from "not yet". */
  hasChecked: boolean;
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  outcomes: RevokeOutcome[];
  summary: RevokeSummary | null;
  error: FriendlyError | null;
  warnings: string[];
  progress: { completed: number; total: number };
  /** Total network fee the current preview will cost. */
  estimatedFeeLamports: number;
}

const INITIAL: RevokeState = {
  phase: "idle",
  approvals: [],
  hasChecked: false,
  packed: [],
  simulations: [],
  outcomes: [],
  summary: null,
  error: null,
  warnings: [],
  progress: { completed: 0, total: 0 },
  estimatedFeeLamports: 0,
};

export function useRevoke() {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  // Memoised, so `scan`/`prepare`/`execute` keep stable identities across
  // renders. A fresh Connection per render would change every callback every
  // render, which makes them unusable as effect dependencies.
  const connection = useSolanaConnection();

  const busyRef = useRef(false);
  const preparedRef = useRef<{
    result: PlanRevokeResult;
    approvals: TokenApproval[];
  } | null>(null);

  const [state, setState] = useState<RevokeState>(INITIAL);

  const patch = useCallback((next: Partial<RevokeState>): void => {
    setState((previous) => ({ ...previous, ...next }));
  }, []);

  const reset = useCallback((): void => {
    busyRef.current = false;
    preparedRef.current = null;
    setState(INITIAL);
  }, []);

  /**
   * Read every standing approval on the connected wallet.
   *
   * A throw becomes a *visible error*, never an empty list. That distinction is
   * the whole reason this screen can be trusted: an empty list is a claim.
   */
  const scan = useCallback(async (): Promise<number> => {
    if (!publicKey) {
      patch({
        error: {
          title: "Wallet not connected",
          message: "Connect your wallet to see who can move its tokens.",
          hint: "Reading this signs nothing — it is a plain chain query.",
        },
      });
      return 0;
    }
    if (busyRef.current) return 0;

    busyRef.current = true;
    patch({ phase: "planning", error: null, warnings: [] });

    try {
      const approvals = await readTokenApprovals(connection, publicKey);
      preparedRef.current = null;
      patch({
        // Back to `idle`, not a resting "planning": a busy phase would leave
        // every action disabled, which is exactly the bug The Void hit.
        phase: "idle",
        approvals,
        hasChecked: true,
        packed: [],
        simulations: [],
        outcomes: [],
        summary: null,
        estimatedFeeLamports: 0,
      });
      return approvals.length;
    } catch (caught) {
      patch({
        phase: "error",
        // `hasChecked` stays false: "we could not look" is not "there are none".
        approvals: [],
        hasChecked: false,
        error: toFriendlyError(caught),
      });
      return -1;
    } finally {
      busyRef.current = false;
    }
  }, [connection, patch, publicKey]);

  /** Build, pack and simulate the selected revokes. */
  const prepare = useCallback(
    async (approvals: TokenApproval[]): Promise<number> => {
      if (busyRef.current) return 0;

      if (!publicKey) {
        patch({
          error: {
            title: "Wallet not connected",
            message: "Connect your wallet before revoking anything.",
          },
        });
        return 0;
      }
      if (approvals.length === 0) {
        patch({
          error: {
            title: "Nothing selected",
            message: "Select at least one approval to revoke.",
          },
        });
        return 0;
      }

      busyRef.current = true;
      patch({ phase: "planning", error: null, warnings: [] });

      try {
        const result = await planRevokes({
          connection,
          owner: publicKey,
          approvals,
        });

        preparedRef.current = { result, approvals };
        patch({
          phase: "idle",
          packed: result.packed,
          simulations: result.simulations,
          warnings: result.warnings,
          estimatedFeeLamports: result.estimatedFeeLamports,
        });
        return result.packed.length;
      } catch (caught) {
        preparedRef.current = null;
        patch({
          phase: "error",
          packed: [],
          simulations: [],
          estimatedFeeLamports: 0,
          error: toFriendlyError(caught),
          warnings: caught instanceof RevokeError ? caught.warnings : [],
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
          title: "Nothing to revoke",
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
    const { approvals } = prepared;
    let result = prepared.result;

    try {
      // A preview can sit open longer than a blockhash lives, and the batch is
      // signed with the blockhash captured at preview time. Rebuild rather than
      // hand the wallet something it will refuse — against the *approval* margin,
      // so the user starts signing with a window that survives them reading the
      // prompt.
      if (
        await isBlockhashExpired(
          connection,
          result.lastValidBlockHeight,
          BLOCKHASH_APPROVAL_MARGIN_SLOTS,
        )
      ) {
        patch({ phase: "planning", error: null });
        result = await planRevokes({ connection, owner: publicKey, approvals });
        preparedRef.current = { result, approvals };
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

      // Attribute the batch back to individual approvals. The plan labelled every
      // unit by token account, so that is the key — two accounts can share a mint
      // with different delegates, and keying by mint would merge them.
      const submitByAccount = new Map(
        submits.flatMap((submit) =>
          submit.mints.map((account) => [account, submit] as const),
        ),
      );

      const outcomes: RevokeOutcome[] = approvals.map((approval) => {
        const submit = submitByAccount.get(approval.tokenAccount);
        const revoked = submit?.ok === true;
        return {
          tokenAccount: approval.tokenAccount,
          mint: approval.mint,
          delegate: approval.delegate,
          status: revoked ? "revoked" : "failed",
          signature: submit?.signature ?? null,
          error: revoked ? null : (submit?.error ?? "Not submitted"),
        };
      });

      const revokedAccounts = new Set(
        outcomes
          .filter((outcome) => outcome.status === "revoked")
          .map((outcome) => outcome.tokenAccount),
      );

      const summary: RevokeSummary = {
        requested: outcomes.length,
        revokedCount: outcomes.filter((o) => o.status === "revoked").length,
        failedCount: outcomes.filter((o) => o.status === "failed").length,
        // Fees are owed for every transaction submitted, whatever its on-chain
        // outcome. Reporting anything less would understate the cost.
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
        // A landed revoke did clear the delegate, so the list drops those rows
        // immediately rather than making the user rescan to see it. A rescan is
        // still the way to check the chain itself.
        approvals: approvals.filter(
          (approval) => !revokedAccounts.has(approval.tokenAccount),
        ),
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
    scan,
    prepare,
    execute,
    reset,
    isBusy: isBusyPhase(state.phase),
  };
}
