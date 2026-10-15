import * as React from "react";
import { cn } from "@/lib/utils/cn";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, type = "text", ...props }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-10 w-full rounded-xl border border-border bg-white/4 px-3.5 py-2",
        "text-sm text-foreground placeholder:text-subtle",
        "transition-colors duration-200",
        "hover:border-border-strong",
        "focus-visible:border-violet-core/60 focus-visible:bg-white/6 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Strip the browser's number spinners; we control stepping ourselves.
        "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
        className,
      )}
      {...props}
    />
  );
});

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(function Label({ className, ...props }, ref) {
  return (
    <label
      ref={ref}
      className={cn(
        "text-xs font-medium text-muted select-none",
        className,
      )}
      {...props}
    />
  );
});

/** Shimmering placeholder block used while data loads. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("skeleton rounded-lg", className)}
      {...props}
    />
  );
}

/** Accessible loading region. */
export function LoadingRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}