import Image from "next/image";
import { cn } from "@/lib/utils/cn";

/**
 * The header brand.
 *
 * One asset at every breakpoint: the transparent lockup supplied as
 * `Logo/transp logo text.png`, trimmed to its ink and served from
 * `public/logo-text-transp.png`. The previous version swapped to a mark plus a
 * live "Spacedust" label on phones, which meant the two breakpoints were not
 * showing the same wordmark. This is the same lockup everywhere, and the live
 * text is gone.
 *
 * The source is 1400 × 178 after trimming, so the rendered heights below keep
 * the wordmark's proportions. It is larger on tablet/desktop where the header
 * has room, and small enough on phones to sit beside the Pro switch and menu.
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center", className)}>
      <Image
        src="/logo-text-transp.png"
        alt=""
        width={1400}
        height={178}
        sizes="(min-width: 640px) 220px, 130px"
        decoding="async"
        draggable={false}
        className="h-4 w-auto sm:h-7"
      />
    </span>
  );
}
