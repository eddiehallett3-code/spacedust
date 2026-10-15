/**
 * Token-logo image hosts for the Next image optimizer allow-list.
 *
 * Token logos themselves render as plain `<img>` (see `TokenLogo`), so an
 * unknown host can never crash the page. This list still matters: it
 * constrains the optimizer's own server-side fetch (the SSRF surface) should
 * any other `next/image` usage ever touch a remote URL.
 */

/** Bare hostnames allowed exactly (no subdomains). */
export const LOGO_EXACT_HOSTS = [
  "cdn.jup.ag",
  "static.jup.ag",
  "tokens.jup.ag",
  "coin-images.jup.ag",
  "shdwdrzmxims.cloudfront.net",
  "raw.githubusercontent.com",
] as const;

/** Suffixes allowed with any subdomain, e.g. `foo.arweave.net`. */
export const LOGO_HOST_SUFFIXES = [
  "arweave.net",
  "ipfs.io",
  "ipfs.infura.io",
  "pinata.cloud",
  "cloudfront.net",
  "amazonaws.com",
  "googleusercontent.com",
  "ghproxy.net",
  "jup.ag",
  "coingecko.com",
  "trustwallet.com",
  "solana.com",
] as const;

/** `remotePatterns` entries for `next.config.ts` — derived, not duplicated. */
export const LOGO_REMOTE_PATTERNS: { protocol: "https"; hostname: string }[] = [
  ...LOGO_EXACT_HOSTS.map((hostname) => ({
    protocol: "https" as const,
    hostname,
  })),
  ...LOGO_HOST_SUFFIXES.map((suffix) => ({
    protocol: "https" as const,
    hostname: `**.${suffix}`,
  })),
];

/** Client-side mirror of the optimizer allow-list. Case-insensitive. */
export function isAllowedLogoHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if ((LOGO_EXACT_HOSTS as readonly string[]).includes(lower)) return true;
  return (LOGO_HOST_SUFFIXES as readonly string[]).some(
    (suffix) => lower === suffix || lower.endsWith(`.${suffix}`),
  );
}

/** Extract the hostname from a logo URL, or null when it is not a URL. */
export function logoHostname(src: string): string | null {
  try {
    return new URL(src).hostname || null;
  } catch {
    return null;
  }
}
