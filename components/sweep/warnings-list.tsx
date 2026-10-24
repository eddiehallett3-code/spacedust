"use client";

import { FileWarning } from "lucide-react";
import { pluralize } from "@/lib/utils/format";

/**
 * Warnings for this run.
 *
 * Not everything here is a skipped unit. "No liquidity" means a token was left
 * out; "rent reclaim skipped — only part of the balance is being swapped" means
 * the swap happens and the *rent* stays locked. Counting both as "tokens skipped"
 * told users two tokens had been dropped when both were being swapped, so the
 * header describes the list rather than assuming.
 */
export function WarningsList({
  warnings,
  unitLabel = "token",
}: {
  warnings: string[];
  /** What a unit is: a "token" in Slingshot, an "approval" here. */
  unitLabel?: string;
}) {
  if (warnings.length === 0) return null;

  return (
    <details
      className="rounded-xl border border-warning/25 bg-warning/6 px-3 py-2.5"
      aria-label={`${pluralize(warnings.length, unitLabel)} to review`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-warning">
        <FileWarning className="size-3.5 shrink-0" aria-hidden />
        {pluralize(warnings.length, "item")} to review
        <span className="ml-auto text-[11px] font-normal text-subtle">
          details
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