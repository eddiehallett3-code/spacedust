"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, ExternalLink, Eye, EyeOff, Flame, Info } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { NftArtwork } from "@/components/void/nft-artwork";
import { SimulationReport } from "@/components/sweep/simulation-report";
import { WarningsList } from "@/components/sweep/warnings-list";
import { SweepError } from "@/components/sweep/controls-column";
import { assetKind, nftBurnability } from "@/lib/sweep/plan-nft-burn";
import { burnResultCopy, countBurned } from "@/lib/sweep/burn-result-copy";
import { labelNonFungibles } from "@/lib/sweep/asset-labels";
import { previewAction } from "@/lib/sweep/preview";
import { solscanTxUrl } from "@/lib/solana/submit";
import { LOOKUP_TABLE_DEACTIVATION_SLOTS } from "@/lib/solana/cnft-lookup-table";
import { cnftFitsInline } from "@/lib/solana/cnft-size";
import { formatSol, pluralize, truncateAddress } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { TOAST_BRIEF_MS, TOAST_READ_MS } from "@/lib/utils/constants";
import type {
  LookupTableCleanupState,
  NftBurnOutcome,
  NftBurnSummary,
  useNftBurn,
} from "@/hooks/use-nft-burn";
import type { NonFungibleAsset } from "@/types/token";

type BurnApi = ReturnType<typeof useNftBurn>;

/**
 * The NFT burn panel.
 *
 * Two rules shape everything here:
 *
 *  1. **Nothing is ever pre-selected.** An NFT is not dust, and a missing price
 *     is not evidence of a worthless asset — a floor we could not find is not a
 *     green light. Burning starts from zero and every tick is deliberate, unlike
 *     a token, where an unpriced mint is a safe default.
 *  2. **Assets we will not burn are still listed, with the reason.** Hiding them
 *     leaves the user wondering where an item went. Greyed out with "needs a
 *     Metaplex instruction this build does not send yet" is the honest version.
 */
export function NftBurnPanel({
  assets,
  theBurn,
  onBurnt,
  kind = "nft",
  tableSetup = false,
  hidden,
  hiddenAssets,
  onSetHidden,
  selected,
  onSelectionChange,
  selectedAssets,
}: {
  assets: NonFungibleAsset[];
  theBurn: BurnApi;
  /**
   * Told which ids burned, not just that something did. The grid keeps its own
   * record so a destroyed asset cannot reappear in a later rescan — the index
   * still reports it, and for a cNFT there is no account left to contradict it.
   */
  onBurnt?: (burnedIds: string[]) => void;
  /** Ids the grid is hiding: burned while we watched, or put away by hand. */
  hidden?: ReadonlySet<string>;
  /** Those assets themselves, so a hide can be undone without a rescan. */
  hiddenAssets?: NonFungibleAsset[];
  onSetHidden?: (id: string, hidden: boolean) => void;
  /**
   * The selection, held by the parent rather than by this panel.
   *
   * It has to be: the panel only sees one tab's assets, and the pipeline below
   * does not. With a selection per panel, ticking an NFT on one tab and a cNFT on
   * another and pressing Burn burned *one* of them — the button said "Burn 1
   * NFT" because that was all its own list could see — and the shared result
   * screen then appeared on every tab, so it read as though all had gone. One
   * selection, one batch, one transaction, whichever tabs they came from.
   */
  selected: ReadonlySet<string>;
  /**
   * Those assets, gathered by the parent from *both* tabs.
   *
   * Not derived here from `assets`: this panel can only see its own tab, and the
   * batch that gets burned is the one the parent assembles.
   */
  selectedAssets: NonFungibleAsset[];
  onSelectionChange: (next: Set<string>) => void;
  /**
   * Which tab this is. Only the copy changes — burning a cNFT is just as
   * deliberate — but a cNFT returns no rent, and this is the one place the user
   * comes looking for reassurance. Promising rent back there would be a lie.
   */
  kind?: "nft" | "cnft";
  /**
   * This tab holds only cNFTs whose proof needs an address lookup table.
   *
   * The parent has already filtered the list; this prop changes the copy and
   * the empty state, not the contents. That keeps the one asset grid and the
   * one burn route while letting the setup cost be explained before selection.
   */
  tableSetup?: boolean;
}) {
  const isCnft = kind === "cnft";
  const isTableSetup = isCnft && tableSetup;
  const noun = isCnft ? "cNFT" : "NFT";
  // The selection lives in the parent — see the props above. Three panels, four
  // tabs, one batch.

  /**
   * Hiding is reversible, and this is where the way back lives.
   *
   * A hidden row is out of the way but never out of reach: the grid shows only
   * what the user asked to see, and one control below it brings the rest back.
   * Assets of the other kind are filtered out, so the count belongs to the tab
   * the user is actually looking at.
   */
  const [showHidden, setShowHidden] = useState(false);
  const hiddenRows = useMemo(
    () => (hiddenAssets ?? []).filter((asset) => asset.compressed === isCnft),
    [hiddenAssets, isCnft],
  );
  // Memoised because the label pass below depends on it: a fresh array on every
  // render would recompute every name in the grid on every render.
  const rows = useMemo(
    () => (showHidden ? [...assets, ...hiddenRows] : assets),
    [showHidden, assets, hiddenRows],
  );

  /**
   * Split the cNFT tab by what a burn of each tree needs.
   *
   * The proof length is a property of the tree, cached on the scan (see
   * `proofNodes` on `CompressedLeaf`). The parent now uses that fact to put
   * over-limit proofs on their own tab before this panel ever sees them; this
   * panel only needs `rows` for whatever list it was handed.
   */
  const verdicts = useMemo(
    () => new Map(assets.map((asset) => [asset.id, nftBurnability(asset)])),
    [assets],
  );

  const burnable = useMemo(
    () => assets.filter((asset) => verdicts.get(asset.id)?.burnable === true),
    [assets, verdicts],
  );

  /**
   * What the batch contains, by kind — which is what the button has to say.
   *
   * A selection can span more than one tab now, so "Burn 1 NFT" while two assets
   * are ticked is the exact lie this replaces.
   */
  const nftsSelected = selectedAssets.filter((asset) => !asset.compressed).length;
  const cnftsSelected = selectedAssets.filter((asset) => asset.compressed).length;
  const burnSubject =
    nftsSelected > 0 && cnftsSelected > 0
      ? `${pluralize(selectedAssets.length, "asset")} — ${pluralize(nftsSelected, "NFT")} + ${pluralize(cnftsSelected, "cNFT")}`
      : pluralize(selectedAssets.length, noun);

  /**
   * Whether the selection contains an MPL Core asset.
   *
   * Core is the one class whose burn leaves something behind: the program
   * shrinks the asset's own account to a single zero byte instead of closing it,
   * so a residue of its rent stays locked there and nothing can close it
   * (verified against mainnet — see `probes/tmp-core-husk.mjs`). An SPL NFT burn closes
   * its token account and returns the rent, so this note would be wrong for one.
   */
  const hasCoreSelection = useMemo(
    () => selectedAssets.some((asset) => asset.interface === "MplCoreAsset"),
    [selectedAssets],
  );

  /**
   * Distinct reasons nothing here can be burned, worst-first.
   *
   * Rendered prominently when the answer is "none of them", because a tab full
   * of inert cards with no explanation is indistinguishable from a bug. The
   * per-card reason stays (it is what tells you about *that* asset); this says
   * what is going on across the whole tab.
   */
  const refusals = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of assets) {
      const verdict = verdicts.get(asset.id);
      if (verdict && !verdict.burnable) {
        counts.set(verdict.reason, (counts.get(verdict.reason) ?? 0) + 1);
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [assets, verdicts]);

  const {
    phase,
    packed,
    simulations,
    summary,
    error,
    warnings,
    skipped,
    lookupTableAssets,
    lookupTableCleanup,
    progress,
    isBusy,
    autoReclaimLookupTableRent,
    setAutoReclaimLookupTableRent,
  } = theBurn;

  // A preview is valid even when no burn transaction is built yet: cNFTs from
  // a canopy-0 tree wait for their lookup table until execution.
  const hasPreview = packed.length > 0 || lookupTableAssets.length > 0;
  /**
   * The selected cNFTs whose trees cannot fit a burn in one transaction.
   *
   * Read from the prescan rather than from `lookupTableAssets`, which only
   * exists after a preview. This is what lets the panel warn *before* the user
   * presses Preview: a table means an extra approval and network fees, and that
   * belongs next to the selection, not in a post-preview surprise.
   */
  const selectedNeedingLookupTable = useMemo(
    () =>
      selectedAssets.filter(
        (asset) => asset.compressed && cnftFitsInline(asset) === false,
      ),
    [selectedAssets],
  );
  /**
   * Extra cNFTs sharing a merkle tree with an earlier selection.
   *
   * A burn changes the root, so only the first leaf from a tree can be sent in a
   * batch. The selection handlers stop this at the point of clicking, but a
   * selection made before this rule existed can still arrive here; saying why
   * is better than letting the planner silently skip it.
   */
  const sameTreeExtraSelection = useMemo(() => {
    const seen = new Set<string>();
    const extras: NonFungibleAsset[] = [];
    for (const asset of selectedAssets) {
      if (!asset.compressed || !asset.merkle) continue;
      if (seen.has(asset.merkle.tree)) extras.push(asset);
      else seen.add(asset.merkle.tree);
    }
    return extras;
  }, [selectedAssets]);
  const okCount = simulations.filter((simulation) => simulation.ok).length;

  /**
   * One name per asset, unambiguous within everything this panel is showing.
   *
   * The grid, the refusal list and the post-burn report are all in front of the
   * user at once, so they are labelled as one set: a burned copy called
   * "Mask · #679684" has to be reported back under the same name it was ticked
   * under, or the report is as unreadable as the grid was.
   */
  const labels = useMemo(
    () =>
      labelNonFungibles([
        ...rows,
        ...skipped,
        ...theBurn.outcomes,
        ...(summary?.skipped ?? []),
      ]),
    [rows, skipped, theBurn.outcomes, summary],
  );

  const nameFor = useCallback(
    (id: string, fallback: string): string => labels.get(id)?.name ?? fallback,
    [labels],
  );

  const toggle = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      const asset = rows.find((entry) => entry.id === id);
      const tree = asset?.merkle?.tree ?? null;
      const conflict =
        tree === null
          ? undefined
          : selectedAssets.find(
              (entry) => entry.id !== id && entry.merkle?.tree === tree,
            );
      if (conflict) {
        toast.error("One cNFT per merkle tree", {
          duration: TOAST_READ_MS,
          description: `Burning ${conflict.name} changes the shared tree's root, so a second proof would be stale. Burn this one in a separate batch.`,
        });
        return;
      }
      next.add(id);
    }
    onSelectionChange(next);
  };

  const handlePreview = async (): Promise<void> => {
    const preview = await theBurn.prepare(selectedAssets);
    if (preview.transactions > 0 || preview.lookupTables > 0) {
      const parts: string[] = [];
      if (preview.transactions > 0) {
        parts.push(
          `${pluralize(preview.transactions, "transaction")} built and simulated`,
        );
      }
      if (preview.lookupTables > 0) {
        parts.push(
          `${pluralize(preview.lookupTables, "cNFT")} ${
            preview.lookupTables === 1 ? "needs" : "need"
          } a lookup table when you burn`,
        );
      }
      toast.success("Preview ready", {
        duration: TOAST_BRIEF_MS,
        description: `${parts.join("; ")}. Review before signing.`,
      });
    }
  };

  /**
   * A preview must never outlive the selection it was built from.
   *
   * `execute()` signs the batch that was *prepared*, not what is ticked now, so
   * without this an asset unticked after previewing would still be burned.
   */
  const selectionKey = useMemo(
    () => [...selected].sort().join(","),
    [selected],
  );
  const selectionKeyRef = useRef(selectionKey);
  useEffect(() => {
    const action = previewAction({
      previousKey: selectionKeyRef.current,
      currentKey: selectionKey,
      isBusy: theBurn.isBusy,
      hasSummary: theBurn.summary !== null,
      hasPreview: theBurn.packed.length > 0 || theBurn.lookupTableAssets.length > 0,
    });
    if (action === "none") return;
    selectionKeyRef.current = selectionKey;
    if (action === "discard") theBurn.reset();
  }, [selectionKey, theBurn]);

  const handleBurn = async (): Promise<void> => {
    const burnedIds = await theBurn.execute();
    if (burnedIds.length > 0) {
      // What actually landed, by class. A Core asset returns most of its rent but
      // leaves a husk behind, and saying "their rent is back" after burning one
      // would be the kind of claim that gets checked and found wanting.
      const burnedCore = burnedIds.some(
        (id) =>
          assets.find((asset) => asset.id === id)?.interface === "MplCoreAsset",
      );

      // Says exactly what burned, and only about that. A batch can be partly
      // refused or partly unconfirmed, and the old wording described the whole
      // selection as destroyed — a claim about an unknown, on the one screen
      // where the user is looking for reassurance. The panel below carries the
      // full accounting, including what did not burn.
      toast.success(`${pluralize(burnedIds.length, noun)} burned`, {
        // A paragraph, not a confirmation: 4 seconds would not be enough to read
        // why a cNFT returned no rent, or why the asset may still show up in the
        // wallet. See TOAST_READ_MS.
        duration: TOAST_READ_MS,
        description: isCnft
          ? "Nothing was returned — a compressed NFT is a leaf in a merkle tree, not an account holding rent."
          : burnedCore
            ? "Most of the rent is back. A Core asset is left as a one-byte husk, so a small residue stays locked in that account."
            : "Their rent is back in your wallet.",
      });
      // Never leave anything ticked for a second run. Burning is opt-in, and a
      // selection that survives a burn is an invitation to sign it again. This
      // clears the shared selection, so every tab is emptied by the run.
      onSelectionChange(new Set());
      onBurnt?.(burnedIds);
    }
  };

  const handleDone = (): void => {
    onSelectionChange(new Set());
    theBurn.reset();
  };

  if (summary !== null) {
    return (
      <BurnResult
        summary={summary}
        outcomes={theBurn.outcomes}
        cleanup={lookupTableCleanup}
        onReclaim={() => void theBurn.reclaimLookupTableRent()}
        isBusy={isBusy}
        autoReclaim={autoReclaimLookupTableRent}
        onAutoReclaimChange={setAutoReclaimLookupTableRent}
        onDone={handleDone}
        // Passed, not recomputed: the report has to use the same names the grid
        // showed when the user ticked these.
        nameFor={nameFor}
      />
    );
  }

  if (
    isTableSetup &&
    assets.length === 0 &&
    (hiddenAssets?.length ?? 0) === 0
  ) {
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-linear-to-br from-violet-core/20 to-cyan-core/15 ring-1 ring-inset ring-white/10">
          <CheckCircle2 className="size-6 text-violet-glow" aria-hidden />
        </span>
        <h2 className="mt-4 text-lg font-semibold tracking-tight">
          Nothing needs a lookup table
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          None of this wallet&apos;s cNFTs need one. Any cNFT whose proof fits
          inside a normal burn transaction is on the cNFTs tab.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-xs text-subtle">
          {pluralize(assets.length, noun)} ·{" "}
          {burnable.length === assets.length
            ? "all sendable"
            : `${burnable.length} sendable`}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Merged, not replaced: "select all" on one tab must not silently
              // drop what is ticked on the other. Only one cNFT per merkle tree
              // can be in a batch — the first burn changes the tree's root.
              const next = new Set(selected);
              const trees = new Set(
                selectedAssets.flatMap((asset) =>
                  asset.merkle ? [asset.merkle.tree] : [],
                ),
              );
              let deferred = 0;
              for (const asset of burnable) {
                const tree = asset.merkle?.tree ?? null;
                if (tree !== null) {
                  if (trees.has(tree)) {
                    deferred += 1;
                    continue;
                  }
                  trees.add(tree);
                }
                next.add(asset.id);
              }
              if (deferred > 0) {
                toast.info("One cNFT per merkle tree", {
                  duration: TOAST_READ_MS,
                  description: `Skipped ${pluralize(deferred, "cNFT")} in trees already selected. Burning one changes the shared root, so the others need a separate batch.`,
                });
              }
              onSelectionChange(next);
            }}
            disabled={burnable.length === 0 || isBusy}
          >
            Select all sendable
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Only this tab's assets, for the same reason in reverse.
              const next = new Set(selected);
              for (const asset of burnable) next.delete(asset.id);
              onSelectionChange(next);
            }}
            disabled={selected.size === 0 || isBusy}
          >
            Clear
          </Button>
        </div>
      </div>

      {/* The whole point of this tab: explain the extra step before a card is
          ticked. The per-card warning still appears if one of these is selected
          while this tab is not the one on screen. */}
      {isTableSetup ? (
        <div className="rounded-xl border border-violet-core/25 bg-violet-core/5 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
          <p className="font-medium text-foreground">
            Needs lookup-table setup
          </p>
          <p className="mt-1">
            Their trees carry more proof accounts than one transaction holds.
            Burning one creates an address lookup table first — an extra wallet
            approval and a few network fees. The table&apos;s rent can be
            reclaimed afterwards.
          </p>
          <AutoReclaimToggle
            checked={autoReclaimLookupTableRent}
            onChange={setAutoReclaimLookupTableRent}
            disabled={isBusy}
          />
        </div>
      ) : null}

      {/* If nothing can be burned, say why — loudly. A grid of cards that do not
          respond to a click reads as a broken page unless it explains itself. */}
      {assets.length > 0 && burnable.length === 0 ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/8 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              Nothing on this tab can be sent into The Void in this build
            </p>
            <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-muted">
              {refusals.map(([reason, count]) => (
                <li key={reason}>
                  {count} × {reason}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              They are listed so you can see what you hold. Nothing is selected,
              swept or destroyed.
            </p>
          </div>
        </div>
      ) : null}

      {/* Selecting a cNFT whose tree needs a lookup table adds a setup step
          before the burn. Say so here, while the selection is being made, not
          only after Preview has already built it. Hidden once a preview exists,
          because `lookupTableAssets` then carries the authoritative list and the
          panel below explains the same thing with the real count. */}
      {isCnft && !isTableSetup && !hasPreview && selectedNeedingLookupTable.length > 0 ? (
        <div className="rounded-xl border border-violet-core/25 bg-violet-core/5 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
          <p className="font-medium text-foreground">
            {pluralize(selectedNeedingLookupTable.length, "selected cNFT")}{" "}
            {selectedNeedingLookupTable.length === 1 ? "needs" : "need"} an
            address lookup table.
          </p>
          <p className="mt-1">
            {selectedNeedingLookupTable.length === 1
              ? "Its tree's merkle proof is longer than one transaction can hold."
              : "Their trees' merkle proofs are longer than one transaction can hold."}{" "}
            When you burn, Spacedust creates the table first — an extra wallet
            approval and a few network fees — waits for it to become usable, then
            simulates and asks you to sign the burn. Its rent is recoverable
            afterwards: deactivate it, wait out the program&apos;s 512-slot
            cooldown (about four minutes), then approve closing it.
          </p>
          <AutoReclaimToggle
            checked={autoReclaimLookupTableRent}
            onChange={setAutoReclaimLookupTableRent}
            disabled={isBusy}
          />
        </div>
      ) : null}

      {isCnft && sameTreeExtraSelection.length > 0 ? (
        <div className="rounded-xl border border-warning/30 bg-warning/8 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
          <p className="font-medium text-foreground">
            One cNFT per merkle tree
          </p>
          <p className="mt-1">
            {pluralize(sameTreeExtraSelection.length, "selected cNFT")} share a
            tree with another selected cNFT. Burning one changes the tree&apos;s
            root, so the others would have stale proofs and cannot be sent in the
            same batch. Only the first from each tree will be sent — burn the rest
            separately.
          </p>
        </div>
      ) : null}

      <ul
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        role="list"
      >
        {rows.map((asset) => {
          const verdict = verdicts.get(asset.id);
          const isHidden = hidden?.has(asset.id) === true;
          // A hidden row is not offered for burning: its verdict comes from the
          // visible list, and un-hiding it is the way to act on it again.
          const canBurn = !isHidden && verdict?.burnable === true;
          const isSelected = selected.has(asset.id);
          const needsLookupTable = isCnft && cnftFitsInline(asset) === false;
          return (
            <li key={asset.id}>
              <div
                role={canBurn ? "checkbox" : undefined}
                aria-checked={canBurn ? isSelected : undefined}
                tabIndex={canBurn ? 0 : undefined}
                onClick={canBurn ? () => toggle(asset.id) : undefined}
                onKeyDown={
                  canBurn
                    ? (event) => {
                        if (event.key === " " || event.key === "Enter") {
                          event.preventDefault();
                          toggle(asset.id);
                        }
                      }
                    : undefined
                }
                className={cn(
                  "flex flex-col gap-2 rounded-2xl border p-2 transition-colors",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet-glow",
                  canBurn
                    ? isSelected
                      ? "cursor-pointer border-danger/45 bg-danger/8"
                      : "cursor-pointer border-border/60 bg-white/2 hover:border-violet-core/40"
                    : "border-border/40 bg-white/1",
                  // A hidden row stays visible only because it was asked for, so
                  // it is dimmed to say so rather than passing as a normal one.
                  isHidden && "opacity-45",
                )}
              >
                <div className="relative">
                  <NftArtwork src={asset.imageUri} />
                  {canBurn ? (
                    <span className="absolute left-2 top-2">
                      {/* Decorative: the card owns the state and the click. */}
                      <Checkbox
                        checked={isSelected}
                        tabIndex={-1}
                        aria-hidden
                        className="pointer-events-none"
                      />
                    </span>
                  ) : null}
                  {onSetHidden ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        // The card is the checkbox. Hiding is not selecting, and
                        // must not tick the asset on the way out.
                        event.stopPropagation();
                        onSetHidden(asset.id, !isHidden);
                      }}
                      aria-label={
                        isHidden
                          ? `Show ${nameFor(asset.id, asset.name)} again`
                          : `Hide ${nameFor(asset.id, asset.name)}`
                      }
                      title={isHidden ? "Show this row again" : "Hide this row"}
                      className={cn(
                        "absolute right-1.5 top-1.5 rounded-full border border-border/60 bg-background/85 p-1 text-subtle backdrop-blur transition-colors",
                        "hover:border-violet-core/50 hover:text-foreground",
                        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet-glow",
                      )}
                    >
                      {isHidden ? (
                        <Eye className="size-3.5" aria-hidden />
                      ) : (
                        <EyeOff className="size-3.5" aria-hidden />
                      )}
                    </button>
                  ) : null}
                </div>

                <div className="flex min-w-0 flex-col gap-1 px-0.5 pb-0.5">
                  <p
                    className="truncate text-xs font-medium"
                    title={nameFor(asset.id, asset.name)}
                  >
                    {nameFor(asset.id, asset.name)}
                  </p>
                  {/* The mint, its kind, and one click to copy. This is the
                      handle for looking an asset up — on a block explorer, or in
                      a bug report — and the kind matters because the burn route
                      (and so the failure modes) differ per asset class. */}
                  <CopyMint mint={asset.id} kind={assetKind(asset)} />
                  {asset.collection ? (
                    <p
                      className="truncate text-[11px] text-subtle"
                      title={asset.collection.address}
                    >
                      {asset.collection.name ??
                        truncateAddress(asset.collection.address, 4, 4)}
                    </p>
                  ) : (
                    <p className="truncate text-[11px] text-subtle">No collection</p>
                  )}

                  {canBurn ? (
                    <div className="flex items-center gap-1 pt-0.5">
                      <Badge variant="muted" size="sm">
                        {isCnft ? "no rent" : "rent back"}
                      </Badge>
                      {needsLookupTable ? (
                        <Badge variant="accent" size="sm">
                          lookup table
                        </Badge>
                      ) : null}
                    </div>
                  ) : (
                    <p className="pt-0.5 text-[10px] leading-snug text-warning">
                      {verdict?.reason}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/*
        The way back from a hide, and it belongs to this tab only. Hiding is the
        user's call — what it hides may well still be alive — so undo is part of
        the feature rather than a hidden escape hatch.
      */}
      {hiddenRows.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowHidden((previous) => !previous)}
          className="self-start rounded-full border border-border/60 px-2.5 py-1 text-[11px] text-subtle transition-colors hover:border-violet-core/40 hover:text-foreground"
        >
          {showHidden
            ? `Hide ${pluralize(hiddenRows.length, "row")} again`
            : `${pluralize(hiddenRows.length, "row")} hidden — show`}
        </button>
      ) : null}

      <SweepError error={error} />

      {/* A burn can fail after its lookup table was created. The table outlives
          the failed attempt, so its rent must stay reclaimable on this screen
          rather than disappearing with the error. */}
      {summary === null && lookupTableCleanup ? (
        <LookupTableCleanupPanel
          cleanup={lookupTableCleanup}
          isBusy={isBusy}
          onReclaim={() => void theBurn.reclaimLookupTableRent()}
          autoReclaim={autoReclaimLookupTableRent}
          onAutoReclaimChange={setAutoReclaimLookupTableRent}
        />
      ) : null}

      {skipped.length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-warning/25 bg-warning/6 px-3 py-2 text-[11px] text-muted">
          {skipped.map((entry) => (
            <li key={entry.id} className="flex gap-1.5">
              <span aria-hidden>•</span>
              <span className="min-w-0 break-words">
                <strong className="font-medium text-foreground">
                  {nameFor(entry.id, entry.name)}
                </strong>
                {` — ${entry.reason}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {hasPreview ? (
        <div className="flex flex-col gap-3">
          {packed.length > 0 ? (
            <SimulationReport
              packed={packed}
              simulations={simulations}
              okCount={okCount}
              unitLabel={`${noun} send`}
            />
          ) : null}
          {lookupTableAssets.length > 0 ? (
            <div className="rounded-xl border border-violet-core/25 bg-violet-core/5 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
              <p className="font-medium text-foreground">
                {pluralize(lookupTableAssets.length, "cNFT")}{" "}
                {lookupTableAssets.length === 1 ? "needs" : "need"} an address
                lookup table.
              </p>
              <p className="mt-1">
                {lookupTableAssets.length === 1
                  ? "Its merkle proof is too long to send inline."
                  : "Their merkle proofs are too long to send inline."}{" "}
                When you burn, Spacedust creates a lookup table first — that is
                an extra approval step and a few network fees — waits for it to
                become usable, then simulates and asks you to sign the burn. Its
                rent is recoverable: after the burn, a Reclaim action deactivates
                the table, waits out the program&apos;s 512-slot cooldown (about
                four minutes), then asks you to approve closing it and returns
                the rent.
              </p>
            </div>
          ) : null}
          <WarningsList warnings={warnings} unitLabel="asset" />
        </div>
      ) : null}

      <p className="flex items-start gap-1.5 rounded-lg border border-danger/25 bg-danger/8 px-2.5 py-2 text-[11px] leading-relaxed text-danger">
        <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">
            Sending into The Void is irreversible.
          </strong>{" "}
          A {noun} sent here cannot be recovered. Nothing is selected for you —
          check every item before signing.
        </span>
      </p>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-subtle">
        <Info className="mt-px size-3 shrink-0" aria-hidden />
        <span>
          {isCnft ? (
            <>
              Sending a cNFT into The Void destroys a leaf in its merkle tree.
              Nothing is returned for it: a leaf is not an account, so there is no
              rent locked in it. Only one cNFT per merkle tree can be sent in a
              batch — the first burn changes the tree&apos;s root, so every other
              proof would be stale. Different trees can go together. The proof is
              checked against the tree root as it stands when you sign, so in a
              busy tree the preview may need running again. No Spacedust fee is
              charged.
            </>
          ) : hasCoreSelection ? (
            <>
              Sending returns most of the rent, but a Core asset is not closed:
              the program leaves its account as a single zero byte, so a residue —
              about 0.0007 SOL — stays locked in it, and Core exposes no
              instruction that would close it. Because the account survives, the
              asset stays attributed to your wallet, and a wallet that still sees
              it in the index may keep listing it after it is gone from here. No
              Spacedust fee is charged.
            </>
          ) : (
            <>
              Sending goes through Token Metadata, which closes the token account,
              the metadata account and the master edition together, and returns
              the rent locked in all three — about three times what closing the
              token account alone would return. The mint account survives, because
              only its mint authority can close it and that is given up when an
              NFT is minted. No Spacedust fee is charged on an NFT sent here.
            </>
          )}
        </span>
      </p>

      <div className="flex flex-col gap-2">
        {hasPreview ? (
          <Button
            size="lg"
            variant="danger"
            onClick={() => void handleBurn()}
            disabled={isBusy}
            loading={
              phase === "awaiting-signature" ||
              phase === "submitting" ||
              phase === "confirming"
            }
            loadingText={
              phase === "confirming"
                ? "Confirming…"
                : phase === "submitting"
                  ? `Sending ${progress.completed}/${progress.total}…`
                  : "Check your wallet…"
            }
            className="w-full"
          >
            <Flame className="size-4" aria-hidden />
            Send {burnSubject} into The Void
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={() => void handlePreview()}
            disabled={selectedAssets.length === 0 || isBusy}
            loading={phase === "planning"}
            loadingText="Preparing the send…"
            className="w-full"
          >
            Preview &amp; simulate
          </Button>
        )}

        {hasPreview ? (
          <Button
            variant="outline"
            size="sm"
            onClick={theBurn.reset}
            disabled={isBusy}
          >
            Change selection
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Result view for a finished burn. Mirrors the Void's, minus the fee line. */
/**
 * The mint of an asset — and what kind of asset it is — one click to copy.
 *
 * Deliberately a button that stops propagation: the whole card is a checkbox
 * for burning, and copying an address must never tick it.
 */
function CopyMint({ mint, kind }: { mint: string; kind: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Copy failed", { description: mint });
    }
  };

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void copy();
      }}
      title={`Copy ${kind} mint ${mint}`}
      aria-label={`Copy mint ${mint}`}
      className="flex w-fit items-center gap-1 font-mono text-[10px] text-subtle transition hover:text-foreground"
    >
      {copied ? (
        <Check className="size-2.5 text-success" aria-hidden />
      ) : (
        <Copy className="size-2.5" aria-hidden />
      )}
      <span className="uppercase tracking-wide">{kind}</span>
      <span aria-hidden>·</span>
      {truncateAddress(mint, 4, 4)}
    </button>
  );
}

/**
 * The auto/manual choice, in the two places the table is discussed.
 *
 * Auto only starts the existing cleanup flow; it cannot skip a wallet approval.
 * Saying that here is the difference between a useful preference and a promise
 * that the wallet will silently sign twice.
 */
function AutoReclaimToggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-2.5 flex items-start justify-between gap-3 border-t border-border/60 pt-2.5">
      <div className="min-w-0">
        <p className="font-medium text-foreground">
          Reclaim the table rent automatically
        </p>
        <p className="mt-0.5 text-subtle">
          Start the cleanup when the burn finishes. You will still approve the
          deactivation and the close; the close waits out the 512-slot cooldown.
        </p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label="Reclaim lookup-table rent automatically after a burn"
      />
    </div>
  );
}

/**
 * Reclaim control for the lookup tables a burn had to create.
 *
 * Kept separate from the burn result because the burn can be finished while the
 * table is not: deactivation needs one approval, closing needs another only
 * after 512 slots. The panel says exactly which step is waiting so a long
 * cooldown never looks like a stuck screen.
 */
function LookupTableCleanupPanel({
  cleanup,
  isBusy,
  onReclaim,
  autoReclaim,
  onAutoReclaimChange,
}: {
  cleanup: LookupTableCleanupState;
  isBusy: boolean;
  onReclaim: () => void;
  autoReclaim: boolean;
  onAutoReclaimChange: (next: boolean) => void;
}) {
  const { status, tables, rentLamports, reclaimedLamports, feeLamports, signatures, error, progress } =
    cleanup;
  const tableLabel = pluralize(tables.length, "lookup table");
  const rent = formatSol(rentLamports);
  const reclaimed = formatSol(reclaimedLamports);
  const canReclaim = (status === "available" || status === "failed") && !isBusy;
  const cooldownSlots = LOOKUP_TABLE_DEACTIVATION_SLOTS + 1;
  const cooldownMinutes = progress
    ? Math.max(1, Math.ceil((progress.slotsRemaining * 0.4) / 60))
    : 0;
  const progressPercent = progress
    ? Math.min(
        100,
        Math.max(
          0,
          ((cooldownSlots - progress.slotsRemaining) / cooldownSlots) * 100,
        ),
      )
    : 0;

  const message = (() => {
    switch (status) {
      case "available":
        return `The burn left ${rent} locked in ${tableLabel}. Deactivating and closing the table returns it. This takes two wallet approvals and one 512-slot wait (about four minutes). The address is saved on this device, so you can finish the reclaim later if you close this tab.`;
      case "deactivating":
        return "Approve the deactivation in your wallet. The table cannot be closed until the 512-slot cooldown ends.";
      case "waiting":
        return `Cooling down: ${progress?.slotsRemaining ?? LOOKUP_TABLE_DEACTIVATION_SLOTS} slots left (about ${cooldownMinutes} min). Keep this tab open; you will approve the close when the cooldown ends.`;
      case "closing":
        return `Approve the close in your wallet to return ${rent}.`;
      case "reclaimed":
        return reclaimedLamports > 0
          ? `${reclaimed} was returned to your wallet.`
          : "The table was already closed; there was no rent left to return.";
      case "failed":
        return "The table and its rent are still on chain. Nothing else was charged; try the reclaim again.";
    }
  })();

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed",
        status === "reclaimed"
          ? "border-success/25 bg-success/6"
          : status === "failed"
            ? "border-warning/30 bg-warning/8"
            : "border-violet-core/25 bg-violet-core/5",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            {status === "reclaimed"
              ? reclaimedLamports > 0
                ? `${reclaimed} lookup-table rent reclaimed`
                : "Lookup tables closed"
              : `${rent} lookup-table rent`}
          </p>
          <p className="mt-1 text-muted">{message}</p>
        </div>
        {canReclaim ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onReclaim}
            disabled={isBusy}
            className="shrink-0"
          >
            {status === "failed" ? "Try reclaim again" : `Reclaim ${rent}`}
          </Button>
        ) : null}
      </div>

      <AutoReclaimToggle
        checked={autoReclaim}
        onChange={onAutoReclaimChange}
        disabled={isBusy}
      />

      {status === "waiting" && progress ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-violet-core transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      ) : null}

      {error ? (
        <div className="mt-2 rounded-lg border border-warning/25 bg-warning/6 px-2.5 py-1.5">
          <p className="font-medium text-foreground">{error.title}</p>
          <p className="mt-0.5 text-muted">{error.message}</p>
          {error.hint ? <p className="mt-1 text-subtle">{error.hint}</p> : null}
        </div>
      ) : null}

      {feeLamports > 0 ? (
        <p className="mt-2 text-subtle">
          Cleanup network fees: {formatSol(feeLamports)}.
        </p>
      ) : null}

      {signatures.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {signatures.map((signature) => (
            <a
              key={signature}
              href={solscanTxUrl(signature)}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-white/3 px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-violet-core/40 hover:text-foreground"
            >
              {truncateAddress(signature, 4, 4)}
              <ExternalLink className="size-3" aria-hidden />
              <span className="sr-only">View cleanup transaction on Solscan</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BurnResult({
  summary,
  outcomes,
  cleanup,
  onReclaim,
  isBusy,
  autoReclaim,
  onAutoReclaimChange,
  onDone,
  nameFor,
}: {
  summary: NftBurnSummary;
  outcomes: NftBurnOutcome[];
  cleanup: LookupTableCleanupState | null;
  onReclaim: () => void;
  isBusy: boolean;
  autoReclaim: boolean;
  onAutoReclaimChange: (next: boolean) => void;
  onDone: () => void;
  /**
   * The name to show for an asset id, from the panel's own labelling.
   *
   * A report that renamed the assets would defeat the point of labelling them:
   * the user ticks "Mask · #679684" and has to see that same string come back.
   */
  nameFor: (id: string, fallback: string) => string;
}) {
  const failed = outcomes.filter((outcome) => outcome.status === "failed");

  /**
   * The wording comes from what burned, not from the tab this is read on.
   *
   * It used to take its noun and its rent line from the panel's `kind`, so a
   * batch of one NFT and one cNFT reported itself as "2 cNFTs burned — nothing
   * returned, a compressed NFT holds no rent": wrong count, wrong noun, and a
   * rent claim the NFT in the same transaction had just contradicted.
   */
  const copy = burnResultCopy(countBurned(outcomes), {
    failed: summary.failedCount,
    rentLamports: summary.rentReclaimedLamports,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-xl border border-success/25 bg-success/6 px-3 py-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-success/15">
          <CheckCircle2 className="size-3.5 text-success" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{copy.headline}</p>
          <p className="text-xs leading-relaxed text-muted">{copy.detail}</p>
        </div>
      </div>

      {/*
        Only when something actually burned. A transaction that was sent but not
        included has not happened *yet*: telling the user their asset is
        destroyed while the row below says it may still land is a contradiction,
        and the one thing this panel must never do is sound certain about an
        unknown.
      */}
      {summary.burnedCount > 0 ? (
        <p className="text-[11px] leading-relaxed text-muted">{copy.note}</p>
      ) : null}

      {cleanup ? (
        <LookupTableCleanupPanel
          cleanup={cleanup}
          isBusy={isBusy}
          onReclaim={onReclaim}
          autoReclaim={autoReclaim}
          onAutoReclaimChange={onAutoReclaimChange}
        />
      ) : summary.lookupTableRentLamports > 0 ? (
        <p className="rounded-xl border border-border/60 bg-white/2 px-3 py-2 text-[11px] leading-relaxed text-muted">
          A lookup table was created to fit the long merkle proofs.{" "}
          {formatSol(summary.lookupTableRentLamports)} of rent is locked in that
          table, and this screen could not load its cleanup state.
        </p>
      ) : null}

      {/* A failure is never swallowed. */}
      {failed.length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-warning/25 bg-warning/6 px-3 py-2 text-[11px] text-muted">
          {failed.map((outcome) => (
            <li key={outcome.id} className="flex gap-1.5">
              <span aria-hidden>•</span>
              <span className="min-w-0 break-words">
                <strong className="font-medium text-foreground">
                  {nameFor(outcome.id, outcome.name)}
                </strong>
                {outcome.error ? ` — ${outcome.error}` : " — not submitted."}
                {/*
                  The message above tells the user to check the transaction, so
                  the transaction has to be reachable. Without this the advice
                  pointed at a link that was not on the page.
                */}
                {outcome.signature ? (
                  <>
                    {" "}
                    <a
                      href={solscanTxUrl(outcome.signature)}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                    >
                      View the transaction
                    </a>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Refusals are reported too: the user asked for these and did not get them. */}
      {summary.skipped.length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-border/60 bg-white/2 px-3 py-2 text-[11px] text-subtle">
          {summary.skipped.map((entry) => (
            <li key={entry.id} className="flex gap-1.5">
              <span aria-hidden>•</span>
              <span className="min-w-0 break-words">
                <strong className="font-medium text-muted">
                  {nameFor(entry.id, entry.name)}
                </strong>
                {` — not sent: ${entry.reason}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {summary.signatures.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-subtle">
            Transactions
          </p>
          {summary.lookupTableRentLamports > 0 ? (
            <p className="text-[11px] leading-relaxed text-subtle">
              Includes the lookup-table setup transactions.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {summary.signatures.map((signature) => (
              <a
                key={signature}
                href={solscanTxUrl(signature)}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-white/3 px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-violet-core/40 hover:text-foreground"
              >
                {truncateAddress(signature, 4, 4)}
                <ExternalLink className="size-3" aria-hidden />
                <span className="sr-only">View on Solscan</span>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      <Button
        size="md"
        variant="outline"
        className="w-full"
        onClick={onDone}
        disabled={isBusy}
      >
        Done
      </Button>
    </div>
  );
}
