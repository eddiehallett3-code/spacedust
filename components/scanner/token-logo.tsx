"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Token logo with a resilient fallback chain.
 *
 * Logo URIs come from on-chain metadata, so they are attacker-controlled. They
 * are rendered as a plain `<img>` — never `next/image` — because `next/image`
 * throws at *render time* for any host outside `remotePatterns`, so a single
 * unknown logo host would crash the whole page (`onError` never fires). A
 * browser-fetched `<img>` cannot crash the page, carries
 * `referrerPolicy="no-referrer"` so no wallet context leaks, and any load
 * failure falls back to a letter avatar.
 *
 * Server-side, `sanitizeLogoUri` already restricts logos to `http(s)` URLs;
 * the optimizer allow-list in `next.config.ts` independently blocks its own
 * server-side fetch (the SSRF surface) against internal services.
 *
 * A malicious logo must never be able to break the list layout.
 */
export function TokenLogo({
  src,
  symbol,
  size = 32,
  className,
}: {
  src: string | null;
  symbol: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (symbol.replace(/[^a-zA-Z0-9]/g, "").charAt(0) || "?").toUpperCase();

  if (!src || failed) {
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full",
          "bg-linear-to-br from-violet-core/30 to-cyan-core/25 font-semibold text-violet-glow",
          "ring-1 ring-inset ring-white/10",
          className,
        )}
        style={{ width: size, height: size, fontSize: size * 0.42 }}
      >
        {initial}
      </span>
    );
  }

  return (
    // Plain `<img>` on purpose — see the doc comment above. `next/image`
    // would throw at render for any logo host outside `remotePatterns`.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn(
        "shrink-0 rounded-full object-cover ring-1 ring-inset ring-white/10",
        className,
      )}
      style={{ width: size, height: size }}
      // Decorative: the token name is always rendered next to it.
      aria-hidden
    />
  );
}