import { VoidEmblem } from "@/components/void/void-emblem";
import { cn } from "@/lib/utils/cn";

/**
 * "The Void", set as a mark rather than a phrase.
 *
 * The O is not a letter here — it is the void, sitting at the centre of its own
 * dark disc. That makes this the one place where the name and the thing it names
 * are the same object, and matter falls into it: the mark moves, and the motion
 * is the point of it rather than decoration on top.
 *
 * "The" hangs small above the left shoulder of the V, so the word carrying the
 * meaning is the one read first. Every size is in `em`, so this is a piece of
 * type that follows the heading's text size rather than an illustration with a
 * scale of its own.
 */
export function VoidWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        // One flex row, one gap, four items: V, the void, I, D. Every pair is
        // therefore separated by the same number.
        //
        // This used to be `V`, the mark, then "ID" as a single run of text — and
        // the heading's tight tracking squeezed that run, so the I and the D sat
        // closer together than the letters either side of the O. Splitting them
        // into their own slots fixes it by construction rather than by eye, and
        // `tracking-normal` keeps the heading's tracking from reaching in at all.
        "relative inline-flex items-center gap-[0.1em] leading-none tracking-normal",
        className,
      )}
    >
      {/* "The" — small, above the left of the V. */}
      <span className="absolute bottom-[94%] left-[0.04em] text-[0.2em] font-medium tracking-[0.32em] text-violet-glow/75">
        The
      </span>

      <span className="text-gradient">V</span>

      {/* The void itself, with the O at its centre. It carries its own colour:
          the letters either side are transparent over their own gradient, so an
          inherited colour would leave this letter invisible. */}
      <VoidEmblem
        letter="O"
        dust={false}
        className="size-[1.08em] shrink-0 text-foreground"
      />

      <span className="text-gradient">I</span>
      {/*
        50% more than the shared gap. Optical spacing is judged by eye and this
        pair simply reads tighter than the other two — the I is a narrow stem
        beside the D's bowl, where the O is a wide disc. It is a magic number by
        nature; it is here, with the shared gap, rather than scattered.
      */}
      <span className="text-gradient ml-[0.05em]">D</span>
    </span>
  );
}
