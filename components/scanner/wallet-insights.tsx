"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ArrowRight,
  ChartPie,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, SectionTitle } from "@/components/ui/card";
import { NftArtwork } from "@/components/void/nft-artwork";
import { TokenLogo } from "@/components/scanner/token-logo";
import { formatSol, formatUsd, pluralize } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { RecoverableBreakdown } from "@/lib/sweep/recoverable";
import type { WalletScan } from "@/types/token";

/**
 * What else the scan knows.
 *
 * The headline above this answers "what would a sweep bring back". These answer
 * the questions someone actually has when they look at a wallet they do not
 * recognise: *where* is the value, is any of it moving, what is in here that a
 * sweep will refuse, and is the number mostly rent or mostly tokens.
 *
 * Everything comes from the scan already in hand — no extra requests, no estimate
 * beyond the ones the breakdown itself records, and no chart for the sake of having
 * one. Each section hides when the wallet has nothing to show in it, because an
 * empty chart is worse than no chart.
 *
 * The graphics are hand-drawn: CSS widths for the bars, one small SVG for the
 * diverging price chart. This app has no charting dependency and the rest of its
 * artwork is hand-drawn too. Every figure carries its own label, so nothing depends
 * on reading a shape accurately.
 */
export function WalletInsights({
  scan,
  recoverable,
}: {
  scan: WalletScan;
  recoverable: RecoverableBreakdown;
}) {
  const tokens = scan.tokens;

  /** Priced holdings, largest first — the shape of the wallet. */
  const byValue = useMemo(
    () =>
      tokens
        .filter((token) => token.valueUsd > 0)
        .sort((a, b) => b.valueUsd - a.valueUsd),
    [tokens],
  );

  const shown = byValue.slice(0, 7);
  const restValue = byValue.slice(7).reduce((sum, token) => sum + token.valueUsd, 0);
  const largest = shown[0]?.valueUsd ?? 0;

  /**
   * The holdings whose price has moved most in 24 hours.
   *
   * Sorted by the *size* of the move rather than its direction: in a wallet nobody
   * recognises, a token down 40% and one up 40% are equally worth seeing.
   */
  const movers = useMemo(
    () =>
      tokens
        .filter((token) => token.priceChange24h !== null && token.valueUsd > 0)
        .sort(
          (a, b) =>
            Math.abs(b.priceChange24h ?? 0) - Math.abs(a.priceChange24h ?? 0),
        )
        .slice(0, 6),
    [tokens],
  );
  const biggestMove = Math.max(
    ...movers.map((token) => Math.abs(token.priceChange24h ?? 0)),
    1,
  );

  const priced = tokens.filter((token) => !token.hasNoPrice).length;
  const token2022 = tokens.filter((token) => token.program === "token2022").length;
  const frozen = tokens.filter((token) => token.frozen).length;

  const nfts = scan.nonFungibles;
  const withArt = nfts.filter((asset) => asset.imageUri !== null).slice(0, 8);
  const collections = new Set(
    nfts.map((asset) => asset.collection?.address).filter(Boolean),
  ).size;
  const compressed = nfts.filter((asset) => asset.compressed).length;

  // The two halves of the headline, side by side. Rent is only convertible when
  // there is a SOL price; without one the bar would be mixing units, so it is left
  // out and the rent stays in SOL where it already is.
  const rentUsd = recoverable.rentUsd;
  const dustUsd = recoverable.sweepableValueUsd;
  const split =
    rentUsd !== null && rentUsd + dustUsd > 0
      ? rentUsd / (rentUsd + dustUsd)
      : null;

  return (
    <div className="flex flex-col gap-4">
      {split !== null ? (
        <Card>
          <CardHeader>
            <SectionTitle
              icon={<ChartPie className="size-4" aria-hidden />}
              title="What the total is made of"
              description="Dust value against the rent the accounts are holding."
            />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div
              className="flex h-3 w-full overflow-hidden rounded-full bg-white/6"
              role="img"
              aria-label={`${formatUsd(dustUsd)} in tokens and ${formatUsd(rentUsd)} in rent`}
            >
              <span
                className="h-full bg-linear-to-r from-violet-core to-cyan-core"
                style={{ width: `${(1 - split) * 100}%` }}
              />
              <span
                className="h-full bg-linear-to-r from-emerald-500/60 to-emerald-400/60"
                style={{ width: `${split * 100}%` }}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Legend
                swatch="bg-linear-to-r from-violet-core to-cyan-core"
                label="Token value"
                value={formatUsd(dustUsd)}
                hint={`${pluralize(priced, "priced token")} of ${tokens.length}`}
              />
              <Legend
                swatch="bg-linear-to-r from-emerald-500/60 to-emerald-400/60"
                label="Recoverable rent"
                value={formatUsd(rentUsd)}
                hint={pluralize(
                  recoverable.closableAccounts + recoverable.emptyAccounts,
                  "account",
                )}
              />
            </div>

            {split > 0.5 ? (
              <p className="flex items-start gap-1.5 rounded-xl border border-border bg-white/2 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
                <Sparkles
                  className="mt-px size-3.5 shrink-0 text-violet-glow"
                  aria-hidden
                />
                <span>
                  Most of what is recoverable here is rent rather than the tokens
                  themselves — the usual shape for an old wallet, and the reason
                  closing accounts is worth doing even when the dust is worthless.
                </span>
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {movers.length > 0 ? (
        <Card>
          <CardHeader>
            <SectionTitle
              icon={<TrendingUp className="size-4" aria-hidden />}
              title="Biggest moves in 24 hours"
              description="Out of the holdings that carry a price."
            />
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {/* A diverging bar chart, drawn in CSS: the row is split at the middle
                and each bar grows out from that centre line, so direction is the
                sign and length is the size of the move. Both are also printed, so
                the chart never has to be read precisely. */}
            {movers.map((token) => {
              const change = token.priceChange24h ?? 0;
              const up = change >= 0;
              return (
                <div key={token.mint} className="flex items-center gap-3">
                  <span className="flex w-24 shrink-0 items-center gap-1.5">
                    {up ? (
                      <TrendingUp
                        className="size-3 shrink-0 text-emerald-300"
                        aria-hidden
                      />
                    ) : (
                      <TrendingDown
                        className="size-3 shrink-0 text-rose-300"
                        aria-hidden
                      />
                    )}
                    <span className="truncate text-xs">
                      {token.symbol || token.name}
                    </span>
                  </span>

                  <span
                    className="relative flex h-4 min-w-0 flex-1 items-center"
                    role="img"
                    aria-label={`${token.symbol || token.name} ${up ? "up" : "down"} ${Math.abs(change).toFixed(2)}% in 24 hours`}
                  >
                    <span
                      className="absolute left-1/2 h-3 w-px bg-white/12"
                      aria-hidden
                    />
                    <span
                      className={cn(
                        "absolute h-2 rounded-full",
                        up ? "left-1/2 bg-emerald-400/70" : "right-1/2 bg-rose-400/70",
                      )}
                      style={{ width: `${(Math.abs(change) / biggestMove) * 50}%` }}
                    />
                  </span>

                  <span
                    className={cn(
                      "w-16 shrink-0 text-right font-mono text-xs tabular-nums",
                      up ? "text-emerald-300" : "text-rose-300",
                    )}
                  >
                    {up ? "+" : ""}
                    {change.toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {shown.length > 0 ? (
        <Card>
          <CardHeader>
            <SectionTitle
              title="Where the value is"
              description="The largest priced holdings, against the biggest one."
            />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {shown.map((token) => (
              <div key={token.mint} className="flex items-center gap-3">
                <TokenLogo src={token.logoUri} symbol={token.symbol} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm">
                      {token.symbol || token.name}
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                      {formatUsd(token.valueUsd)}
                    </span>
                  </div>
                  <div
                    className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/6"
                    role="img"
                    aria-label={`${token.symbol} is ${Math.round((token.valueUsd / (largest || 1)) * 100)}% of the largest holding`}
                  >
                    <span
                      className="block h-full bg-linear-to-r from-violet-core to-cyan-core"
                      style={{ width: `${largest > 0 ? (token.valueUsd / largest) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}

            {restValue > 0 ? (
              <p className="text-[11px] text-subtle">
                {pluralize(byValue.length - shown.length, "smaller holding")} worth{" "}
                {formatUsd(restValue)} between them, not shown.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <SectionTitle
            title="What is in here"
            description="Every holding the scan saw, and what a sweep would do with it."
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Count label="Holdings" value={tokens.length} hint="fungible tokens" />
            <Count
              label="Priced"
              value={priced}
              hint={`${tokens.length - priced} with no price`}
            />
            <Count
              label="Frozen"
              value={frozen}
              hint="cannot be moved at all"
            />
            <Count
              label="Token-2022"
              value={token2022}
              hint={`${tokens.length - token2022} legacy SPL`}
            />
          </div>

          {/* The one figure here that is about *value* rather than count: what a
              sweep would refuse to sell, which is the gap between everything held
              and what it can actually move. */}
          {recoverable.heldValueUsd > recoverable.sweepableValueUsd ? (
            <p className="rounded-xl border border-border bg-white/2 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
              <span className="font-mono text-foreground">
                {formatUsd(recoverable.heldValueUsd - recoverable.sweepableValueUsd)}
              </span>{" "}
              of this wallet is in holdings a sweep will not sell — frozen, or
              behind a transfer hook — so it is listed and never counted as
              recoverable.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {nfts.length > 0 ? (
        <Card>
          <CardHeader>
            <SectionTitle
              title="Non-fungibles"
              description="Never swept as dust: burning one is an explicit choice."
            />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="accent" size="md">
                {pluralize(nfts.length, "NFT")}
              </Badge>
              {compressed > 0 ? (
                <Badge variant="muted" size="md">
                  {compressed} compressed
                </Badge>
              ) : null}
              {nfts.length - compressed > 0 ? (
                <Badge variant="muted" size="md">
                  {nfts.length - compressed} on chain
                </Badge>
              ) : null}
              {collections > 0 ? (
                <Badge variant="muted" size="md">
                  {pluralize(collections, "collection")}
                </Badge>
              ) : null}
            </div>

            {withArt.length > 0 ? (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {withArt.map((asset) => (
                  <NftArtwork key={asset.id} src={asset.imageUri} />
                ))}
              </div>
            ) : null}

            <Link
              href="/void"
              className="inline-flex w-fit items-center gap-1 text-xs text-violet-glow transition-colors hover:text-violet-core"
            >
              Reclaim the rent their accounts are holding
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {/* Where these numbers came from. Worth stating on a page whose whole point
          is being checkable: the source, how long ago, and the basis every rent
          figure was priced at. */}
      <p className="px-1 text-[11px] leading-relaxed text-subtle">
        Read {Math.round(scan.durationMs)}ms ago through{" "}
        {scan.source === "helius-das" ? "Helius's DAS index" : "the free core RPC"},
        across {pluralize(scan.pages, "page")}
        {scan.truncated ? ", truncated where the provider stopped" : ""}. Rent is
        priced at {formatSol(scan.tokenAccountRentLamports)} per account
        {recoverable.solPriceUsd !== null
          ? `, converted at SOL = ${formatUsd(recoverable.solPriceUsd)}`
          : ""}
        .
      </p>
    </div>
  );
}

/** One count with its own label — this page never shows a bare number. */
function Count({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-white/2 p-3">
      <p className="text-[11px] text-subtle">{label}</p>
      <p className="mt-0.5 font-mono text-base tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{hint}</p>
    </div>
  );
}

/** One colour swatch with its own figure — the key to a bar above it. */
function Legend({
  swatch,
  label,
  value,
  hint,
}: {
  swatch: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={cn("mt-1 size-3 shrink-0 rounded-full", swatch)} />
      <span className="min-w-0">
        <span className="block text-xs text-muted">{label}</span>
        <span className="block font-mono text-sm tabular-nums">{value}</span>
        <span className="block text-[11px] text-subtle">{hint}</span>
      </span>
    </div>
  );
}
