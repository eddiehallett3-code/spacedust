/**
 * The site's canonical origin.
 *
 * `metadataBase` and the sitemap both need an absolute URL, and Next cannot guess
 * one: without a base, a relative `og:image` is a build-time warning and a broken
 * preview card in the wild, and a sitemap of relative paths is not a sitemap.
 *
 * The default is the production domain rather than localhost, because this value's
 * failure mode is silent and public: a deployment that never set the variable
 * would ship a sitemap and preview cards pointing at `localhost`. A local checkout
 * using the production origin costs nothing — the value only ever ends up in
 * metadata. `NEXT_PUBLIC_SITE_URL` overrides it, for a preview deployment or a
 * different domain.
 */
const DEFAULT_ORIGIN = "https://spacedust.cc";

/** The product name used in the document, manifest and wallet handshakes. */
export function getAppName(): string {
  return process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Spacedust";
}

/**
 * The short description a wallet shows beside the dApp name.
 *
 * Kept here rather than in the layout because three separate consumers need the
 * same words: AppKit's WalletConnect metadata, the manifest, and the document
 * metadata. A wallet that reads one of them and not the others should not see a
 * different product described.
 */
export const DAPP_DESCRIPTION =
  "Non-custodial Solana wallet tools: batch swap, send, reclaim rent, revoke approvals, and scan any address read-only.";

/**
 * The square dApp icon, deliberately under a fresh filename.
 *
 * Generated from `Logo/logo-.png`, the master square logo: the full planet and
 * the full speed trails, contained with the source's own padding. The earlier
 * `/dapp-icon-512.png` zoomed in on the craft and shortened the trails, which
 * made the mark look cropped in a search tile. These `v2` filenames force both
 * browser and wallet caches to fetch the corrected composition.
 *
 * `/logo-512.png` remains as the legacy filename, so an old bookmark or a
 * cached metadata entry can still resolve.
 */
export const DAPP_ICON_PATH = "/dapp-icon-v2-512.png";
export const DAPP_ICON_192_PATH = "/dapp-icon-v2-192.png";
export const DAPP_ICON_180_PATH = "/dapp-icon-v2-180.png";
export const DAPP_MASKABLE_ICON_PATH = "/dapp-icon-v2-512-maskable.png";

/**
 * The metadata a wallet needs to identify this dApp.
 *
 * Every image URL is absolute. A wallet's dApp browser may read this object
 * outside the document, so a relative `/dapp-icon-v2-512.png` would resolve
 * against the wallet's own origin and show nothing. The same rule applies to
 * the document icons and the manifest below.
 */
export function getDappMetadata(origin: string = getSiteUrl()) {
  const base = origin.replace(/\/+$/, "");
  return {
    name: getAppName(),
    description: DAPP_DESCRIPTION,
    url: base,
    icons: [`${base}${DAPP_ICON_PATH}`, `${base}${DAPP_ICON_192_PATH}`],
  };
}

export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return DEFAULT_ORIGIN;
  try {
    // Origin only: a trailing path would silently change every absolute URL built
    // from this, including the image and sitemap entries.
    return new URL(raw).origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}
