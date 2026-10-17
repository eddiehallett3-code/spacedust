"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Orbit, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, SectionTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OutputToggle } from "@/components/sweep/output-toggle";
import { SweepPanel } from "@/components/sweep/sweep-panel";
import { SmartFilterToggle } from "@/components/sweep/smart-filter-toggle";
import { RentReclaimPanel } from "@/components/sweep/rent-reclaim-panel";
import type { OutputAsset } from "@/types/sweep";
import type { FriendlyError } from "@/lib/utils/errors";
import type { EmptyTokenAccount } from "@/types/token";
import type { useSweep } from "@/hooks/use-sweep";
import { SweepHistoryPanel } from "@/components/sweep/sweep-history-panel";
import { OUTPUT_ASSETS, TOKEN_ACCOUNT_RENT_LAMPORTS } from "@/lib/utils/constants";
import { baseAmountToNumber, parseBaseAmount } from "@/lib/utils/sanitize";
import { pluralize } from "@/lib/utils/format";

type SweepApi = ReturnType<typeof useSweep>;

/**
 * The right-hand control column.
 *
 * Extracted from `dust-app` purely to keep that file readable — it holds no
 * state of its own, it just assembles the controls and forwards the sweep
 * and Void hooks through.
 */
export function ControlsColumn({
  outputAsset,
  onOutputChange,
  error,
  sweep,
  selectedCount,
  selectedValueUsd,
  onPreview,
  onSweep,
  onRescan,
  smartFilter,
  onSmartFilterChange,
  deselectAll,
  unroutableCount,
  emptyAccounts,
  emptyAccountsError,
  onRentReclaimed,
}: {
  outputAsset: OutputAsset;
  onOutputChange: (asset: OutputAsset) => void;
  error: FriendlyError | null;
  sweep: SweepApi;
  selectedCount: number;
  selectedValueUsd: number;
  onPreview: () => Promise<void>;
  onSweep: () => Promise<void>;
  onRescan: () => Promise<void>;
  smartFilter: boolean;
  onSmartFilterChange: (value: boolean) => void;
  deselectAll: () => void;
  /**
   * Tokens the sweeper has been refused a route for — evidence, not a heuristic.
   *
   * Drives the pointer to The Void, and deliberately not `illiquidTokens`, which
   * also counts everything with no price: that set still governs which tokens are
   * held out of the swap preview, but it has no business being announced here as a
   * routing fact.
   */
  unroutableCount: number;
  /** Empty token accounts the scan found, whose rent is still locked up. */
  emptyAccounts: EmptyTokenAccount[];
  /** Set when the scan could not check for those accounts at all. */
  emptyAccountsError: string | null;
  /** Called once accounts have been closed, so the app can rescan. */
  onRentReclaimed: () => void;
}) {
  // A preview describes its own plan, and these two numbers have to describe the
  // bytes rather than the checkboxes. They differ in two real cases: a retry
  // plans a subset of the selection (the rest already went), and Jupiter can
  // decline to route a selected token, which drops it from the plan. Either way
  // the button has to say how many swaps are actually about to be signed.
  const plannedTokens = sweep.packed.reduce(
    (sum, transaction) => sum + transaction.mints.length,
    0,
  );
  const hasPlan = sweep.packed.length > 0;
  const panelTokens = hasPlan ? plannedTokens : selectedCount;
  // The plan's own figure, which is the value of the *chosen* amounts — so it
  // already excludes anything it dropped and respects a partial sale.
  const panelValueUsd = hasPlan
    ? (sweep.plan?.totalInValueUsd ?? selectedValueUsd)
    : selectedValueUsd;
  // What the swaps pay out, in the output asset's own units — the panel's
  // headline. Summed as BigInt because a u64 of a meme coin overflows a double,
  // and parsed through `parseBaseAmount` so a malformed quote from a provider
  // contributes nothing instead of throwing inside render.
  const expectedOutBase = (sweep.plan?.builds ?? []).reduce(
    (sum, build) => sum + (parseBaseAmount(build.outAmount) ?? 0n),
    0n,
  );
  const expectedOutput =
    baseAmountToNumber(expectedOutBase, OUTPUT_ASSETS[outputAsset].decimals) ?? 0;

  return (
    // `max-h` + `overflow-y-auto` at the same breakpoint as `sticky`, and they are
    // load-bearing rather than decorative: a sticky element taller than the viewport
    // pins at `top-20` and clips its own bottom, so the panels below the fold become
    // unreachable while the taller right-hand column keeps scrolling. This column
    // holds the setup card, the smart filter, rent reclaim and the history log —
    // comfortably more than a laptop viewport — so the bottom of it was the
    // most-looked-for part of the column and the hardest to reach. Capped at 100dvh
    // minus the 80px header offset and a 16px gap, it scrolls on its own instead of
    // being cut off.
    <div className="flex flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
      <Card sheen>
        <CardHeader>
          <SectionTitle
            title="Slingshot into"
            description="Pick the asset you want to receive."
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <OutputToggle value={outputAsset} onChange={onOutputChange} />

          <SweepError error={error} />

          <SweepPanel
            phase={sweep.phase}
            outputAsset={outputAsset}
            selectedTokens={panelTokens}
            totalValueUsd={panelValueUsd}
            expectedOutput={expectedOutput}
            packed={sweep.packed}
            simulations={sweep.simulations}
            audit={sweep.audit}
            warnings={sweep.warnings}
            hasPreview={sweep.packed.length > 0}
            isBusy={sweep.isBusy}
            disabled={selectedCount === 0}
            feeBps={sweep.plan?.feeBps ?? 0}
            // From the plan, so the label tracks the network's actual rent.
            // The constant is only here for the pre-plan window.
            rentLamportsPerAccount={
              sweep.plan?.tokenAccountRentLamports ?? TOKEN_ACCOUNT_RENT_LAMPORTS
            }
            // The rent-reclaim fee the plan resolved, per closed account. Zero
            // when fees are off, so the panel can multiply it by a count.
            reclaimFeePerAccount={sweep.reclaimFeeLamportsPerAccount}
            onPreview={() => void onPreview()}
            onSweep={() => void onSweep()}
            onReset={sweep.reset}
            onRescan={() => void onRescan()}
          />
        </CardContent>
      </Card>

      <SmartFilterToggle enabled={smartFilter} onChange={onSmartFilterChange} />

      {/* ── The Void ───────────────────────────────────────────────────────
          A pointer, not a panel. The Void is its own app on its own page: the
          inline copy meant two versions of the same flow, two sets of
          near-identical selection state, and a panel that had to be *unlocked*
          before it could be used — a puzzle rather than a feature.

          What stays here is the one thing this page knows and The Void's page
          does not: the sweeper asked for a route and was refused. */}
      {unroutableCount > 0 ? (
        <div id="the-void" className="scroll-mt-24">
          <VoidPrompt count={unroutableCount} />
        </div>
      ) : null}

      {/* Rent left behind — the one flow with no selection, no price and no
          route, so it sits outside the swap controls entirely and shows up even
          in a wallet with no dust at all.

          Above the history log deliberately. This card acts on the wallet as it
          is right now, and it is the one people scroll this column looking for;
          the log below it is only a record of what already happened. It used to
          be the other way round, which put a list of finished sweeps between the
          user and the only money still on the table. */}
      <RentReclaimPanel
        accounts={emptyAccounts}
        scanError={emptyAccountsError}
        onReclaimed={onRentReclaimed}
      />

      <SweepHistoryPanel
        onResweep={() => {
          sweep.reset();
          deselectAll();
        }}
      />
    </div>
  );
}

/** Inline error banner for sweep failures. */
export function SweepError({ error }: { error: FriendlyError | null }) {
  return (
    <AnimatePresence>
      {error ? (
        <motion.div
          key={error.title + error.message}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="rounded-xl border border-danger/25 bg-danger/6 p-3"
          role="alert"
        >
          <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            {error.title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {error.message}
          </p>
          {error.hint ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-subtle">
              {error.hint}
            </p>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * The pre-sweep Void prompt.
 *
 * Appears instead of the full panel while the swaps are still unconfirmed: it
 * flags what the sweeper has been refused a route for and suggests sending it into
 * The Void *after* the sweep, keeping the two flows in the order they belong —
 * swaps first (they earn), The Void second (it reclaims rent).
 *
 * **The count is evidence, not a heuristic.** It used to be driven by the illiquid
 * set, which also includes everything Jupiter has no *price* for, and the copy then
 * declared those unroutable — "these have no route, so they cannot be swapped". The
 * app does not know that. A token with no price from the price API can be perfectly
 * sellable elsewhere; the only thing that proves a token cannot be routed is a
 * refusal the sweeper actually received. Unpriced tokens are still kept out of the
 * swap preview and still offered by The Void, which is a deliberate internal
 * caution — but it is not something to announce as a fact about the asset.
 */
function VoidPrompt({ count }: { count: number }) {
  return (
    <div className="rounded-2xl border border-violet-core/30 bg-violet-core/8 p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <span className="flex size-8 items-center justify-center rounded-lg bg-violet-core/15 text-violet-glow ring-1 ring-inset ring-violet-core/25">
          <Orbit className="size-4" aria-hidden />
        </span>
        {pluralize(count, "token")} the sweeper could not route
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        A route was asked for and refused, so{" "}
        {count === 1 ? "it cannot" : "they cannot"} be sold through Spacedust.
        Sending {count === 1 ? "it" : "them"} into The Void destroys the balance
        and closes the account, returning whatever rent it was holding.
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-subtle">
        The Void lists everything you hold — including anything Jupiter has no price
        for — so a holding that never appears here can still be offered for its rent.
        Those are flagged on the row rather than hidden.
      </p>
      <div className="mt-3">
        {/* A real link, not a button that navigates: this works before hydration,
            can be opened in a new tab, and can be copied. The Void is a page. */}
        <Button asChild size="sm" className="w-full">
          <Link href="/void">
            Open The Void
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}
