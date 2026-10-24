"use client";

import { playFlowSound } from "@/lib/ui/sound";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSolanaConnection } from "@/lib/solana/connection";
import { isBlockhashExpired, BLOCKHASH_PROMPT_MARGIN_SLOTS } from "@/lib/solana/blockhash";
import {
  planNftBurn,
  refreshNftBurnBlockhash,
  type PlanNftBurnResult,
} from "@/lib/sweep/plan-nft-burn";
import {
  signTransactions,
  submitTransactions,
  walletSignsSequentially,
  type SubmitResult,
} from "@/lib/solana/submit";
import { signAndSubmitSequentially } from "@/lib/solana/sequential-submit";
import {
  buildCnftLookupTableClose,
  buildCnftLookupTableDeactivation,
  buildCnftLookupTableSetup,
  fetchCnftLookupTableStates,
  lookupTableRef,
  readCnftLookupTableBalances,
  waitForLookupTables,
  waitForLookupTablesClosable,
  type CnftLookupTable,
  type CnftLookupTableState,
} from "@/lib/solana/cnft-lookup-table";
import {
  forgetPendingLookupTableCleanup,
  listPendingLookupTableCleanups,
  rememberPendingLookupTableCleanup,
} from "@/lib/solana/cnft-lookup-table-store";
import { fetchCnftProofs } from "@/lib/sweep/asset-proof";
import { buildBurnRounds } from "@/lib/sweep/burn-rounds";
import { BASE_FEE_LAMPORTS, STORAGE_KEYS } from "@/lib/utils/constants";
import { useLocalStorage, isBoolean } from "@/hooks/use-local-storage";
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
   * Rent that was paid into lookup tables created to fit long proofs.
   *
   * This is the amount that was locked at burn time. It is not a fee: the
   * cleanup flow can deactivate and close those tables to return it, which is
   * why the result screen reports the cleanup separately rather than treating
   * this figure as permanently spent.
   */
  lookupTableRentLamports: number;
  /** Assets we refused to build for, with the reason shown on the row. */
  skipped: Array<{ id: string; name: string; reason: string }>;
}

/** Where the lookup-table rent reclaim is in its lifecycle. */
export type LookupTableCleanupStatus =
  | "available"
  | "deactivating"
  | "waiting"
  | "closing"
  | "reclaimed"
  | "failed";

/**
 * The state of the post-burn table cleanup.
 *
 * A lookup table is an ordinary account, so the rent paid at creation is not
 * gone — but a burn does not close it. Reclaiming it takes two approvals with
 * the wallet as authority (deactivate, then close) and a mandatory 512-slot
 * cooldown in between. The status is carried separately from the burn so the
 * result screen can show that wait without pretending the burn is unfinished.
 */
export interface LookupTableCleanupState {
  status: LookupTableCleanupStatus;
  /** Base58 addresses of the tables this run created. */
  tables: string[];
  /** Rent that was funded into those tables, in lamports. */
  rentLamports: number;
  /** Rent actually returned by closes that landed, in lamports. */
  reclaimedLamports: number;
  /** Network fees paid for cleanup transactions, in lamports. */
  feeLamports: number;
  signatures: string[];
  error: FriendlyError | null;
  /** Cooldown progress, present while `status === "waiting"`. */
  progress: { slotsRemaining: number; deactivationSlot: number } | null;
}

/** A table state whose account is known to still exist. */
type OpenLookupTableState = CnftLookupTableState & {
  account: NonNullable<CnftLookupTableState["account"]>;
};

export interface NftBurnPrepareResult {
  /** Transactions that are built and simulated now. */
  transactions: number;
  /** cNFTs in this preview (round 1) whose burns need a lookup table. */
  lookupTables: number;
  /** Rounds the guided burn will take; more than one when a tree repeats. */
  rounds?: number;
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
  /** Rent-reclaim state for lookup tables created by this run. */
  lookupTableCleanup: LookupTableCleanupState | null;
  progress: { completed: number; total: number };
  /** Present when a selection needs more than one burn round. */
  queue: { round: number; rounds: number; total: number } | null;
  /** True while the guided queue is executing, including between rounds. */
  queueActive: boolean;
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
  lookupTableCleanup: null,
  progress: { completed: 0, total: 0 },
  queue: null,
  queueActive: false,
};

/** Keep the burn's own error wording, but name the part that failed. */
function cleanupFailure(caught: unknown): FriendlyError {
  const friendly = toFriendlyError(caught);
  return {
    title: "Could not reclaim the lookup-table rent",
    message: friendly.message,
    hint:
      friendly.hint ??
      "The table and its rent are still on chain. Nothing else was charged; try the reclaim again.",
  };
}

/** Add a round's tables to the cleanup state without losing earlier rounds. */
function mergeLookupTableCleanup(
  previous: LookupTableCleanupState | null,
  next: LookupTableCleanupState,
): LookupTableCleanupState {
  if (previous === null || previous.status === "reclaimed") return next;
  return {
    ...next,
    status: "available",
    tables: [...new Set([...previous.tables, ...next.tables])],
    rentLamports: previous.rentLamports + next.rentLamports,
    reclaimedLamports: previous.reclaimedLamports + next.reclaimedLamports,
    feeLamports: previous.feeLamports + next.feeLamports,
    signatures: [...previous.signatures, ...next.signatures],
    error: next.error ?? previous.error,
    progress: null,
  };
}

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
interface NftBurnRoundReport {
  outcomes: NftBurnOutcome[];
  summary: NftBurnSummary;
  warnings: string[];
}

export function useNftBurn() {
  const { publicKey, signTransaction, signAllTransactions, wallet } = useWallet();
  const connection = useSolanaConnection();

  const busyRef = useRef(false);
  const preparedRef = useRef<PlanNftBurnResult | null>(null);
  const assetsRef = useRef<NonFungibleAsset[]>([]);
  /** Tables this run created, kept for the post-burn reclaim. */
  const lookupTablesRef = useRef<CnftLookupTable[]>([]);
  const reclaimBusyRef = useRef(false);
  /** Ensures the auto-cleanup starts once per burn, never in a loop on failure. */
  const autoReclaimStartedRef = useRef(false);
  /** The rounds for this selection, and where the queue has reached. */
  const queueRoundsRef = useRef<NonFungibleAsset[][]>([]);
  const queueIndexRef = useRef(0);
  const queueReportsRef = useRef<NftBurnRoundReport[]>([]);
  const queueModeRef = useRef(false);
  /** Blocks a second user-initiated execute while the queue is between rounds. */
  const queueActiveRef = useRef(false);
  /** Allows the queue's own recursive execute calls through that guard. */
  const queueInternalCallRef = useRef(false);

  const [state, setState] = useState<NftBurnState>(INITIAL);
  /**
   * Whether the user wants the cleanup to start on its own after a burn.
   *
   * Off by default, which is the behaviour this screen has always had. The
   * preference is stored so a user who chose it does not have to find the toggle
   * again on the next wallet. It does not remove either wallet approval: it only
   * decides whether Spacedust starts the process without another click.
   */
  const [autoReclaimLookupTableRent, setAutoReclaimLookupTableRent] =
    useLocalStorage<boolean>(
      STORAGE_KEYS.lookupTableAutoReclaim,
      false,
      isBoolean,
    );


  const patch = useCallback((next: Partial<NftBurnState>): void => {
    setState((previous) => ({ ...previous, ...next }));
  }, []);

  /**
   * Bring back a reclaim that was interrupted by a refresh or a closed tab.
   *
   * The table address is persisted the moment setup lands, so the rent is never
   * only in memory. On reconnect we re-read the chain: closed tables are dropped
   * from the store, and any still-open table becomes an available reclaim.
   */
  useEffect(() => {
    if (!publicKey) return;
    const authority = publicKey.toBase58();
    const pending = listPendingLookupTableCleanups(authority);
    if (pending.length === 0) return;

    let cancelled = false;

    void (async () => {
      try {
        const refs = pending.map((table) => lookupTableRef(table.address));
        const states = await fetchCnftLookupTableStates(connection, refs);
        const missing = states
          .filter((state) => state.account === null)
          .map((state) => state.table.address);
        if (missing.length > 0) {
          forgetPendingLookupTableCleanup(authority, missing);
        }

        const open = states.filter(
          (state): state is OpenLookupTableState => state.account !== null,
        );
        if (open.length === 0 || cancelled) return;

        let balances = new Map<string, number>();
        try {
          balances = await readCnftLookupTableBalances(
            connection,
            open.map((state) => state.table),
          );
        } catch {
          // The saved figure is still a useful estimate; the reclaim re-reads
          // the balance before closing.
          balances = new Map();
        }

        const pendingRent = new Map(
          pending.map((table) => [table.address, table.rentLamports]),
        );
        const rentLamports = open.reduce(
          (sum, state) =>
            sum +
            (balances.get(state.table.address) ??
              pendingRent.get(state.table.address) ??
              0),
          0,
        );
        if (cancelled) return;

        lookupTablesRef.current = open.map((state) => state.table);
        setState((previous) => {
          // Never replace a cleanup that belongs to the run already on screen.
          if (previous.lookupTableCleanup !== null) return previous;
          return {
            ...previous,
            lookupTableCleanup: {
              status: "available",
              tables: open.map((state) => state.table.address),
              rentLamports,
              reclaimedLamports: 0,
              feeLamports: 0,
              signatures: [],
              error: null,
              progress: null,
            },
          };
        });
      } catch {
        // A transient read failure leaves the record in place for next time.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, publicKey]);

  const reset = useCallback((): void => {
    busyRef.current = false;
    reclaimBusyRef.current = false;
    autoReclaimStartedRef.current = false;
    queueRoundsRef.current = [];
    queueIndexRef.current = 0;
    queueReportsRef.current = [];
    queueModeRef.current = false;
    queueActiveRef.current = false;
    queueInternalCallRef.current = false;
    preparedRef.current = null;
    assetsRef.current = [];
    lookupTablesRef.current = [];
    setState(INITIAL);
  }, []);

  /**
   * Build and simulate. Returns counts rather than a bare number, because a
   * preview can consist entirely of cNFTs waiting for a lookup table — in which
   * case there are zero transactions but the preview is still valid.
   */
  const prepare = useCallback(
    async (
      assets: NonFungibleAsset[],
      options?: { queue?: boolean },
    ): Promise<NftBurnPrepareResult> => {
      if (busyRef.current && !options?.queue) {
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

      const queued = options?.queue === true;
      if (!queued) {
        queueRoundsRef.current = buildBurnRounds(assets);
        queueIndexRef.current = 0;
        queueReportsRef.current = [];
        queueModeRef.current = false;
        queueActiveRef.current = false;
        queueInternalCallRef.current = false;
        lookupTablesRef.current = [];
        autoReclaimStartedRef.current = false;
      }

      // A queue round plans only itself. The next round's proofs do not exist
      // until the previous burn has landed, so planning it here would produce
      // exactly the stale proof the queue exists to avoid.
      const targetAssets = queued
        ? assets
        : (queueRoundsRef.current[0] ?? assets);
      const queue =
        queueRoundsRef.current.length > 1
          ? {
              round: queued ? queueIndexRef.current + 1 : 1,
              rounds: queueRoundsRef.current.length,
              total: queueRoundsRef.current.reduce(
                (sum, round) => sum + round.length,
                0,
              ),
            }
          : null;

      busyRef.current = true;
      preparedRef.current = null;
      assetsRef.current = targetAssets;
      patch({
        phase: "planning",
        error: null,
        warnings: [],
        skipped: [],
        queue,
        ...(queued ? {} : { lookupTableCleanup: null, queueActive: false }),
      });

      try {
        const result = await planNftBurn({
          connection,
          owner: publicKey,
          assets: targetAssets,
        });

        preparedRef.current = result;
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
          rounds: queueRoundsRef.current.length,
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
   * Sign the batch, then submit and attribute the results.
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
    if (queueActiveRef.current && !queueInternalCallRef.current) return [];
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

    /**
     * Run each queued round, re-planning after the previous one confirms.
     *
     * The first round is already prepared by `prepare`; later rounds fetch
     * fresh proofs because the prior burn changed their tree's root. The queue
     * keeps the table cleanup from every round and shows one final result.
     */
    const runQueue = async (): Promise<string[]> => {
      const rounds = queueRoundsRef.current;
      queueModeRef.current = true;
      queueActiveRef.current = true;
      queueReportsRef.current = [];
      patch({ queueActive: true });
      const burnedIds: string[] = [];

      try {
        for (let index = 0; index < rounds.length; index += 1) {
          queueIndexRef.current = index;
          if (index > 0) {
            const round = rounds[index];
            if (!round || round.length === 0) continue;
            await prepare(round, { queue: true });
            if (!preparedRef.current) break;
          }

          const before = queueReportsRef.current.length;
          queueInternalCallRef.current = true;
          try {
            burnedIds.push(...(await execute()));
          } finally {
            queueInternalCallRef.current = false;
          }
          if (queueReportsRef.current.length === before) break;
          patch({
            queue: {
              round: Math.min(index + 2, rounds.length),
              rounds: rounds.length,
              total: rounds.reduce((sum, round) => sum + round.length, 0),
            },
          });
        }
      } finally {
        queueModeRef.current = false;
        queueActiveRef.current = false;
        queueInternalCallRef.current = false;
        busyRef.current = false;
      }

      const reports = queueReportsRef.current;
      if (reports.length === 0) {
        patch({ queue: null, queueActive: false });
        return burnedIds;
      }
      // A later round failed to build or confirm. Keep the visible error rather
      // than painting a success screen over unburned assets; the completed
      // rounds are still returned so their rows can be hidden.
      if (reports.length !== rounds.length) {
        patch({ queue: null, queueActive: false });
        return burnedIds;
      }

      const outcomes = reports.flatMap((report) => report.outcomes);
      const summary: NftBurnSummary = {
        requestedCount: reports.reduce(
          (sum, report) => sum + report.summary.requestedCount,
          0,
        ),
        burnedCount: reports.reduce(
          (sum, report) => sum + report.summary.burnedCount,
          0,
        ),
        failedCount: reports.reduce(
          (sum, report) => sum + report.summary.failedCount,
          0,
        ),
        closedCount: reports.reduce(
          (sum, report) => sum + report.summary.closedCount,
          0,
        ),
        rentReclaimedLamports: reports.reduce(
          (sum, report) => sum + report.summary.rentReclaimedLamports,
          0,
        ),
        feeLamports: reports.reduce(
          (sum, report) => sum + report.summary.feeLamports,
          0,
        ),
        signatures: reports.flatMap((report) => report.summary.signatures),
        lookupTableRentLamports: reports.reduce(
          (sum, report) => sum + report.summary.lookupTableRentLamports,
          0,
        ),
        skipped: reports.flatMap((report) => report.summary.skipped),
      };
      const warnings = reports.flatMap((report) => report.warnings);

      playFlowSound("success", summary.failedCount);
      patch({
        phase: "success",
        outcomes,
        summary,
        warnings,
        skipped: summary.skipped,
        lookupTableAssets: [],
        progress: {
          completed: summary.requestedCount,
          total: summary.requestedCount,
        },
        queue: null,
        queueActive: false,
      });
      preparedRef.current = null;
      return burnedIds;
    };

    if (!queueModeRef.current && queueRoundsRef.current.length > 1) {
      return runQueue();
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
          {
            signTransaction,
            signAllTransactions,
            walletName: wallet?.adapter.name,
          },
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
          // Creates are emitted first, one per table. Register each as soon as
          // its create lands, so a later extension failure still leaves a
          // reclaimable address rather than an orphaned table.
          if (index < setup.tables.length) {
            const created = setup.tables[index];
            if (created) {
              lookupTablesRef.current = [
                ...lookupTablesRef.current,
                created,
              ];
              rememberPendingLookupTableCleanup(publicKey.toBase58(), [
                { address: created.address, rentLamports: 0 },
              ]);
            }
          }
          patch({
            phase: "confirming",
            progress: {
              completed: index + 1,
              total: signedSetup.length,
            },
          });
        }

        // Register the table the moment its setup transactions land. The
        // usability wait below can fail, and the table would still exist — so
        // the rent must be reclaimable on that error path too. The create loop
        // above has already appended each table; do not replace the list here,
        // because a queued burn can have tables from earlier rounds.
        let balances = new Map<string, number>();
        try {
          balances = await readCnftLookupTableBalances(connection, setup.tables);
        } catch {
          // A failed read must not fail the burn. Cleanup re-reads the balance
          // before closing, so a zero here is only a display estimate.
          balances = new Map();
        }
        lookupTableRentLamports = [...balances.values()].reduce(
          (sum, rent) => sum + rent,
          0,
        );
        rememberPendingLookupTableCleanup(
          publicKey.toBase58(),
          setup.tables.map((table) => ({
            address: table.address,
            rentLamports: balances.get(table.address) ?? 0,
          })),
        );
        const cleanup: LookupTableCleanupState = {
          status: "available",
          tables: setup.tables.map((table) => table.address),
          rentLamports: lookupTableRentLamports,
          reclaimedLamports: 0,
          feeLamports: 0,
          signatures: [],
          error: null,
          progress: null,
        };
        if (queueModeRef.current) {
          setState((previous) => ({
            ...previous,
            lookupTableCleanup: mergeLookupTableCleanup(
              previous.lookupTableCleanup,
              cleanup,
            ),
          }));
        } else {
          patch({ lookupTableCleanup: cleanup });
        }

        const lookupTables = await waitForLookupTables(
          connection,
          setup.tables,
        );

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

      const signer = {
        signTransaction,
        signAllTransactions,
        walletName: wallet?.adapter.name,
      };

      // A wallet that prompts once per transaction spends the blockhash window
      // on the prompts: four approvals is a minute of wall clock. This used to
      // sign the whole batch first and send afterwards, so four cNFT burns were
      // all sent on an expired window and all four failed. Those wallets now
      // sign one, send it, and refresh before the next approval; a batch wallet
      // still gets a single approval for the lot.
      let submits: SubmitResult[];
      if (walletSignsSequentially(signer)) {
        const sequential = await signAndSubmitSequentially({
          batch: result,
          refresh: () => refreshNftBurnBlockhash(connection, result),
          nearExpiry: (batch) =>
            isBlockhashExpired(
              connection,
              batch.lastValidBlockHeight,
              BLOCKHASH_PROMPT_MARGIN_SLOTS,
            ),
          signOne: async (meta) => {
            const [signedTransaction] = await signTransactions(signer, [meta]);
            if (!signedTransaction) {
              throw new Error("The wallet returned no signed transaction.");
            }
            return signedTransaction;
          },
          submitOne: (signedTransaction, meta, window) =>
            submitTransactions(
              connection,
              [signedTransaction],
              [meta],
              {
                blockhash: window.blockhash,
                lastValidBlockHeight: window.lastValidBlockHeight,
              },
            ),
          onProgress: (completed, total) =>
            patch({ phase: "submitting", progress: { completed, total } }),
        });
        submits = sequential.submits;
      } else {
        const signed = await signTransactions(signer, result.packed);

        patch({
          phase: "submitting",
          progress: { completed: 0, total: signed.length },
        });

        submits = await submitTransactions(
          connection,
          signed,
          result.packed,
          {
            blockhash: result.blockhash,
            lastValidBlockHeight: result.lastValidBlockHeight,
          },
          (completed, total) => patch({ progress: { completed, total } }),
        );
      }

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

      const burnedIds = outcomes
        .filter((outcome) => outcome.status === "burned")
        .map((outcome) => outcome.id);

      if (queueModeRef.current) {
        queueReportsRef.current.push({
          outcomes,
          summary,
          warnings: result.warnings,
        });
        preparedRef.current = null;
        return burnedIds;
      }

      playFlowSound(
        "success",
        outcomes.filter((outcome) => outcome.status !== "burned").length,
      );
      patch({
        phase: "success",
        outcomes,
        summary,
        progress: { completed: result.packed.length, total: result.packed.length },
      });
      // Nothing here is signable twice: a burned asset has no account left.
      preparedRef.current = null;
      // Only the ones that landed. A failed burn leaves a live asset, and
      // hiding that would hide something the user still owns.
      return burnedIds;
    } catch (caught) {
      playFlowSound("error");
      const friendly = toFriendlyError(caught);
      const strayTables = lookupTablesRef.current;

      // A table created just before the failure still exists. Surface it as a
      // reclaim instead of letting the error bury the only handle to its rent.
      let strayRent = 0;
      if (strayTables.length > 0) {
        try {
          const balances = await readCnftLookupTableBalances(
            connection,
            strayTables,
          );
          strayRent = [...balances.values()].reduce(
            (sum, rent) => sum + rent,
            0,
          );
          rememberPendingLookupTableCleanup(
            publicKey.toBase58(),
            strayTables.map((table) => ({
              address: table.address,
              rentLamports: balances.get(table.address) ?? 0,
            })),
          );
        } catch {
          // Zero is only a display estimate; the reclaim reads the chain again.
        }
      }

      setState((previous) => ({
        ...previous,
        phase: "error",
        error: friendly,
        lookupTableCleanup:
          previous.lookupTableCleanup ??
          (strayTables.length > 0
            ? {
                status: "available",
                tables: strayTables.map((table) => table.address),
                rentLamports: strayRent,
                reclaimedLamports: 0,
                feeLamports: 0,
                signatures: [],
                error: null,
                progress: null,
              }
            : null),
      }));
      return [];
    } finally {
      busyRef.current = false;
    }
  }, [
    connection,
    patch,
    prepare,
    publicKey,
    signAllTransactions,
    signTransaction,
    wallet,
  ]);

  /**
   * Deactivate, wait out the 512-slot cooldown, and close every table this run
   * created, returning its rent to the wallet.
   *
   * This is opt-in rather than automatic for one reason: the wallet is the
   * table's authority, so the close needs a signature. Running it silently after
   * a burn would surprise the user with a second approval minutes later. The
   * result screen keeps it one button away, and reads the chain first so a
   * retry after a partial attempt does not try to deactivate a table twice.
   */
  const reclaimLookupTableRent = useCallback(async (): Promise<void> => {
    const tables = lookupTablesRef.current;
    const current = state.lookupTableCleanup;
    if (tables.length === 0 || current === null || reclaimBusyRef.current) return;
    if (current.status !== "available" && current.status !== "failed") return;

    if (!publicKey) {
      patch({
        lookupTableCleanup: {
          ...current,
          status: "failed",
          error: {
            title: "Wallet not connected",
            message: "Connect your wallet to reclaim the table rent.",
          },
        },
      });
      return;
    }
    if (!signTransaction && !signAllTransactions) {
      patch({
        lookupTableCleanup: {
          ...current,
          status: "failed",
          error: {
            title: "Wallet cannot sign",
            message: "This wallet does not support signing transactions.",
            hint: "Try a different wallet, such as Phantom or Solflare.",
          },
        },
      });
      return;
    }

    reclaimBusyRef.current = true;
    let cleanup: LookupTableCleanupState = {
      ...current,
      status: "deactivating",
      error: null,
      progress: null,
    };
    patch({ phase: "awaiting-signature", lookupTableCleanup: cleanup });

    try {
      const states = await fetchCnftLookupTableStates(connection, tables);
      const open = states.filter(
        (entry): entry is OpenLookupTableState => entry.account !== null,
      );

      // Every table is already gone. This happens if a previous attempt closed
      // them and the user pressed retry, or if someone closed them elsewhere.
      if (open.length === 0) {
        forgetPendingLookupTableCleanup(
          publicKey.toBase58(),
          tables.map((table) => table.address),
        );
        cleanup = { ...cleanup, status: "reclaimed", progress: null };
        patch({
          phase: state.summary !== null ? "success" : "error",
          lookupTableCleanup: cleanup,
        });
        return;
      }

      // ── Deactivate ────────────────────────────────────────────────────────
      const active = open.filter((entry) => entry.account.isActive());
      if (active.length > 0) {
        const batch = await buildCnftLookupTableDeactivation({
          connection,
          authority: publicKey,
          tables: active.map((entry) => entry.table),
        });
        const signed = await signTransactions(
          {
            signTransaction,
            signAllTransactions,
            walletName: wallet?.adapter.name,
          },
          batch.packed,
        );
        patch({ phase: "submitting", lookupTableCleanup: cleanup });

        const submits = await submitTransactions(
          connection,
          signed,
          batch.packed,
          {
            blockhash: batch.blockhash,
            lastValidBlockHeight: batch.lastValidBlockHeight,
          },
        );
        const failure = submits.find((submit) => !submit.ok);
        if (failure) {
          throw new Error(failure.error ?? "The table deactivation did not land.");
        }

        const signatures = submits
          .filter((submit) => submit.ok && submit.signature)
          .map((submit) => submit.signature as string);
        cleanup = {
          ...cleanup,
          feeLamports:
            cleanup.feeLamports + signatures.length * BASE_FEE_LAMPORTS,
          signatures: [...cleanup.signatures, ...signatures],
        };
        patch({ phase: "confirming", lookupTableCleanup: cleanup });
      }

      // ── Cooldown ──────────────────────────────────────────────────────────
      cleanup = { ...cleanup, status: "waiting" };
      patch({ phase: "confirming", lookupTableCleanup: cleanup });

      await waitForLookupTablesClosable(connection, tables, {
        onProgress: ({ slotsRemaining, deactivationSlot }) => {
          cleanup = {
            ...cleanup,
            progress: { slotsRemaining, deactivationSlot },
          };
          patch({ lookupTableCleanup: cleanup });
        },
      });

      // ── Close ─────────────────────────────────────────────────────────────
      // Re-read after the wait: a table can disappear between the cooldown and
      // this point, and closing an account that no longer exists would fail the
      // whole batch for no reason.
      const afterWait = await fetchCnftLookupTableStates(connection, tables);
      const live = afterWait.filter(
        (entry): entry is OpenLookupTableState => entry.account !== null,
      );
      if (live.length === 0) {
        forgetPendingLookupTableCleanup(
          publicKey.toBase58(),
          tables.map((table) => table.address),
        );
        cleanup = { ...cleanup, status: "reclaimed", progress: null };
        patch({
          phase: state.summary !== null ? "success" : "error",
          lookupTableCleanup: cleanup,
        });
        return;
      }

      const liveTables = live.map((entry) => entry.table);
      // A balance read failure must not block a close that would return the
      // rent. Fall back to the figure recorded at setup for display.
      let balances = new Map<string, number>();
      try {
        balances = await readCnftLookupTableBalances(connection, liveTables);
      } catch {
        balances = new Map();
      }
      const batch = await buildCnftLookupTableClose({
        connection,
        authority: publicKey,
        recipient: publicKey,
        tables: liveTables,
      });

      cleanup = { ...cleanup, status: "closing", progress: null };
      patch({ phase: "awaiting-signature", lookupTableCleanup: cleanup });

      const signed = await signTransactions(
        {
          signTransaction,
          signAllTransactions,
          walletName: wallet?.adapter.name,
        },
        batch.packed,
      );
      patch({ phase: "submitting", lookupTableCleanup: cleanup });

      const submits = await submitTransactions(
        connection,
        signed,
        batch.packed,
        {
          blockhash: batch.blockhash,
          lastValidBlockHeight: batch.lastValidBlockHeight,
        },
      );

      let reclaimedLamports = cleanup.reclaimedLamports;
      const signatures: string[] = [];
      const closedTables: string[] = [];
      let closeFeeLamports = 0;
      let failure: string | null = null;

      // The builder emits one transaction per table, in `liveTables` order, so
      // a successful close can be attributed to the balance it returned.
      submits.forEach((submit, index) => {
        const table = liveTables[index];
        if (submit.signature) {
          signatures.push(submit.signature);
          closeFeeLamports += BASE_FEE_LAMPORTS;
        }
        if (submit.ok) {
          if (table) {
            reclaimedLamports +=
              balances.get(table.address) ??
              (liveTables.length === 1 ? cleanup.rentLamports : 0);
            closedTables.push(table.address);
          }
        } else if (failure === null) {
          failure = submit.error ?? "A lookup-table close did not land.";
        }
      });

      // Only remove what actually closed. A partial close must leave the rest
      // in storage so the retry can find it.
      forgetPendingLookupTableCleanup(publicKey.toBase58(), closedTables);

      cleanup = {
        ...cleanup,
        status: failure === null ? "reclaimed" : "failed",
        reclaimedLamports,
        feeLamports: cleanup.feeLamports + closeFeeLamports,
        signatures: [...cleanup.signatures, ...signatures],
        error:
          failure === null
            ? null
            : {
                title: "Some lookup-table rent was not returned",
                message: failure,
                hint: "The table is deactivated and its rent is still recoverable. Try the reclaim again.",
              },
      };

      patch({
        phase: state.summary !== null ? "success" : "error",
        lookupTableCleanup: cleanup,
      });
    } catch (caught) {
      cleanup = {
        ...cleanup,
        status: "failed",
        error: cleanupFailure(caught),
        progress: null,
      };
      patch({
        phase: state.summary !== null ? "success" : "error",
        lookupTableCleanup: cleanup,
      });
    } finally {
      reclaimBusyRef.current = false;
    }
  }, [
    connection,
    patch,
    publicKey,
    signAllTransactions,
    signTransaction,
    wallet,
    state.lookupTableCleanup,
    state.summary,
  ]);

  /**
   * Start the cleanup automatically once the burn has finished.
   *
   * Only `available` starts it. A failed attempt must not retry in a loop: the
   * error is shown with a button, and the user decides whether to try again. A
   * restored table from a previous session is also left alone until it has a
   * result on screen, so opening the page does not immediately ask for a
   * signature.
   */
  useEffect(() => {
    if (!autoReclaimLookupTableRent) {
      autoReclaimStartedRef.current = false;
      return;
    }
    if (autoReclaimStartedRef.current) return;
    const finished =
      (state.phase === "success" && state.summary !== null) ||
      (state.phase === "error" && state.summary === null);
    if (!finished || state.lookupTableCleanup?.status !== "available") return;

    autoReclaimStartedRef.current = true;
    void reclaimLookupTableRent();
  }, [
    autoReclaimLookupTableRent,
    reclaimLookupTableRent,
    state.lookupTableCleanup?.status,
    state.phase,
    state.summary,
  ]);

  const isBusy = isBusyPhase(state.phase) || state.queueActive;

  return {
    ...state,
    prepare,
    execute,
    reclaimLookupTableRent,
    reset,
    isBusy,
    autoReclaimLookupTableRent,
    setAutoReclaimLookupTableRent,
  };
}
