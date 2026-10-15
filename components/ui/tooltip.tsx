"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils/cn";

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 8, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-xs rounded-xl border border-border-strong bg-space-850/97",
          "px-3 py-2 text-xs leading-relaxed text-foreground shadow-2xl backdrop-blur-xl",
          "data-[state=delayed-open]:animate-fade-in data-[state=closed]:animate-fade-out",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});

/** Convenience wrapper: `<Tooltip content="…"><button/></Tooltip>`. */
export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  if (!content) return <>{children}</>;
  return (
    <TooltipRoot>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align}>
        {content}
      </TooltipContent>
    </TooltipRoot>
  );
}