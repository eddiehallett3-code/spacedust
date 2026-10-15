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
