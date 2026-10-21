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
          "cursor-pointer select-none text-[11px] font-medium leading-none transition-colors",
          isPro ? "text-violet-glow" : "text-muted",
        )}
      >
        Pro
      </label>
    </div>
  );
}
