"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Coins,
  Gauge,
  Info,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { SimulationReport } from "./simulation-report";
import { InstructionAuditPanel } from "@/components/security/instruction-audit-panel";
import { WarningsList } from "./warnings-list";
import { formatSol, formatUsd, pluralize } from "@/lib/utils/format";
import type { AuditResult } from "@/lib/security/instruction-audit";
import type {
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
  selectedTokens,
  totalValueUsd,
  packed,
  simulations,
  audit,
  warnings,
  hasPreview,
  isBusy,
  disabled,
  feeBps,
  rentLamportsPerAccount,
  onPreview,
  onSweep,
  onReset,
  onRescan,
}: {
  phase: SweepPhase;
  selectedTokens: number;
  totalValueUsd: number;
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  /** The result of the instruction audit, shown beside the simulation report. */
  audit: AuditResult | null;
  warnings: string[];
  hasPreview: boolean;
  isBusy: boolean;
  disabled: boolean;
  /** Integrator fee applied to this plan, in basis points. 0 = no fee. */
  feeBps: number;
  /**
   * Rent-exempt minimum for one token account, taken from the plan that built
   * these transactions — never a constant, so a change to the network's rent
   * rate cannot make this label lie.
   */
  rentLamportsPerAccount: number;
  onPreview: () => void;
  onSweep: () => void;
  onReset: () => void;
  onRescan: () => void;
}) {
  const rentMints = new Set(packed.flatMap((tx) => tx.rentReclaimMints));
  const rentLamports = rentMints.size * rentLamportsPerAccount;
  const feeLamports = simulations.reduce(
    (sum, simulation) => sum + (simulation.feeLamports ?? 0),
    0,
  );
  const okCount = simulations.filter((s) => s.ok).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          icon={<Coins className="size-3.5" aria-hidden />}
          label="Dust selected"
          value={formatUsd(totalValueUsd)}
          accent
        />
        <Stat
          icon={<Gauge className="size-3.5" aria-hidden />}
          label="Rent reclaimable"
          value={hasPreview ? formatSol(rentLamports) : "—"}
          hint={hasPreview ? `from ${pluralize(rentMints.size, "account")}` : "run preview"}
          accent={rentLamports > 0}
        />
        <Stat
          icon={<Zap className="size-3.5" aria-hidden />}
          label="Transactions"
          value={hasPreview ? String(packed.length) : "—"}
          hint={
            hasPreview
              ? packed.length === 1
                ? "single approval"
                : pluralize(packed.length, "approval")
              : undefined
          }
          accent={hasPreview && packed.length === 1}
        />
        <Stat
          icon={<Wallet className="size-3.5" aria-hidden />}
          label="Network fee"
          value={hasPreview ? formatSol(feeLamports) : "—"}
          hint={hasPreview ? "estimated" : undefined}
        />
      </div>

      {/* The integrator fee is charged inside the swap instruction, in the
          output asset, so it is not part of the network fee above. Stated up
          front rather than buried in the summary. */}
      {feeBps > 0 ? (
        <p className="text-[11px] leading-relaxed text-subtle">
          Includes a {(feeBps / 100).toFixed(1)}% Spacedust fee, taken from the
          swapped output — not from your network fee.
        </p>
      ) : null}

      <AnimatePresence mode="wait">
        {hasPreview ? (
          <motion.div
            key="sim"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <SimulationReport
              packed={packed}
              simulations={simulations}
              okCount={okCount}
            />
            {audit ? <InstructionAuditPanel audit={audit} /> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

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
          This is <strong>non-custodial</strong>. You sign every transaction in
          your own wallet. Spacedust never sees your private key and can never
          move your funds on its own.
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
          Reclaimed rent is returned to your wallet. Spacedust never takes a
          cut.
        </span>
      </p>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-white/2 p-2.5">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-subtle">
        <span className={accent ? "text-violet-glow" : undefined}>{icon}</span>
        <span className="truncate">{label}</span>
      </p>
      <p
        className={
          accent
            ? "mt-1 font-mono text-sm tabular-nums"
            : "mt-1 font-mono text-sm tabular-nums text-muted"
        }
      >
        {value}
      </p>
      {hint ? <p className="truncate text-[10px] text-subtle">{hint}</p> : null}
    </div>
  );
}