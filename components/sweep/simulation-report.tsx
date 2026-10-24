"use client";

import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { pluralize } from "@/lib/utils/format";
import type { PackedTransaction, SimulationOutcome } from "@/types/sweep";

/**
 * Per-transaction simulation results.
 *
 * This is the screen that gives the user real confidence: the exact bytes that
 * will be signed, and the validator's verdict on each one, before anything is
 * approved. `unitsConsumed` and the byte count also let a technical user sanity
 * check that nothing unexpected was packed in.
 */
export function SimulationReport({
  packed,
  simulations,
  okCount,
  unitLabel = "swap",
}: {
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  okCount: number;
  /** What each packed instruction unit does: a "swap" or a "burn". */
  unitLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-white/2">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <ShieldCheck className="size-3.5 text-success" aria-hidden />
          Simulation results
        </span>
        <Badge
          variant={okCount === simulations.length ? "success" : "warning"}
          size="sm"
        >
          {okCount}/{simulations.length} passed
        </Badge>
      </div>

      <ul className="divide-y divide-border/40">
        {packed.map((tx) => {
          const sim = simulations.find((s) => s.index === tx.index);
          return (
            <li key={tx.index} className="flex items-center gap-3 px-3 py-2 text-xs">
              {sim?.ok ? (
                <CheckCircle2
                  className="size-4 shrink-0 text-success"
                  aria-label="Passed"
                />
              ) : (
                <AlertTriangle
                  className="size-4 shrink-0 text-warning"
                  aria-label="Failed"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  Transaction {tx.index + 1}
                  <span className="ml-1.5 font-normal text-subtle">
                    · {pluralize(tx.mints.length, unitLabel)}
                  </span>
                </p>
                {sim?.ok ? (
                  <p className="truncate text-subtle">
                    {tx.sizeBytes} bytes · {tx.instructionCount} instructions
                    {sim.unitsConsumed
                      ? ` · ${sim.unitsConsumed.toLocaleString()} CU`
                      : ""}
                  </p>
                ) : (
                  <p className="truncate text-warning/90">
                    {sim?.error ?? "Unknown simulation error"}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {packed.length > 1 ? (
        // Stated before signing, not discovered at the wallet. Phantom shows its
        // transaction warning on the second of two approval requests while the
        // identical sweep in one transaction passes without one, and a user who
        // meets that unannounced reasonably concludes something is wrong.
        <p className="border-t border-border/40 px-3 py-2 text-[11px] leading-relaxed text-subtle">
          {packed.length} transactions, so your wallet will ask you to approve
          each one separately. They carry the same instructions as a
          single-transaction sweep — a wallet that warns on the second approval is
          flagging the repetition, not the contents.
        </p>
      ) : null}
    </div>
  );
}