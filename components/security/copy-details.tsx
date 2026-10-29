"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * "Copy details" — the machine-readable half of a failure, on the clipboard.
 *
 * Some refusals are explained in a sentence and diagnosed in a page: which rule
 * fired, on which program, at which instruction. The sentence is what a person
 * reads; this is what they paste when they need help, and it exists so nobody has
 * to retype a paragraph from a screenshot.
 *
 * A native button rather than the shared `Button`: it sits inside an error banner
 * as tertiary text, and the variants there are all too loud for an escape hatch.
 * Clipboard access can be refused (an insecure context, or a permission); that is
 * reported rather than swallowed, because a "Copied" that copied nothing is worse
 * than a visible failure.
 */
export function CopyDetails({
  detail,
  label = "Copy details",
}: {
  detail: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(detail);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2400);
  };

  const Icon = state === "copied" ? Check : Copy;
  const text =
    state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label;

  return (
    <button
      type="button"
      onClick={copy}
      className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2 py-1 text-[11px] text-muted transition-colors hover:border-border hover:text-foreground"
    >
      <Icon className="size-3" aria-hidden />
      {text}
      <span className="sr-only">
        : the full refusal as text, to paste into a report
      </span>
    </button>
  );
}
