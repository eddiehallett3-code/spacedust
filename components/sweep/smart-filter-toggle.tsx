"use client";

import { ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { SMART_FILTER_MAX_PRICE_IMPACT } from "@/lib/utils/constants";

/**
 * Smart Filter toggle.
 *
 * On by default, because the tokens it hides are the ones most likely to fail
 * or to quietly cost the user money. Turning it off shows everything under the
 * threshold, which is what a power user wants when debugging a stuck token.
 */
export function SmartFilterToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-white/3 p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">Smart Filter</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Hide tokens with no reliable price, a transfer hook, or a price impact
          above {Math.round(SMART_FILTER_MAX_PRICE_IMPACT * 100)}%.
        </p>
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-success">
          <ShieldCheck className="size-3" aria-hidden />
          Prevents most failed slingshots
        </p>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={onChange}
        aria-label="Toggle smart filter"
      />
    </div>
  );
}