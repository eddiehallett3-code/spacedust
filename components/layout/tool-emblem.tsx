import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * One small mark per tool, drawn to a single spec.
 *
 * Every page used to introduce itself differently: The Void with an oversized
 * wordmark whose O *was* the void, everything else with plain text at half the
 * size, and two pages with no eyebrow at all. This is the shared version — a
 * single white glyph above the title, all of them drawn the same way so the row
 * of tools reads as a set rather than as four unrelated designs.
 *
 * The spec, which is the whole point: a 24×24 box, stroke only, 1.5 wide, round
 * caps and joins, no fills except a mote or two, and `currentColor` so the caller
 * decides the colour. Every icon is built from circles, lines and one simple
 * curve — nothing that needs drawing skill to hold up at 28 pixels.
 *
 * Each mark says what the tool does rather than what it is called:
 *
 *  - **slingshot** — a trajectory bending upward and leaving, the same idea as the
 *    sweeper's former wordmark, in one stroke.
 *  - **void** — a mass with an accretion arc and a mote falling in.
 *  - **approvals** — a key: someone else's permission to move your balance.
 *  - **scan** — a magnifier, because nothing here is signed or connected.
 *  - **how-it-works** — three nodes on a path, one raised: the steps a sweep takes.
 *  - **security** — a shield with a tick.
 */
export type ToolKey =
  | "slingshot"
  | "void"
  | "approvals"
  | "scan"
  | "payload"
  | "salvage"
  | "how-it-works"
  | "security";

const ICONS: Record<ToolKey, ReactNode> = {
  slingshot: (
    <>
      {/* The path, bending up and away… */}
      <path d="M3 18 C 10 18 15 15.5 20 6" />
      {/* …and the mote it is flinging. */}
      <circle cx="20" cy="6" r="1.15" />
    </>
  ),
  void: (
    <>
      {/* The mass. */}
      <circle cx="12" cy="12" r="4.75" />
      {/* Matter spiralling in — an arc, not a second circle, so it reads as motion. */}
      <path d="M12 3 A 9 9 0 0 1 21 12" />
      <circle cx="19.4" cy="5.4" r="1.05" />
    </>
  ),
  approvals: (
    <>
      {/* The head of the key, where the permission is kept. */}
      <circle cx="8.2" cy="8.2" r="4.2" />
      {/* And the shaft, with two teeth. */}
      <path d="M11.2 11.2 L 20.5 20.5" />
      <path d="M15.6 15.6 L 13.6 17.6" />
      <path d="M18.2 18.2 L 16.2 20.2" />
    </>
  ),
  scan: (
    <>
      {/* A magnifier: look, do not touch. */}
      <circle cx="10.5" cy="10.5" r="6.2" />
      <path d="M15.2 15.2 L 21 21" />
    </>
  ),
  payload: (
    <>
      {/* Two things leaving… */}
      <circle cx="4.5" cy="7.5" r="1.6" />
      <circle cx="4.5" cy="16.5" r="1.6" />
      {/* …converging on one destination. */}
      <path d="M6.1 7.9 L 16.8 11.3" />
      <path d="M6.1 16.1 L 16.8 12.7" />
      <circle cx="18.4" cy="12" r="1.7" />
    </>
  ),
  salvage: (
    <>
      {/* A horseshoe magnet: pulling value back out of what was left behind.
          Legs up, bend below, sweeping the long way round — the shape reads at
          28 pixels where a recycling arrow does not. */}
      <path d="M8 5 V11 A 4 4 0 0 0 16 11 V5" />
      <path d="M6.6 5 H9.4" />
      <path d="M14.6 5 H17.4" />
    </>
  ),
  "how-it-works": (
    <>
      {/* Three steps, with the middle one lifted — scan, build, sign. */}
      <circle cx="4.2" cy="16.5" r="1.7" />
      <circle cx="12" cy="7.5" r="1.7" />
      <circle cx="19.8" cy="16.5" r="1.7" />
      <path d="M5.7 15.4 L 10.6 8.7" />
      <path d="M13.4 8.7 L 18.3 15.4" />
    </>
  ),
  security: (
    <>
      {/* A shield, and the tick that says it holds. */}
      <path d="M12 3.2 L 19 6 V 12 C 19 16.4 16.1 19.4 12 20.8 C 7.9 19.4 5 16.4 5 12 V 6 Z" />
      <path d="M9.2 12.2 L 11.3 14.3 L 15.1 10.5" />
    </>
  ),
};

export function ToolEmblem({
  tool,
  className,
}: {
  tool: ToolKey;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      // Stroke only, one weight, round ends: the conventions that make six
      // separate drawings look like one set.
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      // White, as asked, and hidden from assistive tech — the title underneath
      // already says what this is, so announcing it twice adds nothing.
      className={cn("size-7 text-white", className)}
      aria-hidden
    >
      {ICONS[tool]}
    </svg>
  );
}
