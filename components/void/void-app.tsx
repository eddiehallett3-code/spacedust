"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Orbit,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  SectionTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { VoidPanel } from "@/components/sweep/void-panel";
import { VoidEmblem } from "@/components/void/void-emblem";
import { NftBurnPanel } from "@/components/void/nft-burn-panel";
import { previewAction } from "@/lib/sweep/preview";
import { useNftBurn } from "@/hooks/use-nft-burn";
import { ConnectWalletCta } from "@/components/wallet/wallet-button";
import { useVoid } from "@/hooks/use-void";
import { useWalletScan } from "@/hooks/use-wallet-scan";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { hideAssets, mergeIds, removeId } from "@/lib/sweep/hidden-assets";
import { isValidSolanaAddress } from "@/lib/utils/sanitize";
import { STORAGE_KEYS } from "@/lib/utils/constants";
import { useWallet } from "@solana/wallet-adapter-react";
import { cn } from "@/lib/utils/cn";
import { pluralize } from "@/lib/utils/format";
import { VOID_FEE_BPS } from "@/lib/utils/constants";

/**
 * The Void — standalone page.
 *
 * A second, self-contained entry point into the burn flow for users who only
 * want to reclaim rent from illiquid tokens. It runs its own scan and its own
 * `useVoid` pipeline: nothing here can swap, so nothing here can share a
 * transaction with a swap. Swappable tokens are listed for information only,
 * with a link back to the sweeper.
 */
export function VoidApp() {
  const { connected } = useWallet();
  const {
    scan,
    tokens,
    nonFungibles,
    isScanning,
    error: scanError,
    rescan,
  } = useWalletScan();
  const theVoid = useVoid();
  // A third, separate pipeline: burning a one-of-one asset shares no code with
  // sweeping dust or emptying tokens, so a mistake in one cannot reach another.
  const theBurn = useNftBurn();

  /**
   * Which list the user is looking at.
   *
   * Three tabs because the three things a wallet holds are not
   * interchangeable: dust is swept for its rent, an NFT is a unique asset, and
   * a cNFT has no rent to reclaim at all. Merging them into one list is exactly
   * what made NFTs look burnable.
   */
  const [tab, setTab] = useState<"tokens" | "nfts" | "cnfts">("tokens");

  /**
   * What is ticked for burning, across **both** NFT tabs.
   *
   * Held here rather than inside each panel because the burn pipeline is here:
   * the panels only ever see one tab's assets, so a selection per panel meant an
   * NFT and a cNFT could not be burned together — the batch, and the count on the
   * button, only ever described the tab that was open.
   */
  const [burnSelection, setBurnSelection] = useState<Set<string>>(new Set());

  /**
   * What this browser is hiding.
   *
   * Two sources. A burn this app watched is recorded the moment it lands, since
   * the scan reads an index and an index lags — a destroyed asset can return on
   * the very next rescan, and for a cNFT that is the only local record there can
   * be, because burning a leaf leaves no account behind to check. (Helius's own
   * `burnt` flag settles it properly for everyone, eventually.) The rest are
   * hides the user asked for by hand, including on assets that genuinely are
   * gone — which is why the list can be edited rather than only added to.
   */
  const [hiddenIds, setHiddenIds] = useLocalStorage<string[]>(
    STORAGE_KEYS.hiddenAssets,
    [],
    (value): value is string[] =>
      Array.isArray(value) && value.every(isValidSolanaAddress),
  );

  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const visibleNonFungibles = useMemo(
    () => hideAssets(nonFungibles, hidden),
    [nonFungibles, hidden],
  );
  // Kept in hand so a hide can be undone from the grid itself, rather than
  // needing local storage cleared to get a row back.
  const hiddenNonFungibles = useMemo(
    () => nonFungibles.filter((asset) => hidden.has(asset.id)),
    [nonFungibles, hidden],
  );

  const handleSetHidden = useCallback(
    (id: string, shouldHide: boolean): void => {
      setHiddenIds((previous) =>
        shouldHide ? mergeIds(previous, [id]) : removeId(previous, id),
      );
    },
    [setHiddenIds],
  );

  const nfts = useMemo(
    () => visibleNonFungibles.filter((asset) => !asset.compressed),
    [visibleNonFungibles],
  );
  const cnfts = useMemo(
    () => visibleNonFungibles.filter((asset) => asset.compressed),
    [visibleNonFungibles],
  );

  /**
   * The ticked assets themselves, gathered from both tabs.
   *
   * This is what a burn batch is built from, so it has to see both lists — the
   * panel that pressed Burn only knows its own.
   */
  const burnSelectionAssets = useMemo(
    () => [...nfts, ...cnfts].filter((asset) => burnSelection.has(asset.id)),
    [nfts, cnfts, burnSelection],
  );

  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set());
  // Same "new candidates start selected, explicit deselection is remembered"
  // contract as the main sweeper.
  const seenMints = useRef<Set<string>>(new Set());

  /**
   * Everything The Void can act on: any token with a balance.
   *
   * Not just the unpriced ones. A token can carry a price and still have no
   * route worth taking, and this page used to refuse to list it — so a user
   * told to "use The Void" for a stubborn token would open The Void and find
   * it missing. Liquidity is a flag on the row now, not a filter.
   */
  const voidCandidates = useMemo(
    () => tokens.filter((token) => token.rawAmount !== "0"),
    [tokens],
  );

  /**
   * The genuinely unroutable subset: unpriced, or valued at nothing.
   *
   * Only these start ticked. Burning a token that has liquidity destroys value
   * a swap could have recovered, so that always stays an explicit choice.
   *
   * A pool share is excluded outright rather than left to the price test. Most
   * have no price at all, so they would sit in this subset by default — and
   * burning one does not destroy "unroutable dust", it gives away the share of
   * the pool the token represents, permanently. The planner refuses them too;
   * this is the half that keeps them from appearing pre-ticked.
   */
  const illiquidTokens = useMemo(
    () =>
      voidCandidates.filter(
        (token) =>
          !token.poolLike && (token.hasNoPrice || token.valueUsd <= 0),
      ),
    [voidCandidates],
  );

  /** Every mint the panel may show, for remembering selection decisions. */
  const voidMintSet = useMemo(
    () => new Set(voidCandidates.map((token) => token.mint)),
    [voidCandidates],
  );

  // Same contract as the sweeper: a preview must never outlive the selection
  // it was built from. Changing the checkboxes clears a pending preview so
  // the "Sign & send" button can never describe a different batch than the
  // one that will be signed. A finished burn's summary is never touched.
  const previewKey = [...selectedMints]
    .filter((mint) => voidMintSet.has(mint))
    .sort()
    .join(",");
  const previewKeyRef = useRef(previewKey);
  useEffect(() => {
    const action = previewAction({
      previousKey: previewKeyRef.current,
      currentKey: previewKey,
      isBusy: theVoid.isBusy,
      hasSummary: theVoid.summary !== null,
      hasPreview: theVoid.packed.length > 0,
    });
    if (action === "none") return;
    previewKeyRef.current = previewKey;
    if (action === "discard") theVoid.reset();
  }, [previewKey, theVoid]);

  // Tokens that *can* be swapped — shown only as a pointer back to the
  // sweeper, because this page deliberately has no swap flow.
  const swappableTokens = useMemo(() => {
    const illiquid = new Set(illiquidTokens.map((token) => token.mint));
    return voidCandidates.filter((token) => !illiquid.has(token.mint));
  }, [voidCandidates, illiquidTokens]);

  useEffect(() => {
    const seen = seenMints.current;
    setSelectedMints((previous) => {
      let changed = false;
      const next = new Set(previous);
      for (const token of illiquidTokens) {
        if (!seen.has(token.mint)) {
          seen.add(token.mint);
          next.add(token.mint);
          changed = true;
        }
      }
      for (const mint of Array.from(seen)) {
        if (!voidMintSet.has(mint)) {
          seen.delete(mint);
          if (next.delete(mint)) changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [illiquidTokens, voidMintSet]);

  const toggleMint = useCallback((mint: string, next: boolean): void => {
    setSelectedMints((previous) => {
      const updated = new Set(previous);
      if (next) updated.add(mint);
      else updated.delete(mint);
      return updated;
    });
  }, []);

  const selectAll = useCallback((): void => {
    setSelectedMints(new Set(voidCandidates.map((token) => token.mint)));
  }, [voidCandidates]);

  const deselectAll = useCallback((): void => {
    setSelectedMints(new Set());
  }, []);

  const handleBurnt = useCallback((): void => {
    setSelectedMints(new Set());
    void rescan();
  }, [rescan]);

  /**
   * After an NFT is burned the scanned list is stale, so rescan — otherwise the
   * destroyed NFT sits in the grid looking burnable again. Rescanning alone is
   * not enough though: the index still reports the asset, so the ids are
   * remembered here and filtered out of the grid for good.
   */
  const handleNftBurnt = useCallback(
    (burnedIdsNow: string[]): void => {
      setHiddenIds((previous) => mergeIds(previous, burnedIdsNow));
      void rescan();
    },
    [rescan, setHiddenIds],
  );

  if (!connected) return <VoidConnectPrompt />;

  return (
    <div className="flex flex-col gap-4 pb-16">
      {/* Swappable tokens are this page's "not for here" signal. */}
      {swappableTokens.length > 0 ? (
        <Card>
          <CardHeader>
            <SectionTitle
              icon={<Wand2 className="size-4" aria-hidden />}
              title="These can be swapped"
              description={`${pluralize(swappableTokens.length, "token")} with liquidity — Slingshot them into SOL, USDC or JUP instead. They are still listed below, flagged, in case a swap fails anyway.`}
            />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul className="flex flex-wrap gap-1.5" role="list">
              {swappableTokens.slice(0, 12).map((token) => (
                <li
                  key={token.mint}
                  className="rounded-lg border border-border bg-white/3 px-2 py-1 text-xs text-muted"
                >
                  {token.symbol}
                </li>
              ))}
              {swappableTokens.length > 12 ? (
                <li className="rounded-lg border border-border bg-white/3 px-2 py-1 text-xs text-subtle">
                  +{swappableTokens.length - 12} more
                </li>
              ) : null}
            </ul>
            <Link
              href="/slingshot"
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted transition-colors hover:border-violet-core/40 hover:text-foreground"
            >
              Swap them in Slingshot
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {/* Three kinds of thing live in one wallet and they are not
          interchangeable, so they get a tab each rather than one merged list. */}
      <div
        role="tablist"
        aria-label="What to send into The Void"
        className="flex gap-1 rounded-xl border border-border/60 bg-white/2 p-1"
      >
        {(
          [
            { key: "tokens", label: "Tokens", count: voidCandidates.length },
            { key: "nfts", label: "NFTs", count: nfts.length },
            { key: "cnfts", label: "cNFTs", count: cnfts.length },
          ] as const
        ).map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            onClick={() => setTab(entry.key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
              tab === entry.key
                ? "bg-violet-core/15 text-foreground"
                : "text-muted hover:text-foreground",
            )}
          >
            {entry.label}
            <span className="font-mono text-[11px] text-subtle">
              {entry.count}
            </span>
          </button>
        ))}
      </div>

      {scanError ? (
        <div
          className="flex flex-col items-center gap-3 rounded-2xl border border-danger/25 bg-danger/6 px-6 py-10 text-center"
          role="alert"
        >
          <span className="flex size-12 items-center justify-center rounded-2xl bg-danger/12 ring-1 ring-inset ring-danger/25">
            <AlertTriangle className="size-6 text-danger" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-medium">Could not scan this wallet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">
              {scanError.message}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void rescan()}>
            Try again
          </Button>
        </div>
      ) : tab === "tokens" ? (
        <VoidPanel
          tokens={voidCandidates}
          selectedMints={selectedMints}
          onToggle={toggleMint}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          theVoid={theVoid}
          onBurnt={handleBurnt}
        />
      ) : tab === "nfts" ? (
        // NFTs are burnable, one at a time and never pre-selected.
        <NftBurnPanel
          assets={nfts}
          theBurn={theBurn}
          onBurnt={handleNftBurnt}
          hidden={hidden}
          hiddenAssets={hiddenNonFungibles}
          onSetHidden={handleSetHidden}
          selected={burnSelection}
          selectedAssets={burnSelectionAssets}
          onSelectionChange={setBurnSelection}
        />
      ) : (
        // cNFTs use the same panel and the same opt-in rule, but a third burn
        // route underneath: a Bubblegum burn over a merkle proof, which returns
        // no rent because a leaf is not an account.
        <NftBurnPanel
          assets={cnfts}
          theBurn={theBurn}
          onBurnt={handleNftBurnt}
          hidden={hidden}
          hiddenAssets={hiddenNonFungibles}
          onSetHidden={handleSetHidden}
          selected={burnSelection}
          selectedAssets={burnSelectionAssets}
          onSelectionChange={setBurnSelection}
          kind="cnft"
        />
      )}

      {/* An empty Void is a good outcome — say so rather than rendering a
          blank hole. Scoped to the tokens tab: the NFT tabs have their own
          empty states, and "no tokens" is not "no assets". */}
      {!scanError &&
      !isScanning &&
      scan &&
      tab === "tokens" &&
      voidCandidates.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="glass rounded-2xl p-8 text-center"
        >
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-linear-to-br from-violet-core/20 to-cyan-core/15 ring-1 ring-inset ring-white/10">
            <Sparkles className="size-6 text-violet-glow" aria-hidden />
          </span>
          <h2 className="mt-4 text-lg font-semibold tracking-tight">
            Nothing for The Void
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
            This wallet holds no tokens at all. Scan again after you receive
            some dust.
          </p>
          <Link
            href="/slingshot"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted transition-colors hover:border-violet-core/40 hover:text-foreground"
          >
            Go to Slingshot
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </motion.div>
      ) : null}

      {/* Scan status + rescan, mirroring the sweeper's header affordance. */}
      {scan && (voidCandidates.length > 0 || nonFungibles.length > 0) ? (
        <div className="flex items-center justify-between gap-3 px-1 text-xs text-subtle">
          <span className="flex items-center gap-1.5">
            <Orbit className="size-3.5 shrink-0" aria-hidden />
            {isScanning
              ? "Scanning…"
              : `Scanned ${pluralize(scan.tokens.length, "token")}${
                  nonFungibles.length > 0
                    ? ` + ${pluralize(nonFungibles.length, "NFT")}`
                    : ""
                } in ${scan.durationMs}ms`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void rescan()}
            disabled={isScanning || theVoid.isBusy}
            aria-label="Rescan wallet"
          >
            <RefreshCw
              className={isScanning ? "animate-spin" : undefined}
              aria-hidden
            />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Shown before a wallet is connected. Same security model up front as the
 * sweeper — this page also holds no keys.
 */
function VoidConnectPrompt() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="glass glass-sheen mx-auto mb-16 max-w-lg rounded-2xl p-8 text-center"
    >
      <VoidEmblem className="mx-auto size-28 sm:size-32" />

      <h2 className="mt-5 text-lg font-semibold tracking-tight">
        Connect your wallet to open The Void
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
        We scan for tokens with no route to SOL, USDC or JUP — the ones a swap
        can never reach — so you can send them into The Void and reclaim the
        rent locked in each account.
      </p>

      <ConnectWalletCta className="mt-6 w-full" />

      <ul className="mt-6 space-y-2 border-t border-border/60 pt-5 text-left">
        {[
          "You sign every transaction in your own wallet",
          "We never ask for a private key or seed phrase",
          `${(VOID_FEE_BPS / 100).toFixed(1)}% fee on reclaimed rent — shown before you sign`,
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
