import Image from "next/image";
import styles from "./brand-logo.module.css";
import { cn } from "@/lib/utils/cn";

/**
 * The header brand.
 *
 * Tablet and desktop use the wide lockup that already contains the UFO and the
 * designed wordmark. Phones use the standalone UFO plus a live text label: the
 * full lockup would be too wide beside the Pro switch, wallet control and menu,
 * and shrinking it enough to fit would make the wordmark illegible.
 *
 * The responsive switch lives in `brand-logo.module.css` rather than
 * Tailwind's `sm:hidden`, because that utility was not emitted for this
 * component and silently left both marks in the layout.
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <>
      <span className={cn(styles.mobile, "items-center gap-1.5", className)}>
        <Image
          src="/logo-mark.png"
          alt=""
          width={500}
          height={156}
          decoding="async"
          draggable={false}
          style={{ height: 20, width: "auto" }}
        />
        <span className="text-[15px] font-semibold tracking-tight">
          Spacedust
        </span>
      </span>
      <span className={cn(styles.desktop, "items-center", className)}>
        <Image
          src="/logo-text.png"
          alt=""
          width={1000}
          height={106}
          decoding="async"
          draggable={false}
          style={{ height: 28, width: "auto" }}
        />
      </span>
    </>
  );
}
