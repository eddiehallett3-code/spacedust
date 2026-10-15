"use client";

import { useCallback, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getConnection } from "@/lib/solana/connection";
import {
  BLOCKHASH_APPROVAL_MARGIN_SLOTS,
  isBlockhashExpired,
} from "@/lib/solana/blockhash";
import {
  SendError,
  planSend,
  type PlanSendResult,
  type SendOutcome,
} from "@/lib/payload/plan-send";
import { signTransactions, submitTransactions } from "@/lib/solana/submit";
import { isBusyPhase } from "@/lib/sweep/phase";
import { toFriendlyError, type FriendlyError } from "@/lib/utils/errors";
import type {
  PayloadOutcome,
  PayloadSummary,
} from "@/types/payload";
import type {
  PackedTransaction,
  SimulationOutcome,
  SweepPhase,
} from "@/types/sweep";
import type { DustToken, NonFungibleAsset } from "@/types/token";

export interface PayloadRequest {
  /** Where the batch is going. */
  recipient: string;
  tokens: DustToken[];
  assets: NonFungibleAsset[];
  /** Whether the user has switched destination verification on. */
  requireVerification: boolean;
  /** The address that was verified with a test transfer, when there is one. */
  verifiedAddress: string | null;
}

interface PayloadState {
  phase: SweepPhase;
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  /** Per-item plan: what will be sent, and what was refused. */
  outcomes: SendOutcome[];
  executions: PayloadOutcome[];
  summary: PayloadSummary | null;
  error: FriendlyError | null;
  warnings: string[];
  progress: { completed: number; total: number };
  /** The request the plan was built for, so the UI can show what was prepared. */
  request: PayloadRequest | null;
  /** Money, from the plan's own reads of the chain. */
  rentLamports: number;
  feeLamports: number;
  recipientAccountLamports: number;
  netLamports: number;
  netIsNegative: boolean;
  networkFeeLamports: number;
}

const INITIAL: PayloadState = {
  phase: "idle",
  packed: [],
  simulations: [],
  outcomes: [],
  executions: [],
  summary: null,
  error: null,
  warnings: [],
  progress: { completed: 0, total: 0 },
  request: null,
  rentLamports: 0,
  feeLamports: 0,
  recipientAccountLamports: 0,
  netLamports: 0,
  netIsNegative: false,
  networkFeeLamports: 0,
};

/**
 * Payload's orchestrator.
 *
 * The same shape as `useVoid`: build and simulate locally, ask the wallet for one
 * signature, submit, then attribute the batch's results back to individual items.
 * Nothing here holds a key, and nothing is sent before a simulation says it will
 * land.
 *
 * Two things are different from every other flow in this app, and both are
 * deliberate:
 *
 *  - the plan carries the recipient it was built for, and the hook re-checks that
 *    against the request before signing. An address edited after the preview was
 *    built is the exact mistake this feature exists to prevent, so it is a hard
 *    failure rather than a warning;
 *  - the money the user is shown is rent, not value. A send can *cost* lamports —
 *    the recipient needs an account, and the sender pays for it — so the net
 *    figure is allowed to be negative and the UI is expected to say so.
 */
export function usePayload() {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const connection = getConnection();

  const busyRef = useRef(false);
  const preparedRef = useRef<{
    result: PlanSendResult;
    request: PayloadRequest;
  } | null>(null);

  const [state, setState] = useState<PayloadState>(INITIAL);

  const patch = useCallback((next: Partial<PayloadState>): void => {
    setState((previous) => ({ ...previous, ...next }));
  }, []);

  const reset = useCallback((): void => {
    busyRef.current = false;
    preparedRef.current = null;
    setState(INITIAL);
  }, []);

  /**
   * Build, pack and simulate the batch.
   *
   * Returns the transaction count so the caller can show the real number without
   * waiting for a re-render, and 0 for anything that stopped before a plan.
   */
  const prepare = useCallback(
    async (request: PayloadRequest): Promise<number> => {
      if (busyRef.current) return 0;

      if (!publicKey) {
        patch({
          error: {
            title: "Wallet not connected",
            message: "Connect the wallet you are sending from before preparing a batch.",
          },
        });
        return 0;
      }

      if (request.tokens.length === 0 && request.assets.length === 0) {
        patch({
          error: {
            title: "Nothing selected",
            message: "Choose at least one token or NFT to send.",
          },
        });
        return 0;
      }

      let recipient: PublicKey;
      try {
        recipient = new PublicKey(request.recipient);
      } catch {
        patch({
          error: {
            title: "That is not an address",
            message: "The destination is not a valid Solana address.",
          },
        });
        return 0;
      }

      busyRef.current = true;
      patch({ phase: "planning", request, error: null, warnings: [] });

      try {
        const result = await planSend({
          connection,
          owner: publicKey,
          recipient,
          tokens: request.tokens,
          assets: request.assets,
          requireVerification: request.requireVerification,
          verifiedAddress: request.verifiedAddress,
        });

        preparedRef.current = { result, request };
        patch({
          // Back to `idle`, deliberately — *not* a resting "simulating".
          // `isBusy` counts "simulating" as busy, so leaving it set kept a Void
          // preview rendered beside a send button that was disabled forever. The
          // same trap, so the same fix.
          phase: "idle",
          packed: result.packed,
          simulations: result.simulations,
          outcomes: result.outcomes,
          warnings: result.warnings,
          rentLamports: result.estimatedRentLamports,
          feeLamports: result.estimatedFeeOnRentLamports,
          recipientAccountLamports: result.estimatedRecipientAccountLamports,
          netLamports: result.estimatedNetLamports,
          netIsNegative: result.netIsNegative,
          networkFeeLamports: result.estimatedFeeLamports,
        });
        return result.packed.length;
      } catch (caught) {
        preparedRef.current = null;
        // A SendError already carries the sentence and the hint the planner wrote
        // for the user, so it is passed through rather than re-described.
        const error: FriendlyError =
          caught instanceof SendError
            ? { title: "This batch cannot be sent", message: caught.message, hint: caught.hint }
            : toFriendlyError(caught);

        patch({
          phase: "error",
          packed: [],
          simulations: [],
          outcomes: [],
          error,
          warnings: [],
        });
        return 0;
      } finally {
        busyRef.current = false;
      }
    },
    [connection, patch, publicKey],
  );

  /**
   * Sign everything in one approval, submit, and attribute the results.
   *
   * Takes the recipient as it stands in the form right now, because this is the
   * last moment at which a changed address can be caught. The plan carries the
   * address it was built for; a batch signed against a different one is the exact
   * failure the verification feature exists to prevent, so it stops here.
   */
  const execute = useCallback(
    async (recipientNow: string): Promise<boolean> => {
      const prepared = preparedRef.current;

      if (!prepared) {
        patch({
          error: {
            title: "Nothing to send",
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

      if (recipientNow.trim() !== prepared.request.recipient.trim()) {
        patch({
          error: {
            title: "The destination changed",
            message: `This batch was built for ${prepared.request.recipient}. It will not be signed against ${recipientNow.trim()}.`,
            hint: "Verify the new address and run the preview again. Nothing was signed.",
          },
        });
        return false;
      }

      busyRef.current = true;
      const { request } = prepared;
      let result = prepared.result;

      try {
        // A preview can sit open longer than a blockhash lives, and the batch is
        // signed with the blockhash taken at preview time. Rebuild rather than
        // hand the wallet something it will refuse — against the *approval*
        // margin, so the window survives the user reading the prompt.
        if (
          await isBlockhashExpired(
            connection,
            result.lastValidBlockHeight,
            BLOCKHASH_APPROVAL_MARGIN_SLOTS,
          )
        ) {
          patch({ phase: "planning", error: null });
          result = await planSend({
            connection,
            owner: publicKey,
            recipient: new PublicKey(request.recipient),
            tokens: request.tokens,
            assets: request.assets,
            requireVerification: request.requireVerification,
            verifiedAddress: request.verifiedAddress,
          });
          preparedRef.current = { result, request };
        }

        patch({ phase: "awaiting-signature", error: null });

        // ── 1. One approval for the whole batch ──────────────────────────
        const signed = await signTransactions(
          { signTransaction, signAllTransactions },
          result.packed,
        );

        // ── 2. Submit and confirm ────────────────────────────────────────
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

        // ── 3. Attribute the batch back to individual items ──────────────
        // We packed these sends ourselves, so we know exactly which mints rode in
        // which transaction — the same reason the sweep and The Void can report per
        // token rather than one opaque result.
        const submitByMint = new Map(
          submits.flatMap((submit) =>
            submit.mints.map((mint) => [mint, submit] as const),
          ),
        );

        const executions: PayloadOutcome[] = result.outcomes.map((outcome) => {
          if (!outcome.sending) {
            return {
              mint: outcome.mint,
              kind: outcome.kind,
              label: outcome.label,
              status: "skipped",
              signature: null,
              error: outcome.refused,
              rentReclaimed: false,
              rentLamports: 0,
              feeLamports: 0,
              recipientAccountLamports: 0,
            };
          }

          const submit = submitByMint.get(outcome.mint);
          const sent = submit?.ok === true;

          // The rent, the fee and the account deposit are only real if the
          // transaction landed: all three were built into it, so its landing is
          // what proves they happened. A failed send costs the network fee and
          // nothing else, which is why none of them are counted here.
          return {
            mint: outcome.mint,
            kind: outcome.kind,
            label: outcome.label,
            status: sent ? "sent" : "failed",
            signature: submit?.signature ?? null,
            error: sent ? null : (submit?.error ?? "Not submitted"),
            rentReclaimed: sent && outcome.reclaimsRent,
            rentLamports: sent && outcome.reclaimsRent ? outcome.rentLamports : 0,
            feeLamports: sent && outcome.reclaimsRent ? outcome.feeLamports : 0,
            recipientAccountLamports: sent
              ? outcome.recipientAccountRentLamports
              : 0,
          };
        });

        const sentItems = executions.filter((item) => item.status === "sent");
        const rentLamports = sentItems.reduce(
          (sum, item) => sum + item.rentLamports,
          0,
        );
        const feeLamports = sentItems.reduce(
          (sum, item) => sum + item.feeLamports,
          0,
        );
        const recipientAccountLamports = sentItems.reduce(
          (sum, item) => sum + item.recipientAccountLamports,
          0,
        );

        const summary: PayloadSummary = {
          sentCount: sentItems.length,
          failedCount: executions.filter((item) => item.status === "failed").length,
          skippedCount: executions.filter((item) => item.status === "skipped").length,
          closedCount: sentItems.filter((item) => item.rentReclaimed).length,
          rentLamports,
          feeLamports,
          recipientAccountLamports,
          // Fees are owed for every transaction submitted, whatever its on-chain
          // outcome; reporting anything else would understate the cost.
          networkFeeLamports: result.simulations.reduce(
            (sum, simulation) => sum + (simulation.feeLamports ?? 0),
            0,
          ),
          netRentLamports:
            rentLamports - feeLamports - recipientAccountLamports,
          signatures: submits
            .filter((submit) => submit.ok && submit.signature)
            .map((submit) => submit.signature as string),
        };

        patch({
          phase: "success",
          executions,
          summary,
          progress: { completed: signed.length, total: signed.length },
        });

        // A signed batch is *finished* and cannot be signed again: its closes have
        // already happened, so a second attempt would be built against accounts
        // that no longer exist — failing on chain while still costing fees. Clearing
        // the prepared plan makes that impossible rather than merely unlikely: a
        // second call now answers "run the preview first". The UI hides the button
        // too, but the guard belongs here as well.
        preparedRef.current = null;
        return true;
      } catch (caught) {
        patch({ phase: "error", error: toFriendlyError(caught) });
        return false;
      } finally {
        busyRef.current = false;
      }
    },
    [connection, patch, publicKey, signAllTransactions, signTransaction],
  );

  return { ...state, prepare, execute, reset, isBusy: isBusyPhase(state.phase) };
}
