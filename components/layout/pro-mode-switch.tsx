"use client";

import { Switch } from "@/components/ui/switch";
import { useMode } from "@/components/layout/mode-provider";
import { cn } from "@/lib/utils/cn";

/**
 * The one control for the site-wide interface depth.
 *
 * Off is Basic (the default); on is Pro. It is deliberately just a switch and
 * a right-hand label: there is no separate "Basic" wording to explain, and the
 * wallet area already gives the navbar enough to carry.
 */
export function ProModeSwitch({ className }: { className?: string }) {
  const { isPro, setMode } = useMode();

  return (
    <div
      className={cn("flex shrink-0 items-center gap-1.5", className)}
      title="Pro mode: show deep cNFTs and advanced controls"
    >
      <Switch
        id="pro-mode"
        checked={isPro}
        onCheckedChange={(checked) => setMode(checked ? "pro" : "basic")}
        aria-label="Pro mode"
      />
      <label
        htmlFor="pro-mode"
        className={cn(
          "cursor-pointer select-none text-2xs font-medium leading-none transition-colors",
          isPro ? "text-brand-glow" : "text-muted",
        )}
      >
        Pro
      </label>
    </div>
  );
}

/**
 * The same switch, with a line saying what it turns on.
 *
 * The navbar used to carry this, which put a mode toggle beside the wallet button
 * on every page — including the ones where it changes nothing visible. A control
 * that needs a sentence beside it belongs next to the thing it affects, so it now
 * appears at the top of the three tools that have Pro-only panels, and nowhere
 * else.
 */
export function ProModeToggleRow({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-white/[0.02] px-3 py-2",
        className,
      )}
    >
      <span className="text-2xs leading-relaxed text-muted">
        Pro mode — deeper cNFT lists, SNS names and sweep history
      </span>
      <ProModeSwitch />
    </div>
  );
}
