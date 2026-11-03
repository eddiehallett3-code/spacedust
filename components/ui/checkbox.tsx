"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Checkbox.
 *
 * Supports an `indeterminate` state, which is what the "Select all" header row
 * needs when *some* (but not all) tokens are selected. Radix exposes it via a
 * DOM property rather than an attribute, so we set it imperatively in an effect.
 */
export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
    indeterminate?: boolean;
  }
>(function Checkbox({ className, indeterminate, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "peer size-[18px] shrink-0 rounded-md border border-border-strong",
        "transition-all duration-150 ease-out",
        "hover:border-brand-core/60 hover:bg-brand-core/10",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-glow",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "data-[state=checked]:border-transparent data-[state=checked]:bg-linear-to-br data-[state=checked]:from-brand-core data-[state=checked]:to-chrome-core",
        "data-[state=indeterminate]:border-transparent data-[state=indeterminate]:bg-linear-to-br data-[state=indeterminate]:from-brand-core data-[state=indeterminate]:to-chrome-core",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white">
        {indeterminate ? (
          <Minus className="size-3.5" strokeWidth={3} />
        ) : (
          <Check className="size-3.5" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});