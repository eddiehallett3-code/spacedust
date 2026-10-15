"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils/cn";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full",
        "border border-transparent transition-colors duration-200",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-glow",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-linear-to-r data-[state=checked]:from-violet-core data-[state=checked]:to-cyan-core",
        "data-[state=unchecked]:bg-white/12",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-white shadow-lg ring-0",
          "transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          "data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0.5",
        )}
      />
    </SwitchPrimitive.Root>
  );
});