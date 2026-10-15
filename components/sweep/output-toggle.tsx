"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { OUTPUT_ASSETS } from "@/lib/utils/constants";
import { cn } from "@/lib/utils/cn";
import type { OutputAsset } from "@/types/sweep";

/**
 * One option in the output toggle: the real token logo (bundled in `public/
 * so it renders offline and is never fetched from a third party) plus the
 * classic symbol as a fallback if the image ever fails to decode.
 */
const OPTIONS: Array<{
  id: OutputAsset;
  label: string;
  hint: string;
  logo: string;
  glyph: string;
}> = [
  { id: "SOL", label: "SOL", hint: "Native Solana", logo: "/tokens/sol.png", glyph: "◎" },
  { id: "USDC", label: "USDC", hint: "Circle USD Coin", logo: "/tokens/usdc.png", glyph: "$" },
  { id: "JUP", label: "JUP", hint: "Jupiter", logo: "/tokens/jup.png", glyph: "J" },
];

/** Token logo, falling back to the text glyph if the file cannot be loaded. */
function AssetLogo({ logo, glyph }: { logo: string; glyph: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span aria-hidden className="text-base leading-none">
        {glyph}
      </span>
    );
  }

  return (
    // Same-origin static asset (not a remote, user-controlled URL), so a plain
    // <img> is used — see the wallet picker for the same pattern.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logo}
      alt=""
      width={16}
      height={16}
      onError={() => setFailed(true)}
      className="size-4 shrink-0 rounded-full object-cover ring-1 ring-inset ring-white/15"
      aria-hidden
    />
  );
}

/**
 * Output asset toggle.
 *
 * Implemented as a two-button group with `role="radiogroup"` semantics so
 * screen readers announce it as a single choice rather than two toggles.
 */
export function OutputToggle({
  value,
  onChange,
  className,
}: {
  value: OutputAsset;
  onChange: (asset: OutputAsset) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Output asset"
      className={cn(
        "grid grid-cols-3 gap-1 rounded-xl border border-border bg-white/3 p-1",
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const active = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.id)}
            className={cn(
              "relative flex items-center justify-center gap-2 rounded-lg px-3 py-2",
              "text-sm font-medium transition-colors duration-200",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-glow",
              active ? "text-white" : "text-muted hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId="output-toggle-pill"
                className="absolute inset-0 -z-10 rounded-lg bg-linear-to-r from-violet-deep via-violet-core to-indigo-core shadow-[0_6px_18px_-8px_rgba(139,92,246,0.9)]"
                transition={{ type: "spring", stiffness: 400, damping: 34 }}
              />
            ) : null}
            <AssetLogo logo={option.logo} glyph={option.glyph} />
            {option.label}
            <span className="sr-only"> — {option.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The chosen asset's mint + decimals, for downstream maths. */
export function outputConfig(asset: OutputAsset) {
  return OUTPUT_ASSETS[asset];
}