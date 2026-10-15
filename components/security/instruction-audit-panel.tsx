"use client";

import { AlertTriangle, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatSol, pluralize } from "@/lib/utils/format";
import type { AuditResult } from "@/lib/security/instruction-audit";

/**
 * What is inside the transaction, in the user's own terms.
 *
 * The simulation report next to this one says whether the batch *works*. This
 * says what it *does* — every program it touches, what each is doing, and the
 * two facts worth knowing before signing anything: no instruction in this batch
 * can grant a delegation or change an authority, and the only SOL leaving the
 * wallet is the fee named here.
 *
 * It is rendered from the result of the audit that already ran as a gate, not
 * from a second opinion: a plan that failed the audit never reaches this
 * component, because it throws before anything is shown. So everything below is
 * the reach of the check, stated plainly rather than as a promise.
 */
export function InstructionAuditPanel({ audit }: { audit: AuditResult }) {
  const warnings = audit.findings.filter(
    (finding) => finding.severity === "warn",
  );
  const total = audit.calls.reduce((sum, call) => sum + call.count, 0);

  return (
    <div className="rounded-xl border border-border bg-white/2">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <Lock className="size-3.5 text-success" aria-hidden />
          What you are about to sign
        </span>
        <Badge variant="success" size="sm">
          {pluralize(total, "instruction")} checked
        </Badge>
      </div>

      <ul className="divide-y divide-border/40">
        {audit.calls.map((call) => (
          <li
            key={call.programId}
            className="flex items-start gap-3 px-3 py-2 text-xs"
          >
            <span className="min-w-0 flex-1">
              <span className="font-medium">{call.programName}</span>
              {call.notes.length > 0 ? (
                <span className="block text-[11px] leading-relaxed text-muted">
                  {call.notes.join(" · ")}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-subtle">
              ×{call.count}
            </span>
          </li>
        ))}
      </ul>

      <p className="border-t border-border/60 px-3 py-2 text-[11px] leading-relaxed text-muted">
        Checked against what this plan said it would do, before your wallet was
        asked: every program above is one this flow uses, nothing here can grant
        a delegation or change an authority, and{" "}
        {audit.feeLamports > 0 ? (
          <>
            the only SOL leaving your wallet is the{" "}
            <span className="font-mono text-foreground">
              {formatSol(audit.feeLamports)}
            </span>{" "}
            fee.
          </>
        ) : (
          "no SOL leaves your wallet."
        )}
      </p>

      {warnings.length > 0 ? (
        <ul className="flex flex-col gap-1.5 border-t border-border/60 px-3 py-2">
          {warnings.map((finding, index) => (
            <li
              key={`${finding.code}-${index}`}
              className="flex items-start gap-2 text-[11px] leading-relaxed text-warning"
            >
              <AlertTriangle
                className="mt-0.5 size-3 shrink-0"
                aria-hidden
              />
              <span>{finding.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
