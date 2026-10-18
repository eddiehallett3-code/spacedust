"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { AlertTriangle, Info, RefreshCw, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  SectionTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThresholdControl } from "@/components/scanner/threshold-control";
import { TokenList } from "@/components/scanner/token-list";
import { ControlsColumn } from "@/components/sweep/controls-column";
import { SweepOverlay } from "@/components/sweep/sweep-overlay";
import { SuccessSummary } from "@/components/sweep/success-summary";
import { ConnectWalletCta } from "@/components/wallet/wallet-button";
import { useSweepHistory } from "@/hooks/use-sweep-history";
import { useSweep } from "@/hooks/use-sweep";
import { useWalletScan } from "@/hooks/use-wallet-scan";
import { countTokensLeftBehind } from "@/lib/sweep/void-prompt";
import { isSweepableToken } from "@/lib/sweep/sweepable";
import { resolveAmount } from "@/lib/sweep/amounts";
import { planRetry } from "@/lib/sweep/retry";
import {
  isBoolean,
  isNumberInRange,
  isOneOf,
  useLocalStorage,
} from "@/hooks/use-local-storage";
import {
  OUTPUT_ASSETS,
  SMART_FILTER_MAX_PRICE_IMPACT,
  STORAGE_KEYS,
  TOAST_BRIEF_MS,
  THRESHOLD_DEFAULT_USD,
  THRESHOLD_MAX_USD,
  THRESHOLD_MIN_USD,
  VOID_FEE_BPS,
} from "@/lib/utils/constants";
import { pluralize, formatUsd } from "@/lib/utils/format";
import { isNoLiquidityFailure } from "@/lib/utils/errors";
import { makeHistoryEntry, applySweepTally, useSweptCounters, useSweptUsd } from "@/lib/utils/tally";
import type { OutputAsset, SweepSummary, TokenOutcome } from "@/types/sweep";
import type { DustToken } from "@/types/token";

/**
 * The application shell.
 *
 * All sweep state lives here so the panels stay purely presentational. The two
 * persisted preferences (threshold and output asset) survive a reload, because
 * re-choosing them on every visit is pure friction.
 */
export function DustApp() {
  const { connected } = useWallet();
  const { addEntry } = useSweepHistory();
  const { scan, tokens, isScanning, error: scanError, rescan, owner } = useWalletScan();
  const sweep = useSweep();

  const [threshold, setThreshold] = useLocalStorage(
    STORAGE_KEYS.threshold,
    THRESHOLD_DEFAULT_USD,
    (value): value is number =>
      isNumberInRange(value, THRESHOLD_MIN_USD, THRESHOLD_MAX_USD),
  );
  const [outputAsset, setOutputAsset] = useLocalStorage<OutputAsset>(
    STORAGE_KEYS.outputAsset,
    "SOL",
    (value): value is OutputAsset => isOneOf(value, ["SOL", "USDC", "JUP"]),
  );
  const [smartFilter, setSmartFilter] = useLocalStorage(
    STORAGE_KEYS.smartFilter,
    true,
    isBoolean,
  );
  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set());

  /**
   * How much of each token to swap, in base units, when the user wants less than
   * everything. A mint with no entry goes in full — so an untouched app behaves
   * exactly as it did before partial amounts existed.
   *
   * Keyed on the *balance it was chosen from* being still valid: an override is
   * compared against the token's current `rawAmount`, and dropped if it no longer
   * fits (see the effect below). The server refuses an over-balance amount rather
   * than clamping, so a stale one would be a failed swap rather than a wrong one.
   */
  const [amountsByMint, setAmountsByMint] = useState<Map<string, string>>(
    new Map(),
  );

  /** The base-unit amount a token will swap: its override, or its whole balance. */
  const onAmountChange = useCallback((mint: string, raw: string): void => {
    setAmountsByMint((previous) => {
      const next = new Map(previous);
      next.set(mint, raw);
      return next;
    });
  }, []);

  /**
   * Whether the list offers a per-token amount at all.
   *
   * Off means every selected token goes in full, which is what a sweep is for
   * almost always. On, a row can sell a fraction — and that account then keeps a
   * balance, so its rent is not reclaimed.
   */
  const [customAmounts, setCustomAmounts] = useState(false);

  /**
   * Turning custom amounts off clears them rather than hiding them.
   *
   * A hidden 10% would still be what got signed, which is exactly the kind of
   * quiet mismatch this app exists to avoid. Clearing also invalidates any
   * preview, because the plan key includes the amounts.
   */
  const handleCustomAmountsChange = useCallback((next: boolean): void => {
    setCustomAmounts(next);
    if (!next) setAmountsByMint(new Map());
  }, []);

  /**
   * Holdings the sweeper will not list, and why.
   *
   * `isSweepableToken` keeps four kinds out of the list: a staking token, a
   * program-controlled mint no market prices, a frozen account and a
   * transfer-hook mint. Everywhere else this app refuses to hide a holding — a
   * refusal is shown with its reason rather than dropped — and that rule was
   * broken here, because the tokens simply were not there. So the count and a
   * pointer to the full picture are stated beneath the list instead.
   */
  const notListedTokens = useMemo(
    () =>
      tokens.filter(
        (token) => token.rawAmount !== "0" && !isSweepableToken(token),
      ),
    [tokens],
  );

  /**
   * The USD value actually being swapped for a token.
   *
   * The row still shows the token's full worth — that is what the holding is —
   * but everything that *decides* something (the threshold, the selected total)
   * has to use the chosen amount. Otherwise a $500 token set to 10% would be
   * filtered out as "above the dust threshold", which is the exact opposite of
   * what the user just asked for.
   */
  const effectiveValueUsd = useCallback(
    (token: DustToken): number => {
      const resolved = resolveAmount(token.rawAmount, amountsByMint.get(token.mint) ?? null);
      return resolved.ok ? token.valueUsd * resolved.fraction : token.valueUsd;
    },
    [amountsByMint],
  );

  /**
   * Drop an override whose balance has moved out from under it.
   *
   * A rescan is the common case: a token was partly swapped, or received a
   * transfer, and the amount the user chose no longer means what it did. Kept as
   * a guard on the *balance* rather than cleared wholesale, so a rescan that
   * changed nothing else does not silently reset everyone's choices.
   */
  useEffect(() => {
    setAmountsByMint((previous) => {
      if (previous.size === 0) return previous;
      const balances = new Map(tokens.map((token) => [token.mint, token.rawAmount]));
      const next = new Map<string, string>();
      let changed = false;
      for (const [mint, raw] of previous) {
        const balance = balances.get(mint);
        if (balance != null && resolveAmount(balance, raw).ok) next.set(mint, raw);
        else changed = true;
      }
      return changed ? next : previous;
    });
  }, [tokens]);

  // ── The Void ──────────────────────────────────────────────────────────
  // No selection state here any more. The Void is its own page, with its own
  // scan, its own selection and its own preview; the copy that used to live
  // inside this one meant two versions of the same flow to keep in step. What
  // remains on this page is a pointer to it — `VoidPrompt` in the controls
  // column, shown once the sweeper has actually been refused a route — and the
  // navigation below, for the one button that should take you there.
  const router = useRouter();

  // ── Tally counters (site-wide dust-sweep tallies). Show: wallets swept · SOL
  // · USDC · JUP swept. These survive a reload and are never used for anything
  // other than display, so a per-browser-profile count is honest and harmless.
  const [sweptWallets, setSweptWallets] = useSweptCounters();
  const [sweptUsd, setSweptUsd] = useSweptUsd();

  const outputConfig = OUTPUT_ASSETS[outputAsset];
  const hasPreview = sweep.packed.length > 0;

  // ── Filtering ────────────────────────────────────────────────────────────
  // A token is "dust" if it is worth less than the threshold. Sorted by value
  // descending so the biggest wins appear at the top.
  // ── Liquidity classification ──────────────────────────────────────────────
  // Two signals say a token cannot be swapped: Jupiter refuses to price it
  // (no market left to route through), or Jupiter plans it and comes back
  // with "no route". Either way there is nothing to gain from a swap, so the
  // token leaves the swap list entirely and is offered to the Void, where
  // burning it reclaims the rent instead.
  //
  // The "no route" verdict *accumulates* rather than living on `sweep.plan`:
  // the plan is discarded on every `sweep.reset()` (including "Send into The
  // Void" and closing the success overlay), and a token Jupiter already
  // refused must not bounce back into the swap list at exactly that moment.
  // A rescan clears the verdict so the next plan gets a fresh say.
  const [noRouteMints, setNoRouteMints] = useState<Set<string>>(new Set());

  useEffect(() => {
    const failures = sweep.plan?.failures ?? [];
    const fresh = failures.filter((failure) =>
      isNoLiquidityFailure(failure.reason),
    );
    if (fresh.length === 0) return;
    setNoRouteMints((previous) => {
      if (fresh.every((failure) => previous.has(failure.mint))) return previous;
      const next = new Set(previous);
      for (const failure of fresh) next.add(failure.mint);
      return next;
    });
  }, [sweep.plan]);

  /**
   * Every token The Void can act on: anything with a non-zero balance.
   *
   * Deliberately *not* filtered down to the illiquid ones. A token can carry a
   * price and still fail to swap on chain, and The Void used to refuse to list
   * it — leaving the user with a row the sweeper could not move and no way to
   * reclaim its rent. Liquidity is now a flag on the row, not a filter.
   */
  const voidCandidates = useMemo(
    () => tokens.filter((token) => token.rawAmount !== "0"),
    [tokens],
  );

  /**
   * The subset with genuinely nothing to route: unpriced, or Jupiter returned
   * no route for it.
   *
   * Only these are pre-ticked in The Void, and only these are held back from
   * the swap list — a token Jupiter cannot route has no business in a swap
   * preview. Burning a token that *does* have liquidity destroys value a swap
   * could have recovered, so that always stays an explicit choice.
   */
  const illiquidTokens = useMemo(
    () =>
      voidCandidates.filter(
        (token) => token.hasNoPrice || noRouteMints.has(token.mint),
      ),
    [voidCandidates, noRouteMints],
  );

  /** Mints held back from the swap list. */
  const voidMintSet = useMemo(
    () => new Set(illiquidTokens.map((token) => token.mint)),
    [illiquidTokens],
  );

  /**
   * How many tokens this sweep failed to move and cannot be moved at all.
   *
   * Scoped to the sweep's own outcomes, not the wallet: an unroutable token the
   * user never selected is not something "the sweeper left behind", and saying
   * so after a clean sweep reads as a failure report. See
   * `countTokensLeftBehind` for the full rule.
   */
  const voidPromptCount = useMemo(
    () =>
      countTokensLeftBehind({
        summary: sweep.summary,
        unroutableMints: illiquidTokens.map((token) => token.mint),
        outcomes: sweep.outcomes,
      }),
    [sweep.summary, sweep.outcomes, illiquidTokens],
  );

  /**
   * Tokens the sweeper has actually been refused a route for.
   *
   * Deliberately *not* `illiquidTokens.length`, which also counts everything
   * Jupiter has no price for. That set is the right internal signal — it keeps
   * unpriced tokens out of the swap preview and pre-ticks them for The Void — but
   * it is a heuristic, and the prompt used to announce it as a fact ("these have no
   * route, so they cannot be swapped"). A token can be perfectly sellable
   * elsewhere and simply have no price here, so only a refusal the sweeper
   * actually received is evidence.
   */
  const unroutableCount = useMemo(
    () => voidCandidates.filter((token) => noRouteMints.has(token.mint)).length,
    [voidCandidates, noRouteMints],
  );

  /**
   * Holdings kept out of the list for the other reason: no price to value them.
   *
   * Disjoint from `unroutableCount` on purpose, so the two prompts never count
   * the same token twice and never claim the same thing about it.
   */
  const unpricedCount = useMemo(
    () =>
      illiquidTokens.filter((token) => !noRouteMints.has(token.mint)).length,
    [illiquidTokens, noRouteMints],
  );

  // Tokens the Void has claimed must not be swappable here: a token Jupiter
  // could not even route has no business in a swap preview, and the two flows
  // are deliberately kept in separate transactions.
  //
  // `isSweepableToken` is the other gate, and it is shared with the read-only
  // scan on purpose: a staking token or a pool share must not appear here as an
  // ordinary row, because the scan says a sweep will not sell one — and until
  // this check existed, that sentence was false in this very list.
  const eligibleTokens = useMemo(
    () =>
      tokens.filter((token) => {
        // The threshold is a test on what would actually be swapped, not on the
        // holding: $50 chosen out of a $500 token is dust, at any threshold that
        // admits $50. At the default 100% this is the value it always was.
        const value = effectiveValueUsd(token);
        return (
          isSweepableToken(token) &&
          value > 0 &&
          value <= threshold &&
          !voidMintSet.has(token.mint)
        );
      }),
    [tokens, threshold, voidMintSet, effectiveValueUsd],
  );

  /**
   * Smart Filter.
   *
   * Hides things that look sweepable but are not — each of these is a token
   * that would quietly fail or lose money:
   *  - no Jupiter price → almost certainly no liquidity to route through
   *  - quoted price impact above the limit → the swap would eat the dust
   */
  const visibleTokens = useMemo(() => {
    if (!smartFilter) return eligibleTokens;

    const impactByMint = new Map(
      (sweep.plan?.builds ?? []).map((build) => [build.mint, build.priceImpactPct]),
    );

    return eligibleTokens.filter((token) => {
      if (token.hasTransferHook) return false;
      if (smartFilter && (token.hasNoPrice || token.priceUsd == null)) return false;
      const impact = impactByMint.get(token.mint);
      if (impact != null && impact > SMART_FILTER_MAX_PRICE_IMPACT) return false;
      return true;
    });
  }, [eligibleTokens, smartFilter, sweep.plan]);

  const hiddenBySmartFilter = eligibleTokens.length - visibleTokens.length;

  const smartFilterLabel =
    hiddenBySmartFilter > 0
      ? hiddenBySmartFilter +
        " hidden by the smart filter: no reliable price, a transfer hook, or an excessive price impact."
      : undefined;

  // When the smart filter turns on, anything already selected that it would
  // now hide is deselected — keeping it selected would look bad rather than
  // leaving it selected.
  useEffect(() => {
    if (!smartFilter || !sweep.plan) return;
    setSelectedMints((previous) => {
      const allowed = new Set(visibleTokens.map((token) => token.mint));
      const next = new Set<string>();
      let changed = false;
      for (const mint of previous) {
        if (allowed.has(mint)) next.add(mint);
        else changed = true;
      }
      return changed ? next : previous;
    });
  }, [sweep.plan, smartFilter, visibleTokens]);

  // Clear a stale preview whenever the request changes. The plan describes the
  // previous selection and must never be submitted against a new one. The key
  // is the *effective* selection (visible ∩ selected), so lowering the
  // threshold or the smart filter hiding a token also invalidates the preview
  // — keying on `selectedMints` alone would leave a stale, larger batch behind
  // a smaller "Sign & send N swaps" label.
  const planKey =
    `${visibleTokens
      .filter((token) => selectedMints.has(token.mint))
      // The *amount* is part of the request, not just the mint: changing 100% to
      // 10% must invalidate a preview built for the whole balance, or the user
      // would sign a transaction describing more than the field shows.
      .map(
        (token) =>
          `${token.mint}:${amountsByMint.get(token.mint) ?? token.rawAmount}`,
      )
      .sort()
      .join(",")}|${outputAsset}`;
  const planKeyRef = useRef(planKey);
  useEffect(() => {
    if (planKeyRef.current === planKey) return;
    // Never yank the pipeline while a run may still be in flight: `reset()`
    // also clears the busy guard, so resetting mid-submit would let a second
    // sweep start on top of the first. Defer — `sweep` is a fresh object every
    // render, so this effect re-runs and picks the change up once idle.
    if (sweep.isBusy) return;
    planKeyRef.current = planKey;
    // Keep a completed run's results on screen; the plan it describes has
    // already been submitted, so there is nothing left to invalidate.
    if (hasPreview && sweep.phase !== "success") sweep.reset();
  }, [hasPreview, planKey, sweep]);

  // ── Selection helpers ────────────────────────────────────────────────────
  const selectableMints = useMemo(
    () => visibleTokens.filter((token) => !token.hasTransferHook),
    [visibleTokens],
  );

  const toggleMint = useCallback((mint: string, next: boolean): void => {
    setSelectedMints((previous) => {
      const updated = new Set(previous);
      if (next) updated.add(mint);
      else updated.delete(mint);
      return updated;
    });
  }, []);

  const selectAll = useCallback((): void => {
    setSelectedMints(new Set(selectableMints.map((token) => token.mint)));
  }, [selectableMints]);

  const deselectAll = useCallback((): void => {
    setSelectedMints(new Set());
  }, []);

  // "Select all" covers everything The Void lists, including tokens flagged as
  // having liquidity — selecting one is the user's explicit call, and the panel
  // warns about the value before anything is signed.
  const selectedTokens = useMemo(
    () => visibleTokens.filter((token) => selectedMints.has(token.mint)),
    [visibleTokens, selectedMints],
  );

  const selectedValueUsd = useMemo(
    () => selectedTokens.reduce((sum, token) => sum + effectiveValueUsd(token), 0),
    [selectedTokens, effectiveValueUsd],
  );

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * Whether the plan in flight is a retry of a partial sweep.
   *
   * Read when the run lands, to keep one sweep from being counted twice in the
   * site tally: a retry is the same sweep finishing, and its dollars are already
   * the only dollars it adds.
   */
  const retryingRef = useRef(false);

  const handlePreview = useCallback(async (): Promise<void> => {
    retryingRef.current = false;
    const result = await sweep.prepare({
      tokens: selectedTokens,
      outputAsset,
      // The per-token amounts ride alongside the tokens rather than replacing
      // their balances — the plan still needs the full balance to know whether a
      // swap empties the account and its rent can be reclaimed.
      //
      // Undefined when custom amounts are off, so "100%" is what the request
      // says rather than an empty map that happens to mean the same thing.
      amounts: customAmounts ? amountsByMint : undefined,
    });
    if (result) {
      // Read from the result, never from `sweep`. This closure holds the render
      // from before the plan existed, so `sweep.packed` here is the *previous*
      // plan's — which is how this toast came to announce "0 transactions built"
      // on a first run and a stale count on every run after it.
      toast.success("Preview ready", {
        duration: TOAST_BRIEF_MS,
        description:
          pluralize(result.packed.length, "transaction") +
          " built and simulated. Review before signing.",
      });
    }
  }, [amountsByMint, customAmounts, outputAsset, selectedTokens, sweep]);

  const handleSweep = useCallback(async (): Promise<void> => {
    await sweep.execute();
  }, [sweep]);

  /**
   * Runs just the tokens whose transaction did not land.
   *
   * No rescan and no re-selection, deliberately: a reverted swap moves nothing,
   * so the balances are exactly where the failed run left them and the scan we
   * already hold still describes the wallet. What the retry rebuilds is the
   * *plan* — fresh quotes, fresh blockhash, fresh simulation — because those are
   * what actually fix the two ways a batch fails.
   *
   * It lands in the ordinary preview state rather than signing straight away,
   * which means the retry is reviewed like any other run. A new plan means a new
   * blockhash, and therefore a new signature: there is nothing here that could be
   * submitted without one, so skipping the preview would buy nothing but risk.
   */
  const handleRetryFailed = useCallback(async (): Promise<void> => {
    const plan = planRetry({
      outcomes: sweep.outcomes,
      tokens,
      amounts: amountsByMint,
    });
    if (!plan) return;

    retryingRef.current = true;
    const result = await sweep.prepare({
      tokens: plan.tokens,
      outputAsset,
      amounts: plan.amounts,
    });
    if (result) {
      toast.success(`Retrying ${pluralize(plan.tokens.length, "token")}`, {
        description: "Fresh routes and quotes. Review the preview, then sign.",
      });
    }
  }, [amountsByMint, outputAsset, sweep, tokens]);

  // ── One tally path ──────────────────────────────────────────────────────
  // The moment a real sweep lands, both persistent records update together:
  // the site-wide counters and the history ledger. A ref keyed on the plan's
  // createdAt makes this idempotent, because effects can re-run (StrictMode,
  // dependency churn) and neither record is safe to double-write.
  const recordedPlanRef = useRef<number | null>(null);
  useEffect(() => {
    if (sweep.phase !== "success") return;
    const summary = sweep.summary;
    const plan = sweep.plan;
    if (!summary || summary.dryRun || !plan) return;
    if (recordedPlanRef.current === plan.createdAt) return;
    recordedPlanRef.current = plan.createdAt;

    // A retry is the same sweep finishing, not a second one. The dollars it adds
    // are its own; the count would be a duplicate, and it is on screen.
    applySweepTally(
      setSweptWallets,
      setSweptUsd,
      retryingRef.current ? 0 : 1,
      summary.totalValueUsd,
    );
    addEntry(
      makeHistoryEntry(
        {
          outputAsset,
          outputMint: outputConfig.mint,
          tokens: sweep.outcomes.map((outcome) => ({ mint: outcome.mint })),
          plan: { createdAt: plan.createdAt },
        },
        summary,
      ),
    );
  }, [
    addEntry,
    outputAsset,
    outputConfig.mint,
    setSweptUsd,
    setSweptWallets,
    sweep.outcomes,
    sweep.phase,
    sweep.plan,
    sweep.summary,
  ]);

  const handleRescan = useCallback(async (): Promise<void> => {
    deselectAll();
    sweep.reset();
    retryingRef.current = false;
    // Fresh scan, fresh verdict: Jupiter gets to say again which tokens have
    // no route, so stale "no route" marks from the previous plan are dropped.
    setNoRouteMints(new Set());
    await rescan();
    toast("Wallet rescanned", { duration: TOAST_BRIEF_MS });
  }, [deselectAll, rescan, sweep]);

  // A confirmed sweep changes what is left behind, which is what the pointer to
  // The Void counts — so the prompt appears on its own, from the scan. Nothing to
  // unlock, and nothing to navigate to on the user's behalf: arriving somewhere
  // they did not ask for is not an offer.

  /**
   * Leaves for The Void, which is its own page.
   *
   * There is nothing to unlock and nothing to scroll to any more: the panel used
   * to live at the bottom of this page, so this handler had to open it *and* race
   * React's commit to bring it into view. A page has its own address and, more to
   * the point, its own scan — The Void acts on a token list, and a sweep has just
   * changed the balances that list describes.
   */
  const handleEnterVoid = useCallback((): void => {
    router.push("/void");
  }, [router]);

  if (!connected) return <ConnectPrompt />;

  return (
    <>
      <SweepOverlay phase={sweep.phase} progress={sweep.progress} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        {/* ── Token list ────────────────────────────────────────────── */}
        <Card className="overflow-hidden">
          <CardHeader className="gap-4">
            <SectionTitle
              icon={<Wand2 className="size-4" aria-hidden />}
              title="Dust in your wallet"
              description={
                scan
                  ? `Scanned ${pluralize(scan.tokens.length, "token")} in ${scan.durationMs}ms${scan.truncated ? " · truncated" : ""}`
                  : "Looking for tokens worth less than your threshold."
              }
              action={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleRescan}
                  disabled={isScanning || sweep.isBusy}
                  aria-label="Rescan wallet"
                >
                  <RefreshCw
                    className={isScanning ? "animate-spin" : undefined}
                    aria-hidden
                  />
                </Button>
              }
            />
            <ThresholdControl value={threshold} onChange={setThreshold} />
          </CardHeader>

          <CardContent className="pt-0">
            {scanError ? (
              <ScanErrorState message={scanError.message} onRetry={rescan} />
            ) : (
              <>
                <TokenList
                  tokens={visibleTokens}
                  selectedMints={selectedMints}
                  onToggle={toggleMint}
                  onSelectAll={selectAll}
                  onDeselectAll={deselectAll}
                  isLoading={isScanning}
                  hiddenCount={hiddenBySmartFilter}
                  hiddenLabel={smartFilterLabel}
                  className="-mx-5 rounded-b-2xl border-t border-border/60 sm:-mx-6"
                  amounts={amountsByMint}
                  onAmountChange={onAmountChange}
                  showAmounts={customAmounts}
                  onShowAmountsChange={handleCustomAmountsChange}
                />
                {/* A holding this list refuses is still a holding the wallet has,
                    so its absence is stated rather than left to be noticed. */}
                {notListedTokens.length > 0 ? (
                  <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-subtle">
                    <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                    <span>
                      {pluralize(notListedTokens.length, "holding")} in this wallet{" "}
                      {notListedTokens.length === 1 ? "is" : "are"} not listed here —
                      a staking position, a pool share, a frozen balance or a
                      transfer-hook mint, none of which a swap should touch.{" "}
                      {owner ? (
                        <Link
                          href={`/scan?owner=${encodeURIComponent(owner)}`}
                          className="text-violet-glow hover:underline"
                        >
                          See what they are
                        </Link>
                      ) : null}
                    </span>
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
        <ControlsColumn
          outputAsset={outputAsset}
          onOutputChange={setOutputAsset}
          error={sweep.error}
          sweep={sweep}
          selectedCount={selectedTokens.length}
          selectedValueUsd={selectedValueUsd}
          onPreview={handlePreview}
          onSweep={handleSweep}
          onRescan={handleRescan}
          smartFilter={smartFilter}
          onSmartFilterChange={setSmartFilter}
          deselectAll={deselectAll}
          unroutableCount={unroutableCount}
          unpricedCount={unpricedCount}
          emptyAccounts={scan?.emptyAccounts ?? []}
          emptyAccountsError={scan?.emptyAccountsError ?? null}
          onRentReclaimed={handleRescan}
        />
      </div>

      <SuccessOverlay
        summary={sweep.summary}
        outcomes={sweep.outcomes}
        onRetryFailed={() => void handleRetryFailed()}
        show={sweep.phase === "success"}
        voidCount={voidPromptCount}
        onEnterVoid={handleEnterVoid}
        onSweepMore={handleRescan}
        // Closing the summary has to rescan too, or the scanner underneath still
        // lists the tokens that were just swapped — they are gone from the
        // wallet but not from the last scan. `handleRescan` already resets the
        // sweep, clears the selection and drops stale "no route" verdicts.
        onClose={handleRescan}
      />
      <SweepTally wallets={sweptWallets} usd={sweptUsd} />
    </>
  );
}

/** Site-wide Slingshot tally — shown at the bottom of the app shell. */
function SweepTally({ wallets, usd }: { wallets: number; usd: number }) {
  return (
    <p className="mt-4 text-center text-xs text-subtle">
      <ShieldCheck className="inline size-3.5 mr-1" aria-hidden />
      {pluralize(wallets, "slingshot")} complete · {formatUsd(usd)} swept
    </p>
  );
}

/**
 * Shown before a wallet is connected.
 *
 * States the security model up front rather than burying it in a footer: the
 * first thing a user learns about this app is that it cannot touch their money.
 */
function ConnectPrompt() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="glass glass-sheen mx-auto max-w-lg rounded-2xl p-8 text-center"
    >
      <motion.span
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
        className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-linear-to-br from-violet-core to-cyan-core shadow-[0_12px_40px_-12px_rgba(139,92,246,0.95)]"
      >
        <Sparkles className="size-7 text-white" aria-hidden />
      </motion.span>

      <h2 className="mt-5 text-lg font-semibold tracking-tight">
        Connect your wallet to begin
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
        Spacedust scans your wallet for leftover token dust and swaps it into SOL, USDC or JUP — in as few transactions as possible, reclaiming the locked rent along the way.
      </p>

      <ConnectWalletCta className="mt-6 w-full" />

      <ul className="mt-6 space-y-2 border-t border-border/60 pt-5 text-left">
        {[
          "You sign every transaction in your own wallet",
          "We never ask for a private key or seed phrase",
          `${(VOID_FEE_BPS / 100).toFixed(1)}% on Void sends — shown before you sign`,
        ].map((line) => (
          <li key={line} className="flex items-start gap-2 text-xs text-muted">
            <ShieldCheck
              className="mt-px size-3.5 shrink-0 text-success"
              aria-hidden
            />
            {line}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

/** Shown when a wallet scan fails outright (as opposed to finding nothing). */
function ScanErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => Promise<void>;
}) {
  return (
    <div
      className="flex flex-col items-center gap-3 px-6 py-12 text-center"
      role="alert"
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-danger/12 ring-1 ring-inset ring-danger/25">
        <AlertTriangle className="size-6 text-danger" aria-hidden />
      </span>
      <div>
        <p className="text-sm font-medium">Could not scan this wallet</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">
          {message}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={() => void onRetry()}>
        Try again
      </Button>
    </div>
  );
}

/** Modal wrapper for the post-sweep summary. */
function SuccessOverlay({
  summary,
  outcomes,
  onRetryFailed,
  show,
  voidCount,
  onEnterVoid,
  onSweepMore,
  onClose,
}: {
  summary: SweepSummary | null;
  outcomes: TokenOutcome[];
  onRetryFailed: () => void;
  show: boolean;
  /** Unroutable tokens still held — offered The Void after a real sweep. */
  voidCount: number;
  onEnterVoid: () => void;
  onSweepMore: () => void;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {show && summary ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-space-950/85 p-4 pt-[10dvh] backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label="Slingshot results"
        >
          <motion.div
            initial={{ scale: 0.96, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="glass glass-sheen w-full max-w-lg rounded-2xl p-6"
          >
            <SuccessSummary
              summary={summary}
              outcomes={outcomes}
              onRetryFailed={onRetryFailed}
              voidCount={voidCount}
              onEnterVoid={onEnterVoid}
              onSweepMore={onSweepMore}
              onClose={onClose}
            />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
