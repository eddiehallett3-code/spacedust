import { cn } from "@/lib/utils/cn";

/**
 * The header brand.
 *
 * Desktop and tablet use the wide lockup that already contains the UFO and the
 * wordmark, so there is no second text node to drift out of alignment. Phones
 * use the standalone UFO because the lockup would crowd the Pro switch, wallet
 * control and menu.
 *
 * A native `<picture>` rather than two Next images: the asset switch is a media
 * query, and the explicit inline height keeps the transparent PNGs from ever
 * rendering at their 1400px intrinsic width during hydration.
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <picture className={cn("flex items-center", className)}>
      <source media="(min-width: 640px)" srcSet="/logo-text.png" />
      <img
        src="/logo-mark.png"
        alt=""
        width={500}
        height={156}
        decoding="async"
        draggable={false}
        style={{ height: 32, width: "auto" }}
      />
    </picture>
  );
}
