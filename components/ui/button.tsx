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
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-glow",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    "select-none",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: [
          "border border-brand-glow/25 text-white",
          "bg-brand-deep",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_8px_24px_-16px_rgba(70,153,200,0.9)]",
          "hover:brightness-110 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_10px_30px_-16px_rgba(70,153,200,1)]",
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
          "hover:bg-white/6 hover:border-brand-core/45",
        ].join(" "),
        danger: [
          "bg-danger/12 text-danger border border-danger/30",
          "hover:bg-danger/20 hover:border-danger/50",
        ].join(" "),
        success: [
          "border border-emerald-300/30 text-emerald-950 font-semibold",
          "bg-emerald-400",
          "hover:bg-emerald-300",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_24px_-16px_rgba(52,211,153,0.8)]",
        ].join(" "),
      },
      size: {
        // Touch-first, and 44px on a phone rather than 40.
        //
        // 40 was chosen as "a comfortable thumb target" and is the number most
        // design systems default to, but the guideline that actually gets tested
        // is 44: below it, a tap near the edge of a control lands on the gap
        // beside it. Measured on the built site at 390px, every control sat at
        // 40 — Connect, the menu button, the primary CTA, and the address input.
        // The denser desktop sizes still apply from `sm` up, where a precise
        // pointer is doing the clicking.
        sm: "h-11 rounded-lg px-3 text-xs sm:h-8 [&_svg]:size-3.5",
        "icon-sm": "size-11 rounded-lg sm:size-8 [&_svg]:size-3.5",
        md: "h-11 rounded-lg px-4 text-sm sm:h-10 [&_svg]:size-4",
        lg: "h-12 rounded-lg px-6 text-base [&_svg]:size-[1.15rem]",
        icon: "size-11 rounded-lg sm:size-10 [&_svg]:size-4",
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