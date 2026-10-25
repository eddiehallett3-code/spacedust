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
 * `/logo-512.png` remains as the legacy filename, so an old bookmark or a
 * cached metadata entry can still resolve.
 *
 * v3 — WHY THE TILE IS NO LONGER BLACK. The v2 set flattened the wordmark onto
 * pure black. Measured at 512px that is a black square carrying a pale band
 * across 26% of its height: mean luminance 8/255, with 4% of pixels above
 * mid-grey. A wallet renders it at 32-64px in a list beside a dozen coloured
 * icons, where it reads as an empty tile — which is exactly what "Spacedust has
 * no logo" looks like from the outside. The artwork did not change; the tile
 * did. Same wordmark, on the violet-to-cyan the site already glows in: 92/255
 * mean luminance, 96% of the square visible against black.
 *
 * New filenames again, for the same reason as v2: a wallet holding the blank
 * tile cached must be forced to refetch.
 */
export const DAPP_ICON_PATH = "/dapp-icon-v3-512.png";
export const DAPP_ICON_192_PATH = "/dapp-icon-v3-192.png";
export const DAPP_ICON_180_PATH = "/dapp-icon-v3-180.png";
export const DAPP_MASKABLE_ICON_PATH = "/dapp-icon-v3-512-maskable.png";
/** Small PNG for icon loaders that ask for a tab-sized image. */
export const DAPP_FAVICON_32_PATH = "/favicon-32.png";

/**
 * Separate, smaller copies for the wallet handshake.
 *
 * Same artwork as v3, recompressed: the PWA icons are 245 KB at 512px because
 * they carry an alpha channel and no palette, and wallet icon fetchers commonly
 * cap at 250 KB — Backpack showed the domain with no logo beside it, and at
 * 250,669 bytes the 512 was 669 bytes over that line. These are flattened (no
 * alpha, in case a wallet composites onto white) and palette-compressed: 65 KB,
 * 12 KB and 5 KB. The PWA set is left byte-identical so the installed-app tile
 * and the icon Phantom reviewed do not churn for a wallet-only fix.
 */
export const DAPP_WALLET_ICON_PATHS = [
  "/dapp-icon-wc-512.png",
  "/dapp-icon-wc-192.png",
  "/dapp-icon-wc-96.png",
] as const;

/**
 * The metadata a wallet needs to identify this dApp.
 *
 * Every image URL is absolute. A wallet's dApp browser may read this object
 * outside the document, so a relative `/dapp-icon-v3-512.png` would resolve
 * against the wallet's own origin and show nothing. The same rule applies to
 * the document icons and the manifest below.
 */
export function getDappMetadata(origin: string = getSiteUrl()) {
  const base = origin.replace(/\/+$/, "");
  return {
    name: getAppName(),
    description: DAPP_DESCRIPTION,
    url: base,
    icons: DAPP_WALLET_ICON_PATHS.map((path) => `${base}${path}`),
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
