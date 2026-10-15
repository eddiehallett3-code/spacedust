"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

/**
 * Artwork for one NFT or cNFT.
 *
 * Rendered as a plain `<img>` for the same reason `TokenLogo` is: `next/image`
 * throws at *render* time for any host outside `remotePatterns`, so a single
 * unknown art host would take the whole page down and `onError` would never
 * fire. A browser-fetched `<img>` cannot crash the page, `no-referrer` keeps
 * the request free of wallet context, and a failure falls back to a placeholder
 * rather than a broken-image glyph.
 */
export function NftArtwork({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-white/3 ring-1 ring-inset ring-white/10">
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-cover"
          aria-hidden
        />
      ) : (
        <span className="flex size-full items-center justify-center text-subtle">
          <ImageOff className="size-7" aria-hidden />
        </span>
      )}
    </div>
  );
}
