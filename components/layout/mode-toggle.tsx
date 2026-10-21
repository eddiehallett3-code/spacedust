"use client";

import { Gauge, Sparkles } from "lucide-react";
import { useMode } from "@/components/layout/mode-provider";
import { cn } from "@/lib/utils/cn";

/**
 * Site-wide Basic/Pro switch.
 *
 * Deliberately small: it changes how much of the interface is exposed, not
 * whether anything on chain is safe. Basic is the default; Pro keeps the deep
 * cNFT flow and the more detailed controls visible.
 */
export function ModeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useMode();

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border/70 bg-black/20 p-1 pl-3 backdrop-blur",
        className,
      )}
      role="group"
      aria-label="Interface mode"
    >
      <span className="text-[11px] text-subtle">Mode</span>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          aria-pressed={mode === "basic"}
          onClick={() => setMode("basic")}
          title="Hide deep cNFT burns and the more advanced controls"
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
            mode === "basic"
              ? "bg-white/10 text-foreground"
              : "text-muted hover:text-foreground",
          )}
        >
          <Gauge className="size-3" aria-hidden />
          Basic
        </button>
        <button
          type="button"
          aria-pressed={mode === "pro"}
          onClick={() => setMode("pro")}
          title="Show deep cNFT burns, scan analytics, sweep history and custom amounts"
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
            mode === "pro"
              ? "bg-violet-core/20 text-violet-glow"
              : "text-muted hover:text-foreground",
          )}
        >
          <Sparkles className="size-3" aria-hidden />
          Pro
        </button>
      </div>
    </div>
  );
}
