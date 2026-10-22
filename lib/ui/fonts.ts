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
