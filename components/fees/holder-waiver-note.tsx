"use client";

import { Turtle } from "lucide-react";
import { useHolderWaiver } from "@/hooks/use-holder-waiver";
import { cn } from "@/lib/utils/cn";

/**
 * Says why the fee reads zero.
 *
 * A bare `0` next to "Fee" is indistinguishable from a bug, so the number is
 * explained where it is shown. Mounted next to the fee rather than in the navbar
 * because that is the moment the question is asked.
 *
 * TWO STATES, AND NO THIRD: entitled, or nothing at all. A wallet holding nine
 * used to get "hold one more and the fee is 0%", which is a sales pitch in a panel
 * about someone's own wallet — and the decision was that the perk is a thing you
 * either have or do not, with nothing said about it otherwise. `held` is still
 * read so a future surface can use it; nothing here mentions it.
 */
export function HolderWaiverNote({ className }: { className?: string }) {
  const { entitled, required, loading } = useHolderWaiver();

  if (loading || !entitled) return null;

  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-2xs leading-relaxed text-success",
        className,
      )}
    >
      <Turtle className="mt-px size-3 shrink-0" aria-hidden />
      <span>
        Holder waiver applied — 0% fee while you hold {required} Turtles.
      </span>
    </p>
  );
}
