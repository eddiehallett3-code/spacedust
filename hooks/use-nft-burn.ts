"use client";

import { useCallback, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getConnection } from "@/lib/solana/connection";
import { isBlockhashExpired, BLOCKHASH_APPROVAL_MARGIN_SLOTS } from "@/lib/solana/blockhash";
import { planNftBurn, type PlanNftBurnResult } from "@/lib/sweep/plan-nft-burn";
import { signTransactions, submitTransactions } from "@/lib/solana/submit";
import { toFriendlyError, type FriendlyError } from "@/lib/utils/errors";
import { isBusyPhase } from "@/lib/sweep/phase";
import type { NonFungibleAsset } from "@/types/token";
import type {
  PackedTransaction,
  SimulationOutcome,
  SweepPhase,
} from "@/types/sweep";

/** Per-asset result of a completed NFT burn. */
export interface NftBurnOutcome {
  id: string;
  name: string;
  imageUri: string | null;
  status: "burned" | "failed";
  signature: string | null;
  error: string | null;
  /** True when the token account was closed and its rent returned. */
  rentReclaimed: boolean;
  /**
   * Which class this was, carried into the outcome so the result screen can
   * describe the *batch* rather than whichever tab happens to be open.
   *
   * A batch can span the NFT and cNFT tabs — and Core behaves like neither — so
   * the wording has to come from what burned, not from where the user is looking.
   */
  compressed: boolean;
  interface: string;
}

export interface NftBurnSummary {
  requestedCount: number;
  burnedCount: number;
  failedCount: number;
  closedCount: number;
  rentReclaimedLamports: number;
  feeLamports: number;
  signatures: string[];
  /** Assets we refused to build for, with the reason shown on the row. */
  skipped: Array<{ id: string; name: string; reason: string }>;
}

interface NftBurnState {
  phase: SweepPhase;
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  outcomes: NftBurnOutcome[];
  summary: NftBurnSummary | null;
  error: FriendlyError | null;
  warnings: string[];
  skipped: Array<{ id: string; name: string; reason: string }>;
  progress: { completed: number; total: number };
}

const INITIAL: NftBurnState = {
  phase: "idle",
  packed: [],
  simulations: [],
  outcomes: [],
  summary: null,
  error: null,
  warnings: [],
  skipped: [],
  progress: { completed: 0, total: 0 },
};

/**
 * The NFT burn orchestrator.
 *
 * A third pipeline, alongside `useSweep` and `useVoid`, and separate for the
 * same reason those two are separate from each other: this one destroys
 * one-of-one assets. The cheapest way to guarantee a bug here cannot sweep a
 * token is for it to share no code with the thing that does.
 *
 * Like the others it holds no keys — build and simulate locally, ask the wallet
 * to sign, then submit.
 */
export function useNftBurn() {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const connection = getConnection();

  const busyRef = useRef(false);
  const preparedRef = useRef<PlanNftBurnResult | null>(null);
  const assetsRef = useRef<NonFungibleAsset[]>([]);

  const [state, setState] = useState<NftBurnState>(INITIAL);

  const patch = useCallback((next: Partial<NftBurnState>): void => {
    setState((previous) => ({ ...previous, ...next }));
  }, []);

  const reset = useCallback((): void => {
    busyRef.current = false;
    preparedRef.current = null;
    assetsRef.current = [];
    setState(INITIAL);
  }, []);

  /**
   * Build and simulate. Returns the transaction count (0 = failed), so the
   * caller can react without waiting for a re-render.
   */
  const prepare = useCallback(
    async (assets: NonFungibleAsset[]): Promise<number> => {
      if (busyRef.current) return 0;

      if (!publicKey) {
        patch({
          error: {
            title: "Wallet not connected",
            message: "Connect your wallet before burning anything.",
          },
        });
        return 0;
      }
      if (assets.length === 0) {
        patch({
          error: {
            title: "Nothing selected",
            message: "Select at least one NFT to burn.",
          },
        });
        return 0;
      }

      busyRef.current = true;
      patch({ phase: "planning", error: null, warnings: [], skipped: [] });

      try {
        const result = await planNftBurn({
          connection,
          owner: publicKey,
          assets,
        });

        preparedRef.current = result;
        assetsRef.current = assets;
        patch({
          // `idle`, not a resting "simulating" — `isBusy` counts that as work in
          // progress, which would leave the burn button disabled for good.
          phase: "idle",
          packed: result.packed,
          simulations: result.simulations,
          warnings: result.warnings,
          skipped: result.skipped,
        });
        return result.packed.length;
      } catch (caught) {
        preparedRef.current = null;
        patch({
          phase: "error",
          packed: [],
          simulations: [],
          skipped: [],
          error: toFriendlyError(caught),
        });
        return 0;
      } finally {
        busyRef.current = false;
      }
    },
    [connection, patch, publicKey],
  );

  /**
   * Sign everything in one approval, then submit and attribute the results.
   *
   * Returns the ids that actually burned, so the caller can stop showing them.
   * The chain forgets a destroyed asset at once; the index that feeds the scan
   * does not, and a burned cNFT leaves no account behind to check — so the only
   * reliable record of "this one is gone" is the burn itself.
   */
  const execute = useCallback(async (): Promise<string[]> => {
    const prepared = preparedRef.current;
    if (!prepared) {
      patch({
        error: {
          title: "Nothing to burn",
          message: "Run the preview first so you can see what will be signed.",
        },
      });
      return [];
    }
    if (busyRef.current) return [];
    if (!publicKey || (!signTransaction && !signAllTransactions)) {
      patch({
        error: {
          title: "Wallet cannot sign",
          message: "This wallet does not support signing transactions.",
          hint: "Try a different wallet, such as Phantom or Solflare.",
        },
      });
      return [];
    }

    busyRef.current = true;
    const assets = assetsRef.current;
    let result = prepared;

    try {
      // A preview can sit open longer than a blockhash lives. Rebuild rather
      // than hand the wallet something it will refuse to sign — against the
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
        result = await planNftBurn({ connection, owner: publicKey, assets });
        preparedRef.current = result;
        patch({ skipped: result.skipped, warnings: result.warnings });
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

      // We packed these ourselves, so we know which asset rode in which
      // transaction — no need to guess from the result order.
      const submitByMint = new Map(
        submits.flatMap((submit) =>
          submit.mints.map((mint) => [mint, submit] as const),
        ),
      );
      const txByMint = new Map(
        result.packed.flatMap((tx) => tx.mints.map((mint) => [mint, tx] as const)),
      );

      const outcomes: NftBurnOutcome[] = assets.map((asset) => {
        const submit = submitByMint.get(asset.id);
        const tx = txByMint.get(asset.id);
        const burned = submit?.ok === true;
        return {
          id: asset.id,
          name: asset.name,
          imageUri: asset.imageUri,
          compressed: asset.compressed,
          interface: asset.interface,
          status: burned ? "burned" : "failed",
          signature: submit?.signature ?? null,
          error: burned ? null : (submit?.error ?? "Not submitted"),
          rentReclaimed:
            burned && tx?.rentReclaimMints.includes(asset.id) === true,
        };
      });

      const closedCount = outcomes.filter((o) => o.rentReclaimed).length;

      const summary: NftBurnSummary = {
        requestedCount: assets.length,
        burnedCount: outcomes.filter((o) => o.status === "burned").length,
        failedCount: outcomes.filter((o) => o.status === "failed").length,
        closedCount,
        // Per asset, straight from the plan: a Core burn returns a different
        // amount from an SPL one, and it is read rather than assumed.
        rentReclaimedLamports: outcomes
          .filter((outcome) => outcome.rentReclaimed)
          .reduce(
            (sum, outcome) => sum + (result.rentByAsset[outcome.id] ?? 0),
            0,
          ),
        // Fees are owed for every submitted transaction, whatever the outcome.
        feeLamports: result.simulations.reduce(
          (sum, simulation) => sum + (simulation.feeLamports ?? 0),
          0,
        ),
        signatures: submits
          .filter((submit) => submit.ok && submit.signature)
          .map((submit) => submit.signature as string),
        skipped: result.skipped,
      };

      patch({
        phase: "success",
        outcomes,
        summary,
        progress: { completed: signed.length, total: signed.length },
      });
      // Only the ones that landed. A failed burn leaves a live asset, and
      // hiding that would hide something the user still owns.
      return outcomes
        .filter((outcome) => outcome.status === "burned")
        .map((outcome) => outcome.id);
    } catch (caught) {
      patch({ phase: "error", error: toFriendlyError(caught) });
      return [];
    } finally {
      busyRef.current = false;
    }
  }, [connection, patch, publicKey, signAllTransactions, signTransaction]);

  const isBusy = isBusyPhase(state.phase);

  return { ...state, prepare, execute, reset, isBusy };
}
