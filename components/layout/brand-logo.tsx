import Image from "next/image";
import { cn } from "@/lib/utils/cn";

/**
 * The header brand.
 *
 * One asset at every breakpoint: the lockup supplied as
 * `Logo/header logo text.png`, served from `public/logo-header-text-transp.png`.
 * Unlike the asset it replaced, this file arrives already transparent — no black
 * plate to knock out, no trim needed — so it is copied to `public/` byte for byte
 * and nothing here depends on an edit outside the repository.
 *
 * The file is 1422 × 198 with its ink inset from every edge: 1332 × 138 of
 * artwork, roughly 14% clear above and below and 2.4% either side. Those margins
 * are part of the artwork and are rendered rather than cropped — the supplied
 * proportions are the design, and trimming them would silently enlarge the mark
 * by about a fifth. `width`/`height` below are the file's real dimensions, which
 * is what Next uses for the intrinsic aspect ratio; a lie there squashes the art.
 *
 * `h-6` / `sm:h-9` carried over unchanged, and the measurement is why. The
 * wordmark's letters are 66px in a 198px box — 33.6% of it — against 97px in
 * 273px, or 35.7%, for the lockup this replaced. At the same rendered height the
 * lettering lands within about 6% of what the header had, and the aspect ratios
 * are 7.18:1 against 7.27:1, so the bar's layout does not move. A new file that
 * is 4px narrower at every breakpoint is not worth re-tuning the header for.
 *
 * The white-on-transparent artwork is keyed light — mean ink `rgb(170,225,249)`
 * against `rgb(152,207,230)` for the previous lockup — so it reads on the dark
 * bar without a plate behind it.
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center", className)}>
      <Image
        src="/logo-header-text-transp.png"
        alt=""
        width={1422}
        height={198}
        sizes="(min-width: 640px) 258px, 172px"
        decoding="async"
        draggable={false}
        className="h-6 w-auto sm:h-9"
      />
    </span>
  );
}
