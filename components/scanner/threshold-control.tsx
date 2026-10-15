"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Slider } from "@/components/ui/slider";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/lib/utils/format";
import {
  THRESHOLD_DEFAULT_USD,
  THRESHOLD_MAX_USD,
  THRESHOLD_MIN_USD,
  THRESHOLD_STEP_USD,
} from "@/lib/utils/constants";

/**
 * USD threshold control: slider + numeric input, kept in sync both ways.
 *
 * The input holds a string while the user types (so intermediate states like
 * `"."` or `"1."` are representable) and only commits a valid number upward.
 * Without that, deleting the value to retype it would be impossible.
 */
export function ThresholdControl({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value.toFixed(2));
  const [editing, setEditing] = useState(false);

  // Keep the text in sync when the slider moves, but never fight the user
  // while they are mid-edit.
  useEffect(() => {
    if (!editing) setDraft(value.toFixed(2));
  }, [value, editing]);

  const commit = (raw: string): void => {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(
        THRESHOLD_MAX_USD,
        Math.max(THRESHOLD_MIN_USD, parsed),
      );
      onChange(Number(clamped.toFixed(2)));
    } else {
      // Unparseable input: fall back to what is actually in effect.
      setDraft(value.toFixed(2));
    }
    setEditing(false);
  };

  return (
    <div className={className}>
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="threshold-input">Dust threshold</Label>
          <p className="text-xs text-subtle">
            Show tokens worth less than this. Raise it to reach a bigger token and
            swap part of one.
          </p>
        </div>

        {/* `shrink-0` matters: this sits in a flex row beside a paragraph, and a
            flex item's default is to shrink. On a narrow screen that squeezed the
            field until its own contents were clipped — you could not read the
            number you had typed. Width raised with it, because 112px minus the
            "$" gutter left very little room for four digits and a decimal point. */}
        <div className="relative w-32 shrink-0">
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-subtle"
          >
            $
          </span>
          <Input
            id="threshold-input"
            inputMode="decimal"
            value={draft}
            onChange={(event) => {
              setEditing(true);
              setDraft(event.target.value);
            }}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                setDraft(value.toFixed(2));
                setEditing(false);
                event.currentTarget.blur();
              }
            }}
            aria-label="Dust threshold in US dollars"
            className="pl-7 pr-2 text-right font-mono tabular-nums"
          />
        </div>
      </div>

      <div className="mt-3 px-0.5">
        <Slider
          value={[value]}
          min={THRESHOLD_MIN_USD}
          max={THRESHOLD_MAX_USD}
          step={THRESHOLD_STEP_USD}
          onValueChange={([next]) => {
            if (next !== undefined) onChange(next);
          }}
          formatValue={(v) => formatUsd(v)}
          aria-label="Dust threshold in US dollars"
        />
      </div>

      <div className="mt-1 flex items-center justify-between text-[11px] text-subtle">
        <span>{formatUsd(THRESHOLD_MIN_USD)}</span>
        {value !== THRESHOLD_DEFAULT_USD ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => onChange(THRESHOLD_DEFAULT_USD)}
          >
            Reset to {formatUsd(THRESHOLD_DEFAULT_USD)}
          </Button>
        ) : (
          <motion.span
            key="default-hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-violet-glow/80"
          >
            Default
          </motion.span>
        )}
        <span>{formatUsd(THRESHOLD_MAX_USD)}</span>
      </div>
    </div>
  );
}