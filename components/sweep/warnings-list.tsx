"use client";

import { FileWarning } from "lucide-react";
import { pluralize } from "@/lib/utils/format";

/**
 * Skipped tokens.
 *
 * A dust sweeper that silently drops half a wallet looks broken. We always say
 * what was skipped and why — "no liquidity" is a legitimate outcome for dust,
 * but it must never be invisible.
 */
export function WarningsList({
  warnings,
  unitLabel = "token",
}: {
  warnings: string[];
  /** What a skipped unit is: a "token" in Slingshot, an "approval" here. */
  unitLabel?: string;
}) {
  if (warnings.length === 0) return null;

  return (
    <details className="rounded-xl border border-warning/25 bg-warning/6 px-3 py-2.5">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-warning">
        <FileWarning className="size-3.5 shrink-0" aria-hidden />
        {pluralize(warnings.length, unitLabel)} skipped
        <span className="ml-auto text-[11px] font-normal text-subtle">
          tap to review
        </span>
      </summary>
      <ul className="mt-2 space-y-1 border-t border-warning/15 pt-2 text-[11px] text-muted">
        {warnings.slice(0, 12).map((warning, index) => (
          <li key={index} className="flex gap-1.5">
            <span aria-hidden>•</span>
            <span className="min-w-0 break-words">{warning}</span>
          </li>
        ))}
        {warnings.length > 12 ? (
          <li className="text-subtle">…and {warnings.length - 12} more</li>
        ) : null}
      </ul>
    </details>
  );
}