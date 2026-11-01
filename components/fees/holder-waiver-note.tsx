"use client";

import { Turtle } from "lucide-react";
import { useHolderWaiver } from "@/hooks/use-holder-waiver";
import { cn } from "@/lib/utils/cn";

/**
 * Says why the fee reads zero, and says how to make it zero.
 *
 * A bare `0` next to "Fee" is indistinguishable from a bug, so the number has to
 * be explained where it is shown. Mounted next to the fee rather than in the
 * navbar because that is the moment the question is asked.
 *
 * Three states, and the third is silence:
 *  - entitled — the waiver is applied, and that is the whole message.
 *  - holding some — how many of ten, which is the only actionable version.
 *  - holding none — nothing. A visitor who holds no Turtles is not being sold
 *    anything on this page, and a line about a perk they cannot reach is noise in
 *    a panel about their own wallet.
 *
 * `useHolderWaiver` shares a module cache with the provider-mounted sync, so this
 * costs no extra request.
 */
export function HolderWaiverNote({ className }: { className?: string }) {
  const { entitled, held, required, loading } = useHolderWaiver();

  if (loading || (!entitled && held === 0)) return null;

  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-2xs leading-relaxed",
        entitled ? "text-success" : "text-subtle",
        className,
      )}
    >
      <Turtle className="mt-px size-3 shrink-0" aria-hidden />
      {entitled ? (
        <span>
          Holder waiver applied — 0% fee while you hold {required} Turtles.
        </span>
      ) : (
        <span>
          You hold {held} of {required} Turtles. Hold {required} and the rent fee
          is 0%.
        </span>
      )}
    </p>
  );
}
