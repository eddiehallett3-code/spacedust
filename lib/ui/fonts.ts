import type { CSSProperties } from "react";

/**
 * The display face used by page titles.
 *
 * `next/font` exposes the family on the root as `--font-bricolage`, including
 * its generated fallback. Applying it inline keeps the heading treatment
 * independent of Tailwind's utility generation; it is a single family, not a
 * second type system.
 */
export const DISPLAY_FONT_STYLE: CSSProperties = {
  fontFamily: "var(--font-bricolage)",
};

/**
 * The one type treatment for a page title.
 *
 * Shared rather than repeated: `PageHeader` and the Slingshot hero both set a
 * tool title, and when each carried its own copy of the classes they drifted —
 * the hero was left on mixed case after the header changed, so two tool pages
 * disagreed about what a title looks like.
 *
 * Uppercase, and positive tracking to go with it. Bricolage draws its ascenders
 * 7.6% above cap height (39.6 vs 42.6 at 60px, measured, and identical at every
 * optical size, width and weight — so it is in the outlines and no font setting
 * moves it). In a short mixed-case title that reads as a fault, because the
 * lowercase letters beside the capitals visibly stand taller: "The Void" pairs
 * `h` and `d` with `T` and `V`, and they overshoot. Uppercase removes the
 * comparison — no ascenders are left to overshoot, and every letter ends on the
 * cap line.
 *
 * Not `tracking-tight`, which suits mixed-case display type: capitals set tight
 * look crammed, so they take `tracking-wide` and read as a title, not a shout.
 */
export const DISPLAY_TITLE_CLASS =
  "text-4xl font-semibold uppercase leading-tight tracking-wide sm:text-5xl lg:text-6xl";
