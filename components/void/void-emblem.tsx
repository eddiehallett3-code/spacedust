"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";

/**
 * A mote falling in.
 *
 * The wrapper is the size of the whole mark and centred on it, so scaling the
 * wrapper down pulls the mote's offset — and therefore its distance from the
 * centre — in with it. Rotation plus a shrinking radius *is* a spiral, which is
 * the entire trick: nothing follows a path, one transform pair reads as matter
 * being drawn in. The scale eases *in*, so a mote accelerates as it nears the
 * horizon, and the opacity fades at both ends so the loop restart is invisible.
 *
 * `top` places a mote on its own orbit as a percentage of the mark, so the whole
 * figure scales with whatever size the caller asks for.
 */
function FallingMote({
  top,
  duration,
  delay,
  angle,
  moteClassName,
  spin,
}: {
  top: number;
  duration: number;
  delay: number;
  angle: number;
  moteClassName: string;
  spin: boolean;
}) {
  return (
    <motion.span
      className="absolute inset-0"
      animate={
        spin
          ? {
              rotate: [angle, angle + 360],
              scale: [1, 0.05],
              opacity: [0, 0.9, 0.9, 0],
            }
          : undefined
      }
      transition={{
        rotate: { duration, repeat: Infinity, ease: "linear", delay },
        scale: { duration, repeat: Infinity, ease: "easeIn", delay },
        opacity: {
          duration,
          repeat: Infinity,
          times: [0, 0.18, 0.72, 1],
          delay,
        },
      }}
    >
      {/* Dim by default, so a still frame under `prefers-reduced-motion` shows
          motes rather than nothing at all. */}
      <span
        className={cn(
          "absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70",
          moteClassName,
        )}
        style={{ top: `${top}%`, width: "3%", height: "3%" }}
      />
    </motion.span>
  );
}

const CYAN_MOTE = "bg-cyan-glow shadow-[0_0_10px_2px_rgba(103,232,249,0.75)]";
const VIOLET_MOTE = "bg-violet-glow shadow-[0_0_10px_2px_rgba(167,139,250,0.75)]";

/** Slow, wide infall: matter crossing a lot of space before the horizon. */
const WIDE_MOTES = [
  { top: 6, duration: 7.5, delay: 0, angle: 0, moteClassName: CYAN_MOTE },
  { top: 11, duration: 9.5, delay: 1.2, angle: 125, moteClassName: VIOLET_MOTE },
  { top: 4, duration: 8.5, delay: 2.4, angle: 245, moteClassName: CYAN_MOTE },
  { top: 24, duration: 6.5, delay: 0.6, angle: 60, moteClassName: VIOLET_MOTE },
  { top: 29, duration: 5.5, delay: 1.8, angle: 200, moteClassName: CYAN_MOTE },
  { top: 21, duration: 7, delay: 3, angle: 300, moteClassName: VIOLET_MOTE },
];

/**
 * A tight band just outside the horizon, for when the mark *is* the O of the
 * wordmark: there the core is large — a letter has to live in it — so motes
 * graze the rim rather than falling from far out.
 */
const GRAZING_MOTES = [
  { top: 2, duration: 5, delay: 0.2, angle: 30, moteClassName: CYAN_MOTE },
  { top: 6, duration: 6.2, delay: 1.4, angle: 150, moteClassName: VIOLET_MOTE },
  { top: 9, duration: 4.6, delay: 2.6, angle: 260, moteClassName: CYAN_MOTE },
  { top: 4, duration: 5.8, delay: 3.4, angle: 320, moteClassName: VIOLET_MOTE },
];

/**
 * The Void mark — a dark core with matter falling into it, and optionally a
 * letter at the centre of it.
 *
 * Purely graphical for assistive tech (`aria-hidden`), sized entirely by the
 * caller so the same figure can be a hero mark or the O of a word, and fully
 * static under `prefers-reduced-motion`.
 */
export function VoidEmblem({
  className,
  letter,
  dust = true,
}: {
  className?: string;
  /** Rendered at the centre of the core — used for the O of the wordmark. */
  letter?: string;
  /** Ambient twinkling specks. They need room, so a small mark opts out. */
  dust?: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();
  const spin = !prefersReducedMotion;
  const motes = letter ? GRAZING_MOTES : WIDE_MOTES;

  return (
    <motion.span
      initial={spin ? { opacity: 0, scale: 0.92 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "relative inline-flex items-center justify-center",
        className,
      )}
      aria-hidden
    >
      {/* Violet bloom behind the whole mark. */}
      <span className="absolute inset-[10%] rounded-full bg-violet-core/25 blur-3xl" />

      {motes.map((mote, index) => (
        <FallingMote key={index} {...mote} spin={spin} />
      ))}

      {/* The void itself: a dark sphere with everything it has swallowed at its
          centre — a point of light, or the letter the caller put there. */}
      <span
        className={cn(
          "relative z-10 flex aspect-square items-center justify-center rounded-full bg-space-950 ring-1",
          letter
            ? "h-[78%] ring-violet-core/55 shadow-[0_0_36px_-6px_rgba(139,92,246,0.95)]"
            : "h-[36%] ring-white/15 shadow-[0_0_40px_-8px_rgba(139,92,246,0.95)]",
        )}
      >
        <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_38%_32%,rgba(139,92,246,0.5),transparent_68%)]" />
        {letter ? (
          <span className="relative leading-none [text-shadow:0_0_18px_rgba(167,139,250,0.5)]">
            {letter}
          </span>
        ) : (
          <span className="size-[7%] rounded-full bg-foreground shadow-[0_0_8px_2px_rgba(167,139,250,0.9)]" />
        )}
      </span>

      {/* Ambient dust drifting nearby. */}
      {dust ? (
        <>
          <span className="absolute left-6 top-8 size-1 rounded-full bg-cyan-glow/70 animate-twinkle" />
          <span
            className="absolute right-8 top-6 size-1 rounded-full bg-foreground/60 animate-twinkle"
            style={{ animationDelay: "1.2s" }}
          />
          <span
            className="absolute bottom-8 right-10 size-1 rounded-full bg-violet-glow/70 animate-twinkle"
            style={{ animationDelay: "2.4s" }}
          />
        </>
      ) : null}
    </motion.span>
  );
}
