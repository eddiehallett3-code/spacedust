import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Centred, width-capped page container.
 *
 * Mobile-first: full-bleed with modest padding on small screens, widening to a
 * comfortable reading measure on desktop.
 */
export function Container({
  className,
  size = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  size?: "default" | "narrow" | "wide";
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        size === "default" && "max-w-6xl",
        size === "narrow" && "max-w-3xl",
        size === "wide" && "max-w-7xl",
        className,
      )}
      {...props}
    />
  );
}