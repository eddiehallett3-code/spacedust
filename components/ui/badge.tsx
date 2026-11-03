import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-border-strong bg-white/6 text-foreground",
        accent: "border-brand-core/25 bg-brand-core/12 text-brand-glow",
        success: "border-emerald-500/25 bg-emerald-500/12 text-emerald-300",
        warning: "border-amber-500/25 bg-amber-500/12 text-amber-300",
        danger: "border-rose-500/25 bg-rose-500/12 text-rose-300",
        muted: "border-transparent bg-white/4 text-muted",
        // Token-2022 marker.
        token2022: "border-chrome-core/35 bg-chrome-core/12 text-chrome-glow",
      },
      size: {
        sm: "px-1.5 py-0.5 text-2xs",
        md: "px-2 py-0.5 text-2xs",
        lg: "px-2.5 py-1 text-xs",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
}