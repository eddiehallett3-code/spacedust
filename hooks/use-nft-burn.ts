"use client";

import { playFlowSound } from "@/lib/ui/sound";

import { useCallback, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getConnection } from "@/lib/solana/connection";
import { isBlockhashExpired, BLOCKHASH_PROMPT_MARGIN_SLOTS } from "@/lib/solana/blockhash";
import { planNftBurn, type PlanNftBurnResult } from "@/lib/sweep/plan-nft-burn";
import { signTransactions, submitTransactions } from "@/lib/solana/submit";
import {
  buildCnftLookupTableSetup,
  LOOKUP_TABLE_META_SIZE,
  waitForLookupTables,
} from "@/lib/solana/cnft-lookup-table";
import { fetchCnftProofs } from "@/lib/sweep/asset-proof";
import { BASE_FEE_LAMPORTS } from "@/lib/utils/constants";
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
  /**
   * Rent locked in a lookup table created to fit a long proof.
   *
   * A lookup table is an on-chain account and the burn does not close it, so
   * this is a real cost of the rescue — not a fee and not refunded by the
   * result. Reported separately so the screen can say so.
   */
  lookupTableRentLamports: number;
  /** Assets we refused to build for, with the reason shown on the row. */
  skipped: Array<{ id: string; name: string; reason: string }>;
}

export interface NftBurnPrepareResult {
  /** Transactions that are built and simulated now. */
  transactions: number;
  /** cNFTs whose burns will need a lookup table at execution time. */
  lookupTables: number;
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
  /** cNFTs waiting for a lookup-table setup before they can be simulated. */
  lookupTableAssets: NonFungibleAsset[];
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
  lookupTableAssets: [],
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
   * Build and simulate. Returns counts rather than a bare number, because a
   * preview can consist entirely of cNFTs waiting for a lookup table — in which
   * case there are zero transactions but the preview is still valid.
   */
  const prepare = useCallback(
    async (assets: NonFungibleAsset[]): Promise<NftBurnPrepareResult> => {
      if (busyRef.current) {
        return { transactions: 0, lookupTables: 0 };
      }

      if (!publicKey) {
        patch({
          error: {
            title: "Wallet not connected",
            message: "Connect your wallet before sending anything into The Void.",
          },
        });
        return { transactions: 0, lookupTables: 0 };
      }
      if (assets.length === 0) {
        patch({
          error: {
            title: "Nothing selected",
            message: "Select at least one NFT to send.",
          },
        });
        return { transactions: 0, lookupTables: 0 };
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
          lookupTableAssets: result.lookupTableAssets,
        });
        return {
          transactions: result.packed.length,
          lookupTables: result.lookupTableAssets.length,
        };
      } catch (caught) {
        preparedRef.current = null;
        patch({
          phase: "error",
          packed: [],
          simulations: [],
          skipped: [],
          lookupTableAssets: [],
          error: toFriendlyError(caught),
        });
        return { transactions: 0, lookupTables: 0 };
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
          title: "Nothing to send",
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
      // A preview can sit open for as long as the user wants to read it; the
      // blockhash it was built with lives about a minute. So the batch is rebuilt
      // at the moment of the click, against the *prompt* margin: by then the old
      // blockhash is almost always within seconds of expiry, and the approval
      // margin would settle for ~30 seconds — a phone approval plus a burst of
      // transactions can spend that, and the tail is what loses the race.
      //
      // A rebuild is a **re-plan**, not a re-pack, on purpose. A cNFT burn carries
      // a merkle proof, and a proof is only valid against its tree's root *now* —
      // a tree someone is minting into moves every few seconds. Re-planning
      // re-fetches every proof, so a long read cannot leave us signing membership
      // that moved while the user was reading. That costs a proof fetch and a
      // simulation per transaction, paid once, at the click.
      if (
        await isBlockhashExpired(
          connection,
          result.lastValidBlockHeight,
          BLOCKHASH_PROMPT_MARGIN_SLOTS,
        )
      ) {
        patch({ phase: "planning", error: null });
        result = await planNftBurn({ connection, owner: publicKey, assets });
        preparedRef.current = result;
        // The preview has to describe the batch that will be signed, not the one
        // it described a moment ago: the rebuild can re-group transactions and
        // skip an asset that is no longer burnable, and leaving the old figures
        // on screen is how a panel ends up describing one batch while the wallet
        // is asked to sign another.
        patch({
          packed: result.packed,
          simulations: result.simulations,
          skipped: result.skipped,
          warnings: result.warnings,
          lookupTableAssets: result.lookupTableAssets,
        });
      }

      // ── The lookup-table rescue ───────────────────────────────────────────
      // A canopy-0 proof cannot fit inline, so it was not packed. The table has
      // to exist and be one slot old before a burn can reference it, which
      // means a setup approval and a short wait before the burn can even be
      // simulated. This only runs for the leaves that actually need it.
      const lookupTableSignatures: string[] = [];
      let lookupTableRentLamports = 0;
      let lookupTableFeeLamports = 0;

      if (result.lookupTableAssets.length > 0) {
        patch({ phase: "planning", error: null });

        // One proof snapshot for both the table and the burn. Re-fetching after
        // the table is built could name sibling hashes the table does not
        // contain, which would put them back inline.
        const cnftIds = assets
          .filter((asset) => asset.compressed)
          .map((asset) => asset.id);
        const proofs = await fetchCnftProofs(cnftIds);

        const pending = result.lookupTableAssets.map((asset) => ({
          asset,
          proof: proofs.get(asset.id),
        }));
        if (pending.some((entry) => entry.proof === undefined)) {
          throw new Error(
            "A cNFT's merkle proof could not be fetched while preparing its lookup table. Nothing was burned; try again in a moment.",
          );
        }

        const addresses = [
          ...new Set(
            pending.flatMap((entry) => entry.proof?.proof ?? []),
          ),
        ];
        if (addresses.length === 0) {
          throw new Error(
            "The selected cNFTs have no proof nodes to put in a lookup table. Nothing was burned.",
          );
        }

        const setup = await buildCnftLookupTableSetup({
          connection,
          payer: publicKey,
          addresses,
        });
        if (setup.packed.length === 0 || setup.tables.length === 0) {
          throw new Error(
            "The proof nodes could not be placed in a lookup table. Nothing was burned.",
          );
        }

        patch({ phase: "awaiting-signature", error: null });
        const signedSetup = await signTransactions(
          { signTransaction, signAllTransactions },
          setup.packed,
        );

        patch({
          phase: "confirming",
          progress: { completed: 0, total: signedSetup.length },
        });

        // Setup transactions are ordered: create must land before extend. The
        // regular submitter broadcasts a batch in parallel, so submit these one
        // at a time and stop at the first failure rather than extending a table
        // that does not exist.
        for (let index = 0; index < signedSetup.length; index += 1) {
          const transaction = signedSetup[index];
          const meta = setup.packed[index];
          if (!transaction || !meta) continue;

          const [submitted] = await submitTransactions(
            connection,
            [transaction],
            [meta],
            {
              blockhash: setup.blockhash,
              lastValidBlockHeight: setup.lastValidBlockHeight,
            },
          );

          if (!submitted?.ok) {
            throw new Error(
              submitted?.error ??
                "A lookup-table setup transaction did not land. Nothing was burned.",
            );
          }
          if (submitted.signature) {
            lookupTableSignatures.push(submitted.signature);
            lookupTableFeeLamports += BASE_FEE_LAMPORTS;
          }
          patch({
            phase: "confirming",
            progress: {
              completed: index + 1,
              total: signedSetup.length,
            },
          });
        }

        const lookupTables = await waitForLookupTables(
          connection,
          setup.tables,
        );

        // The table account is real and funded now; price its rent so the
        // result screen can say what stayed locked instead of hiding it.
        const rents = await Promise.all(
          setup.tables.map(async (table) => {
            try {
              return await connection.getMinimumBalanceForRentExemption(
                LOOKUP_TABLE_META_SIZE + table.addresses.length * 32,
              );
            } catch {
              return 0;
            }
          }),
        );
        lookupTableRentLamports = rents.reduce((sum, rent) => sum + rent, 0);

        result = await planNftBurn({
          connection,
          owner: publicKey,
          assets,
          proofs,
          lookupTables,
        });
        preparedRef.current = result;
        patch({
          packed: result.packed,
          simulations: result.simulations,
          skipped: result.skipped,
          warnings: result.warnings,
          lookupTableAssets: result.lookupTableAssets,
        });

        if (result.lookupTableAssets.length > 0) {
          throw new Error(
            "A cNFT still does not fit after creating its lookup table. The burn was not signed.",
          );
        }
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
        // The lookup-table setup is a real transaction too, so its base fee is
        // part of what this burn cost even though it carries no asset.
        feeLamports:
          result.simulations.reduce(
            (sum, simulation) => sum + (simulation.feeLamports ?? 0),
            0,
          ) + lookupTableFeeLamports,
        signatures: [
          ...lookupTableSignatures,
          ...submits
            .filter((submit) => submit.ok && submit.signature)
            .map((submit) => submit.signature as string),
        ],
        lookupTableRentLamports,
        skipped: result.skipped,
      };

      playFlowSound(
        "success",
        outcomes.filter((outcome) => outcome.status !== "burned").length,
      );
      patch({
        phase: "success",
        outcomes,
        summary,
        progress: { completed: signed.length, total: signed.length },
      });
      // Nothing here is signable twice: a burned asset has no account left.
      preparedRef.current = null;
      // Only the ones that landed. A failed burn leaves a live asset, and
      // hiding that would hide something the user still owns.
      return outcomes
        .filter((outcome) => outcome.status === "burned")
        .map((outcome) => outcome.id);
    } catch (caught) {
      playFlowSound("error");
      patch({ phase: "error", error: toFriendlyError(caught) });
      return [];
    } finally {
      busyRef.current = false;
    }
  }, [connection, patch, publicKey, signAllTransactions, signTransaction]);

  const isBusy = isBusyPhase(state.phase);

  return { ...state, prepare, execute, reset, isBusy };
}
