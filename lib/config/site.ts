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
 * The square icon every web surface shows: the tab, the home screen, the web app
 * manifest and the `logo` in structured data.
 *
 * v7 — the flat-black tile, and deliberately the same artwork as `/favicon.ico`
 * and `/favicon-32.png`, which have been black all along. v6 put the mark on the
 * app's own surface (`space-850` #0a0d1f under the two washes `body` carries),
 * which is the right tile on a dark sheet and the wrong one everywhere these
 * icons actually land: a light tab strip, a white directory page, an iOS home
 * screen. Sampled at the corner, v6 is #0c0e22 and v7 is #000000. The measurement
 * history behind the two sets — including why an earlier black tile was rejected
 * — is in `docs/listing-assets.md`.
 *
 * The wallet handshake stays on v6 on purpose: see `DAPP_WALLET_ICON_PATH`.
 *
 * New filenames each time, because a browser or wallet holding the previous
 * artwork cached must be forced to refetch.
 */
export const DAPP_ICON_PATH = "/dapp-icon-v7-512.png";
export const DAPP_ICON_192_PATH = "/dapp-icon-v7-192.png";
export const DAPP_ICON_180_PATH = "/dapp-icon-v7-180.png";
export const DAPP_MASKABLE_ICON_PATH = "/dapp-icon-v7-512-maskable.png";
/** Small PNG for icon loaders that ask for a tab-sized image. */
export const DAPP_FAVICON_32_PATH = "/favicon-32.png";

/**
 * The tile the wallet handshake carries: the Android app-identity prompt and the
 * WalletConnect sheet.
 *
 * v6, deliberately not the v7 black the web icons use. Both are the same mark on
 * a different tile, and the difference only matters at the size a wallet draws
 * it: on a dark sheet a #000000 tile with a white saucer loses its edge and reads
 * as an empty square — the v2 black tile measured 8.6 and that is why v6 exists.
 * The web icons could move to black because a tab strip and a directory page are
 * light; a wallet sheet is not.
 */
export const DAPP_WALLET_ICON_PATH = "/dapp-icon-v6-256.png";

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
