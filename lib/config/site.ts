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
 * v6 — THE TILE MATCHES THE APP. v3 put the artwork on a bright violet-to-cyan
 * tile: legible, but the brightest object on the page and not the colour of
 * anything in the product. v6 uses the app's own surface: `space-850` (#0a0d1f)
 * under the two washes `body` carries, plus a white bloom behind the saucer so it
 * reads as lit. Measured at 29/255 mean luminance — a third of v3, and more than
 * three times the 8.6 that made the v2 black tile read as an empty square in a
 * wallet list. That band is the whole point: darker than this starts losing the
 * icon at 40px, which is the size a wallet draws it.
 *
 * New filenames each time, because a wallet holding the previous artwork cached
 * must be forced to refetch.
 */
export const DAPP_ICON_PATH = "/dapp-icon-v6-512.png";
export const DAPP_ICON_192_PATH = "/dapp-icon-v6-192.png";
export const DAPP_ICON_180_PATH = "/dapp-icon-v6-180.png";
export const DAPP_MASKABLE_ICON_PATH = "/dapp-icon-v6-512-maskable.png";
/** Small PNG for icon loaders that ask for a tab-sized image. */
export const DAPP_FAVICON_32_PATH = "/favicon-32.png";

/**
 * The copies the wallet handshake carries.
 *
 * Same artwork, at the sizes wallets actually ask for, and deliberately the most
 * boring PNG that can be produced: truecolour (no palette), no alpha, no
 * interlacing, each far under any size cap. Earlier attempts were refused — first
 * at 245 KB with an alpha channel, then palette-compressed — and the measurement
 * that ended the guessing was jup.ag's logo rendering in a wallet sheet where
 * ours did not.
 */
export const DAPP_WALLET_ICON_PATHS = [
  "/dapp-icon-v6-256.png",
  "/dapp-icon-v6-128.png",
  "/dapp-icon-v6-96.png",
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
