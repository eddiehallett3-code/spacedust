"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";

/**
 * The Slingshot backdrop — one trajectory, deflected once, around the letter O.
 *
 * There is no planet. The letter is the mass: the arc's centre is the o itself, so
 * the path bends around the letter it belongs to. That is a better joke than a
 * planet floating inside the word, and it removes a second centre of gravity from
 * the title. What the planet left behind is its **atmosphere** — a soft bloom at
 * low opacity, in exactly the colours its rim used — so the o reads as a body the
 * trajectory is passing rather than as a letter with a glow stuck on it. Nothing
 * about the glyph changes: it stays an ordinary letter in the word's own gradient.
 *
 * The physics still has to be right, because the shape *is* the name. A gravity
 * assist is a hyperbola: in on one asymptote, curving **toward** the mass, out on
 * another. So there is exactly one bend, the mass is on its concave side, and the
 * straight legs are tangent to it — otherwise the path has a corner, and a corner
 * belongs to no manoeuvre.
 *
 * The last thing the motion has to say is speed. The glint runs the path on an
 * ease-in curve, so it crosses the approach slowly and leaves the encounter fast,
 * and the motes are spaced further and further apart and grow as they go. A
 * slingshot that drifts away at the speed it arrived is just a detour.
 */

/**
 * The path, in a 600×320 box whose centre — `(300, 160)` — is the o's centre: a
 * long horizontal approach from off to the left, a quarter turn around the letter,
 * a vertical escape.
 *
 * `A 45 45 0 0 0 …` — radius 45 units where the glyph's own radius is about 26, so
 * the path clears it by roughly half its width. The `sweep=0` flag is what puts
 * the bend on the correct side: it selects the counter-clockwise arc, whose centre
 * can only be `(300, 160)` — the o. Flip it to `1` and the arc bows *away* from
 * the letter, which is the mistake this replaces.
 */
const PATH = "M 0 205 L 300 205 A 45 45 0 0 0 345 160 L 345 0";

/** Rough length of `PATH` (300 + 70.7 + 160). Only used for the glint's dash loop. */
const PATH_LENGTH = 531;

/**
 * Motes at chosen distances *along* the path, taken from that geometry rather than
 * by eye, so they sit on the line instead of near it.
 *
 * Gaps of 100, 115, 135 — the acceleration, drawn.
 */
const PATH_MOTES = [
  { x: 50, y: 205, r: 7 },
  { x: 150, y: 205, r: 8 },
  { x: 265, y: 205, r: 9 },
  { x: 345, y: 130.7, r: 10 },
];

export function SlingshotTrajectory({ className }: { className?: string }) {
  const prefersReducedMotion = useReducedMotion();
  const glide = !prefersReducedMotion;

  // Unique per instance: two backdrops on one page would otherwise share gradient
  // ids and the second would inherit the first's. Colons are stripped because
  // React's `useId` includes them and they complicate a `url(#…)`.
  const uid = useId().replace(/:/g, "");
  const pathId = `path-${uid}`;
  const atmoId = `atmo-${uid}`;

  return (
    <svg
      viewBox="0 0 600 320"
      // Aspect is preserved: stretching the box would flatten the motes into
      // ellipses. The caller sizes it, and the viewBox keeps the shape.
      preserveAspectRatio="xMidYMid meet"
      className={cn("h-auto w-full", className)}
      fill="none"
      aria-hidden
    >
      <defs>
        {/* Fades in and out at both ends, so the trajectory has no hard stops. */}
        <linearGradient
          id={pathId}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="205"
          x2="345"
          y2="0"
        >
          <stop offset="0%" stopColor="rgba(103,232,249,0)" />
          <stop offset="14%" stopColor="rgba(103,232,249,0.45)" />
          <stop offset="52%" stopColor="rgba(167,139,250,0.7)" />
          <stop offset="84%" stopColor="rgba(103,232,249,0.8)" />
          <stop offset="100%" stopColor="rgba(103,232,249,0)" />
        </linearGradient>

        {/*
          The atmosphere the planet left behind: lit from the same corner, in the
          same two colours, and deliberately faint. It is a bloom and nothing more
          — no rim, no body, no fill behind the glyph — because the moment it has
          an edge, the letter has become a planet and the title has two marks.
        */}
        <radialGradient id={atmoId} cx="40%" cy="34%" r="70%">
          <stop offset="0%" stopColor="rgba(103,232,249,0.26)" />
          <stop offset="45%" stopColor="rgba(139,92,246,0.1)" />
          <stop offset="100%" stopColor="rgba(103,232,249,0)" />
        </radialGradient>
      </defs>

      {/* The letter's atmosphere, centred on the glyph. */}
      <circle cx="300" cy="160" r="58" fill={`url(#${atmoId})`} />

      {/* The trajectory, drawn twice: once as the permanent line, once as a glint
          travelling along it. The glint is a dash on the same path with an
          animated offset, which is far more robust than moving an element along a
          path — and under `prefers-reduced-motion` it holds still, reading as one
          bright segment rather than disappearing. */}
      <path d={PATH} stroke={`url(#${pathId})`} strokeWidth="4" strokeLinecap="round" />
      <motion.path
        d={PATH}
        stroke="rgba(224,242,254,0.95)"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeDasharray={`22 ${PATH_LENGTH - 22}`}
        animate={
          glide
            ? {
                strokeDashoffset: [0, -PATH_LENGTH],
                // Fade in and out at the ends, so the loop never pops a bright dash
                // into existence at the edge of the artwork.
                strokeOpacity: [0, 0.95, 0.95, 0],
              }
            : undefined
        }
        transition={{
          // `easeIn` is the acceleration: slow across the approach, quick through
          // the encounter, fastest as it leaves.
          strokeDashoffset: { duration: 4.6, repeat: Infinity, ease: "easeIn" },
          strokeOpacity: {
            duration: 4.6,
            repeat: Infinity,
            times: [0, 0.16, 0.72, 1],
          },
        }}
      />

      {/* Matter along the path, and the streak on the one being flung away. The
          streak trails straight down the outgoing leg, behind the mote. */}
      {PATH_MOTES.map((mote, index) => (
        <circle
          key={index}
          cx={mote.x}
          cy={mote.y}
          r={mote.r}
          className={index === 1 ? "fill-violet-glow" : "fill-cyan-glow"}
        />
      ))}
      <line
        x1="345"
        y1="134"
        x2="345"
        y2="152"
        stroke="rgba(103,232,249,0.45)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
