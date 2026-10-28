import Image from "next/image";
import { cn } from "@/lib/utils/cn";

/**
 * The header brand.
 *
 * One asset at every breakpoint: the lockup supplied as
 * `Logo/Spacedust Saturn Emblem Logo.png`, knocked out of its black plate and
 * trimmed to its ink, then served from `public/logo-saturn-transp.png`. The
 * previous version swapped to a mark plus a live "Spacedust" label on phones,
 * which meant the two breakpoints were not showing the same wordmark. This is the
 * same lockup everywhere, and the live text is gone.
 *
 * The source arrives as 2172 × 724 with **no alpha channel** — a solid black
 * plate with the art floating in the middle of it, 94% of the file. Dropped into
 * the header as-is that is a black rectangle sitting in a translucent bar, and
 * about a fifth of the visible width would be empty. So the plate is flood-filled
 * away from the border inward (`Logo/` keeps the original; the knockout is
 * recorded in the note at the top of `public/logo-saturn-transp.png`'s history,
 * not reproducible by a script in this repository) and the rest is trimmed to
 * 1986 × 273, a 7.27:1 lockup against the old one's 7.87:1.
 *
 * Enclosed black deliberately survives that knockout — the counters in the
 * letters and the shadow band across the saucer — because the fill only travels
 * through pixels reaching it from outside. A global black key would hollow the
 * mark out.
 *
 * The rendered heights are taller than the old asset's `h-4`/`h-7` because the
 * two lockups do not put the same proportion of their height into lettering: in
 * this one the saucer spans the full 273px while the wordmark's cap height is
 * only ~42% of it, against ~62% in the old file. At the old heights the wordmark
 * would have shrunk by a third. `h-6`/`sm:h-9` restores a cap height within a
 * pixel of what the header had, and keeps the whole mark inside the 3.5rem bar.
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center", className)}>
      <Image
        src="/logo-saturn-transp.png"
        alt=""
        width={1986}
        height={273}
        sizes="(min-width: 640px) 262px, 174px"
        decoding="async"
        draggable={false}
        className="h-6 w-auto sm:h-9"
      />
    </span>
  );
}
