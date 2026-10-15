"use client";

import { cn } from "@/lib/utils/cn";
import { SlingshotTrajectory } from "./slingshot-trajectory";

/**
 * The page title: the word, with the trajectory bending around its O.
 *
 * Deliberately *not* the Void's construction. There, the emblem replaces a letter
 * — the O of VOID is the void — which makes the mark part of the word. Here every
 * letter is an ordinary letter, and the mark is a backdrop behind them that
 * happens to bend around one of them, because that letter is the mass.
 *
 * That anchoring is why the word is split into three runs: the artwork has to be
 * positioned against the o's own box, and the o is only findable if it is its own
 * element. Three spans is also the safe number — a run of adjacent letters picks
 * up the heading's `tracking-tight` while a lone glyph does not, so the container
 * sets `tracking-normal` and the spacing comes from the font's own advances, the
 * same rule The Void's wordmark had to learn.
 *
 * Painting order matters here and is not obvious. The trajectory is wider than the
 * word, so if it shared the letters' layer it would draw *over* them. Instead the
 * o's span sits at `z-0` and creates a stacking context, the artwork sits at
 * `-z-10` inside it, and the other two runs sit at `z-10`. So the path is behind
 * the letter it bends around, and behind the letters it passes, while still being
 * in front of the page.
 */
export function SlingshotWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex items-center tracking-normal",
        className,
      )}
    >
      <span className="text-gradient relative z-10">Slingsh</span>

      {/* The o, which the trajectory bends around — so the artwork is anchored to
          this box rather than to the word. The vertical nudge is optical: a flex
          item's box centres on the line box, while the glyph's own centre sits a
          little below that. It is a margin rather than part of the `top` value so
          it simply adds to the centring translate below, instead of nesting a
          `calc()` inside a length utility. */}
      <span className="text-gradient relative z-0">
        <SlingshotTrajectory className="pointer-events-none absolute left-1/2 top-1/2 -z-10 mt-[0.09em] w-[6em] -translate-x-1/2 -translate-y-1/2" />
        o
      </span>

      <span className="text-gradient relative z-10">t</span>
    </span>
  );
}


