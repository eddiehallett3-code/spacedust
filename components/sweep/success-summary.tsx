"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowUpRight,
  CheckCircle2,
  ExternalLink,
  Orbit,
  PartyPopper,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TokenLogo } from "@/components/scanner/token-logo";
import { solscanTxUrl } from "@/lib/solana/submit";
import { RECLAIM_RATE } from "@/lib/config/tools";
import {
  formatAmount,
  formatPercent,
  formatSol,
  formatUsd,
  pluralize,
  truncateAddress,
} from "@/lib/utils/format";
import type { SweepSummary, TokenOutcome } from "@/types/sweep";

/**
 * Post-sweep summary.
 *
 * Every figure comes from confirmed transaction results, not from the quote
 * shown before signing. Reporting the optimistic number here would be the
 * easiest dishonesty in this app, so we don't.
 */
export function SuccessSummary({
  summary,
  outcomes,
  onRetryFailed,
  voidCount,
  onEnterVoid,
  onSweepMore,
  onClose,
}: {
  summary: SweepSummary;
  outcomes: TokenOutcome[];
  /**
   * Rebuilds a plan for just the tokens whose transaction did not land.
   *
   * Offered instead of "run it again and reselect": a reverted swap changes no
   * balance, so the failed tokens are still in the wallet — what failed was the
   * timing, and rebuilding is the fix.
   */
  onRetryFailed: () => void;
  /**
   * Illiquid tokens still sitting in the wallet. Shown only after a real
   * sweep, because the suggested order is: swap first, The Void after.
   */
  voidCount: number;
  onEnterVoid: () => void;
  onSweepMore: () => void;
  onClose: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const isDryRun = summary.dryRun;
  const perfect = summary.failedCount === 0 && summary.successCount > 0;

  // Generated once per summary rather than on every render.
  const confetti = useMemo(
    () =>
      Array.from({ length: 28 }, (_, index) => ({
        id: index,
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 1.6 + Math.random() * 1.4,
        rotate: Math.random() * 360,
        color: ["#8b5cf6", "#22d3ee", "#a78bfa", "#34d399"][index % 4],
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summary.tokenCount, summary.successCount],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden"
    >
      {/* Celebration burst. Suppressed entirely for reduced-motion users. */}
      {!prefersReducedMotion && !isDryRun && perfect ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          {confetti.map((piece) => (
            <motion.span
              key={piece.id}
              className="absolute top-0 size-1.5 rounded-[1px]"
              style={{ left: piece.left + "%", backgroundColor: piece.color }}
              initial={{ y: -20, opacity: 0, rotate: 0 }}
              animate={{ y: 420, opacity: [0, 1, 1, 0], rotate: piece.rotate }}
              transition={{
                duration: piece.duration,
                delay: piece.delay,
                ease: "easeIn",
              }}
            />
          ))}
        </div>
      ) : null}

      <div className="relative flex flex-col items-center gap-2 text-center">
        <motion.span
          initial={{ scale: 0.5, rotate: -12 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.08, type: "spring", stiffness: 320, damping: 16 }}
          className="flex size-14 items-center justify-center rounded-2xl bg-linear-to-br from-emerald-400 to-emerald-300 shadow-[0_10px_40px_-10px_rgba(52,211,153,0.8)]"
        >
          {isDryRun ? (
            <CheckCircle2 className="size-7 text-emerald-950" aria-hidden />
          ) : (
            <PartyPopper className="size-7 text-emerald-950" aria-hidden />
          )}
        </motion.span>

        <h2 className="text-xl font-semibold tracking-tight">
          {isDryRun
            ? "Dry run complete"
            : perfect
              ? "Slingshot complete"
              : "Slingshot finished with issues"}
        </h2>
        <p className="text-sm text-muted">
          {isDryRun
            ? "Nothing was signed or sent. This is exactly what would have happened."
            : perfect
              ? `${pluralize(summary.successCount, "token")} swept in ${pluralize(summary.signatures.length, "transaction")}.`
              : `${summary.successCount} succeeded, ${summary.failedCount} failed. Your funds are safe.`}
        </p>
      </div>

      {/* Headline numbers */}
      <div className="relative mt-5 grid grid-cols-2 gap-2">
        <BigStat
          label={isDryRun ? "You would receive" : "You received"}
          value={formatAmount(summary.totalOutput, 8)}
          unit={summary.totalOutputSymbol}
          accent
        />
        <BigStat
          label="Dust recovered"
          value={formatUsd(summary.totalValueUsd)}
          hint={`${pluralize(summary.tokenCount, "token")} swept`}
        />
        <BigStat
          label="Rent reclaimed"
          value={formatSol(summary.rentReclaimedLamports)}
          hint={
            summary.reclaimFeeLamports > 0
              ? `after ${RECLAIM_RATE} fee — in your wallet`
              : "returned to your wallet"
          }
        />
        <BigStat
          label="Network fee"
          value={formatSol(summary.feeLamports)}
          hint={
            "no swap fee taken"
          }
        />
      </div>

      {/* Per-token results */}
      {!isDryRun && outcomes.length > 0 ? (
        <div className="relative mt-4 rounded-xl border border-border bg-white/2">
          <div className="border-b border-border/60 px-3 py-2 text-xs font-medium">
            Per-token results
          </div>
          <ul className="max-h-64 divide-y divide-border/40 overflow-y-auto">
            {outcomes.map((outcome) => (
              <li key={outcome.mint} className="flex items-center gap-2.5 px-3 py-2">
                {outcome.status === "success" ? (
                  <CheckCircle2
                    className="size-4 shrink-0 text-success"
                    aria-label="Success"
                  />
                ) : (
                  <XCircle
                    className="size-4 shrink-0 text-danger"
                    aria-label="Failed"
                  />
                )}
                <TokenLogo
                  src={outcome.logoUri}
                  symbol={outcome.symbol}
                  size={22}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {outcome.symbol}
                    {outcome.rentReclaimed ? (
                      <span className="ml-1.5 text-[10px] font-normal text-success">
                        rent reclaimed
                      </span>
                    ) : null}
                  </p>
                  {outcome.error ? (
                    <p
                      className="truncate text-[10px] text-danger/80"
                      title={outcome.error}
                    >
                      {outcome.error}
                    </p>
                  ) : (
                    <p className="truncate text-[10px] text-subtle">
                      {outcome.priceImpactPct != null
                        ? `${formatPercent(outcome.priceImpactPct, 2)} impact`
                        : "—"}
                      {outcome.routeLabels.length > 0
                        ? ` · ${outcome.routeLabels.join(" → ")}`
                        : ""}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-xs tabular-nums">
                    {outcome.outputAmountFormatted != null
                      ? formatAmount(outcome.outputAmountFormatted, 6)
                      : "—"}
                  </p>
                  <p className="text-[10px] text-subtle">
                    {formatUsd(outcome.valueUsd)}
                  </p>
                </div>
                {outcome.signature ? (
                  <a
                    href={solscanTxUrl(outcome.signature)}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="shrink-0 rounded-md p-1 text-subtle transition-colors hover:bg-white/8 hover:text-foreground"
                    aria-label={`View transaction on Solscan (${truncateAddress(outcome.signature, 4, 4)})`}
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Failures here are recoverable, and saying so plainly is the point.
          A reverted transaction changes no balance, so every failed token is
          still in the wallet with its rent still locked in its account. What
          went wrong was the timing — a quote that moved, a blockhash that
          expired while the wallet waited — and both are fixed by building the
          same tokens again. The retry previews first for the same reason the
          original run did: it gets its own routes and simulation before
          anything is signed. */}
      {!isDryRun && summary.failedCount > 0 ? (
        <div className="relative mt-4 flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/8 p-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <RotateCcw className="size-4 shrink-0 text-warning" aria-hidden />
              {pluralize(summary.failedCount, "token")} didn&apos;t go
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Nothing left your wallet. A fresh attempt rebuilds the routes and
              quotes, which is what fixes an expired blockhash or a price that
              moved mid-sign.
            </p>
          </div>
          <Button
            size="md"
            variant="outline"
            className="shrink-0"
            onClick={onRetryFailed}
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Retry {pluralize(summary.failedCount, "token")}
          </Button>
        </div>
      ) : null}

      {/* Transaction links */}
      {summary.signatures.length > 0 ? (
        <div className="relative mt-4 space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-subtle">
            Transactions
          </p>
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
                <ArrowUpRight className="size-3" aria-hidden />
                <span className="sr-only">View on Solscan</span>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {summary.routeLabels.length > 0 ? (
        <p className="relative mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-subtle">
          <span>Routed via</span>
          {summary.routeLabels.map((label) => (
            <Badge key={label} variant="muted" size="sm">
              {label}
            </Badge>
          ))}
        </p>
      ) : null}

      {/* The Void prompt: a nudge toward reclaiming rent from the wallet's
          unroutable remainder.

          Deliberately worded as a fact about the wallet, not as a report on the
          sweep. It used to say "N tokens could not be swapped", which read as a
          failure and directly contradicted the summary above it whenever every
          selected token had in fact swapped. */}
      {!isDryRun && voidCount > 0 ? (
        <div className="relative mt-4 flex flex-col gap-3 rounded-xl border border-violet-core/30 bg-violet-core/8 p-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Orbit className="size-4 shrink-0 text-violet-glow" aria-hidden />
              {pluralize(voidCount, "token")} Slingshot left behind
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              No price to value it, or no route to sell it — so the rent locked
              in each account is the only value left. The Void burns the balance
              and returns that rent to you.
            </p>
          </div>
          <Button
            size="md"
            variant="outline"
            className="shrink-0"
            onClick={onEnterVoid}
          >
            Open The Void
          </Button>
        </div>
      ) : null}

      <div className="relative mt-5 flex flex-col gap-2 sm:flex-row">
        {!isDryRun ? (
          <Button size="md" className="flex-1" onClick={onSweepMore}>
            Slingshot more dust
          </Button>
        ) : null}
        <Button
          size="md"
          variant={isDryRun ? "primary" : "outline"}
          className="flex-1"
          onClick={onClose}
        >
          {isDryRun ? "Back to Slingshot" : "Done"}
        </Button>
      </div>
    </motion.div>
  );
}

function BigStat({
  label,
  value,
  unit,
  hint,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-white/2 p-3">
      <p className="text-[10px] uppercase tracking-wide text-subtle">{label}</p>
      <p
        className={
          accent
            ? "mt-1 font-mono text-lg tabular-nums text-foreground"
            : "mt-1 font-mono text-base tabular-nums"
        }
      >
        {value}
        {unit ? <span className="ml-1 text-xs text-muted">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-0.5 text-[10px] text-subtle">{hint}</p> : null}
    </div>
  );
}
