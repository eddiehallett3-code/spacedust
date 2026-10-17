"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronDown, Info, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { SimulationReport } from "./simulation-report";
import { InstructionAuditPanel } from "@/components/security/instruction-audit-panel";
import { WarningsList } from "./warnings-list";
import { getPublicFeeWallet } from "@/lib/config/public-env";
import { RECLAIM_RATE } from "@/lib/config/tools";
import { receiveFigures } from "@/lib/sweep/receive";
import { OUTPUT_ASSETS } from "@/lib/utils/constants";
import { cn } from "@/lib/utils/cn";
import { formatAmount, formatSol, formatUsd, pluralize } from "@/lib/utils/format";
import type { AuditResult } from "@/lib/security/instruction-audit";
import type {
  OutputAsset,
  PackedTransaction,
  SimulationOutcome,
  SweepPhase,
} from "@/types/sweep";

/**
 * The action panel.
 *
 * The flow is deliberately two-step — *preview*, then *sign* — because the
 * preview is produced by the exact same code path that will submit. Nothing is
 * signed until the user has seen real simulation results for the real bytes.
 */
export function SweepPanel({
  phase,
  outputAsset,
  selectedTokens,
  totalValueUsd,
  expectedOutput,
  packed,
  simulations,
  audit,
  warnings,
  hasPreview,
  isBusy,
  disabled,
  grossRentLamports,
  reclaimFeeLamports,
  onPreview,
  onSweep,
  onReset,
  onRescan,
}: {
  phase: SweepPhase;
  /** Which asset the swaps pay out in: the hero's unit, and whether rent joins it. */
  outputAsset: OutputAsset;
  selectedTokens: number;
  totalValueUsd: number;
  /**
   * Expected swap output across the plan's builds, in whole units of
   * `outputAsset`. Zero until a preview exists — which is what makes the hero
   * show what is selected instead of what will arrive.
   */
  expectedOutput: number;
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  /** The result of the instruction audit, shown beside the simulation report. */
  audit: AuditResult | null;
  warnings: string[];
  hasPreview: boolean;
  isBusy: boolean;
  disabled: boolean;
  /**
   * Rent this batch's closes return, totalled by the planner from each account's
   * own verified deposit.
   */
  grossRentLamports: number;
  /** The Spacedust fee on that rent. Zero when fees are off. */
  reclaimFeeLamports: number;
  onPreview: () => void;
  onSweep: () => void;
  onReset: () => void;
  onRescan: () => void;
}) {
  // Totals from the plan, which read each account's own deposit. A single
  // per-account figure multiplied by the count used to stand here, and it
  // understated both the rent and the fee on any account larger than a 165-byte
  // legacy one — or older than the network's last rent change. Shown net, because
  // the gross is not what lands.
  const rentLamports = grossRentLamports - reclaimFeeLamports;
  // Whether the copy below states a fee. Read from the public config rather than
  // from the plan's own per-account figure, so the sentence describes what this
  // deployment charges before any preview exists — the same way The Void's panel
  // decides it. A configured-but-unfunded wallet charges nothing, and the plan
  // says so in a warning beside this.
  const rentFeeConfigured = getPublicFeeWallet() !== null;
  const feeLamports = simulations.reduce(
    (sum, simulation) => sum + (simulation.feeLamports ?? 0),
    0,
  );
  const okCount = simulations.filter((s) => s.ok).length;

  // The hero's figures. See `lib/sweep/receive.ts` for why the swap amount is net
  // of the fee and why rent only joins the headline when the payout is in SOL.
  const output = OUTPUT_ASSETS[outputAsset];
  const { swapOutput, headline } = receiveFigures({
    expectedOutput,
    rentLamports,
    outputAsset,
  });

  return (
    <div className="flex flex-col gap-4">
      {/* The one number that matters.
          Before a preview it is what is selected; after one it is what lands,
          rent included — because rent is SOL whether or not the swaps were into
          SOL. Everything below it is a smaller fact about it. The four tiles
          that used to sit here gave it equal billing with three dashes and a
          fee table, which left the reader to work out what to care about. */}
      <div
        className={cn(
          "rounded-xl border p-3.5",
          hasPreview
            ? "border-violet-core/35 bg-violet-core/8"
            : "border-border bg-white/2",
        )}
      >
        <p className="text-[10px] uppercase tracking-wide text-subtle">
          {hasPreview ? "You'll receive" : "Dust selected"}
        </p>
        <p className="mt-1 flex items-baseline gap-1.5 font-mono tabular-nums">
          <span className="text-2xl text-foreground">
            {hasPreview ? `≈ ${formatAmount(headline, 5)}` : formatUsd(totalValueUsd)}
          </span>
          {hasPreview ? (
            <span className="text-sm text-muted">{output.symbol}</span>
          ) : null}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          {hasPreview
            ? outputAsset === "SOL"
              ? `${formatAmount(swapOutput, 5)} from swaps · ${formatSol(rentLamports)} rent back, after fees`
              : `≈ ${formatAmount(swapOutput, 5)} ${output.symbol} from swaps, plus ${formatSol(rentLamports)} SOL rent back`
            : `${pluralize(selectedTokens, "token")} selected · preview to see what comes back`}
        </p>
      </div>

      {hasPreview ? (
        <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-subtle">
          <span>{pluralize(selectedTokens, "token")}</span>
          <span aria-hidden>·</span>
          <span>{pluralize(packed.length, "approval")}</span>
          <span aria-hidden>·</span>
          <span>{formatSol(feeLamports)} network fee</span>
        </p>
      ) : null}

      {/* The evidence stays, folded away.
          The simulation output and the instruction audit are what make this app
          trustworthy, and neither is what somebody needs in order to decide. One
          click away rather than removed — and the verdict stays on the summary
          line, so a failure is never hidden behind a disclosure. */}
      {hasPreview && simulations.length > 0 ? (
        <details className="group rounded-xl border border-border bg-white/2">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium [&::-webkit-details-marker]:hidden">
            <ShieldCheck className="size-3.5 shrink-0 text-success" aria-hidden />
            <span className="flex-1">Simulation &amp; what you&apos;ll sign</span>
            <Badge
              variant={okCount === simulations.length ? "success" : "warning"}
              size="sm"
            >
              {okCount}/{simulations.length} passed
            </Badge>
            <ChevronDown
              className="size-3.5 shrink-0 text-subtle transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="flex flex-col gap-2 border-t border-border/60 p-2">
            <SimulationReport
              packed={packed}
              simulations={simulations}
              okCount={okCount}
            />
            {audit ? <InstructionAuditPanel audit={audit} /> : null}
          </div>
        </details>
      ) : null}

      <AnimatePresence>
        {warnings.length > 0 ? (
          <motion.div
            key="warn"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <WarningsList warnings={warnings} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <p className="flex items-start gap-2 rounded-xl border border-success/20 bg-success/6 px-3 py-2.5 text-[11px] leading-relaxed text-emerald-200/90">
        <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          Non-custodial — you sign every transaction in your own wallet, and
          Spacedust can never move your funds.
        </span>
      </p>
<div className="flex flex-col gap-2">
        {hasPreview ? (
          <Button
            size="lg"
            onClick={onSweep}
            disabled={disabled || isBusy}
            loading={
              phase === "awaiting-signature" ||
              phase === "submitting" ||
              phase === "confirming"
            }
            loadingText={
              phase === "confirming" ? "Confirming…" : "Check your wallet…"
            }
            className="w-full"
          >
            Sign &amp; send {pluralize(selectedTokens, "swap")}
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={onPreview}
            disabled={disabled || isBusy}
            loading={phase === "planning" || phase === "simulating"}
            loadingText={
              phase === "simulating" ? "Simulating…" : "Building routes…"
            }
            className="w-full"
          >
            Preview &amp; simulate
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        )}

        <div className="flex gap-2">
          {hasPreview ? (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={onReset}
              disabled={isBusy}
            >
              Change selection
            </Button>
          ) : null}
          <Tooltip content="Re-scan the wallet to pick up any balance changes">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1"
              onClick={onRescan}
              disabled={isBusy}
            >
              Rescan wallet
            </Button>
          </Tooltip>
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-subtle">
        <Info className="mt-px size-3 shrink-0" aria-hidden />
        <span>
          {rentFeeConfigured ? (
            <>
              Reclaimed rent is returned to your wallet, less Spacedust&apos;s{" "}
              {RECLAIM_RATE} fee on it — taken from that rent, so a swap that
              reclaims nothing costs nothing extra.
            </>
          ) : (
            <>Reclaimed rent is returned to your wallet in full.</>
          )}
        </span>
      </p>
    </div>
  );
}
