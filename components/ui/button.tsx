import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Button primitive.
 *
 * Two details worth knowing:
 *  - `asChild` lets a `<Link>` render as a button without nesting interactive
 *    elements (which breaks keyboard navigation and screen readers).
 *  - While `loading`, the button is `disabled` *and* `aria-busy`, so both mouse
 *    and assistive-technology users are blocked from double-submitting.
 */

const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "font-medium transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-glow",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    "select-none",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: [
          "text-white shadow-[0_8px_28px_-10px_rgba(139,92,246,0.85)]",
          "bg-linear-to-r from-violet-deep via-violet-core to-indigo-core",
          "hover:from-violet-core hover:via-violet-glow hover:to-cyan-core",
          "hover:shadow-[0_10px_38px_-10px_rgba(139,92,246,1)]",
          "hover:-translate-y-px active:translate-y-0",
        ].join(" "),
        secondary: [
          "glass text-foreground hover:border-border-strong",
          "hover:bg-white/8 active:bg-white/5",
        ].join(" "),
        ghost: [
          "text-muted hover:text-foreground hover:bg-white/6",
        ].join(" "),
        outline: [
          "border border-border-strong bg-transparent text-foreground",
          "hover:bg-white/6 hover:border-violet-core/45",
        ].join(" "),
        danger: [
          "bg-danger/12 text-danger border border-danger/30",
          "hover:bg-danger/20 hover:border-danger/50",
        ].join(" "),
        success: [
          "text-emerald-950 font-semibold",
          "bg-linear-to-r from-emerald-400 to-emerald-300",
          "hover:from-emerald-300 hover:to-emerald-200",
          "shadow-[0_8px_28px_-10px_rgba(52,211,153,0.8)]",
        ].join(" "),
      },
      size: {
        // Touch-first. On a phone these render at 40px — a comfortable thumb
        // target — and tighten to the denser desktop sizes from `sm` up, where
        // a precise pointer is doing the clicking.
        sm: "h-10 rounded-lg px-3 text-xs sm:h-8 [&_svg]:size-3.5",
        "icon-sm": "size-10 rounded-lg sm:size-8 [&_svg]:size-3.5",
        md: "h-10 rounded-xl px-4 text-sm [&_svg]:size-4",
        lg: "h-12 rounded-xl px-6 text-[0.95rem] [&_svg]:size-[1.15rem]",
        icon: "size-10 rounded-xl [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  /** Announced to screen readers while `loading`. */
  loadingText?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      loadingText,
      disabled,
      children,
      type,
      ...props
    },
    ref,
  ) {
    const Comp = asChild ? Slot : "button";
    const isDisabled = disabled || loading;

    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        // Default to "button" so a button inside a form never submits by accident.
        type={asChild ? undefined : (type ?? "button")}
        disabled={asChild ? undefined : isDisabled}
        aria-busy={loading || undefined}
        aria-live={loading ? "polite" : undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            {loadingText ?? children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);

export { buttonVariants };