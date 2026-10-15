"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils/cn";

/**
 * Slider.
 *
 * Exposes `aria-valuetext` (e.g. "$5.00") because a bare number is meaningless
 * to a screen-reader user when the unit is dollars.
 */
export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    formatValue?: (value: number) => string;
  }
>(function Slider({ className, formatValue, ...props }, ref) {
  const thumbCount = Array.isArray(props.value)
    ? props.value.length
    : Array.isArray(props.defaultValue)
      ? props.defaultValue.length
      : 1;

  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        "relative flex w-full touch-none select-none items-center py-2",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-white/8">
        <SliderPrimitive.Range className="absolute h-full bg-linear-to-r from-violet-core via-indigo-core to-cyan-core" />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }, (_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          className={cn(
            "block size-5 rounded-full border-2 border-white/90 bg-violet-core shadow-[0_0_0_5px_rgba(139,92,246,0.16)]",
            "transition-[box-shadow,transform] duration-150 ease-out",
            "hover:shadow-[0_0_0_7px_rgba(139,92,246,0.22)] hover:scale-105",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-glow",
            "disabled:pointer-events-none",
          )}
          aria-valuetext={
            formatValue && props.value?.[index] !== undefined
              ? formatValue(props.value[index] as number)
              : undefined
          }
        />
      ))}
    </SliderPrimitive.Root>
  );
});