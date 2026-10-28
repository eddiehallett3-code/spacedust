/**
 * `www` is an alias for the apex, not a second site.
 *
 * Spacedust is served from `spacedust.cc`, and that origin is baked into things
 * that are expensive to get wrong: `metadataBase`, the canonical on every page,
 * the sitemap, `robots.txt`, and the icons a directory fetches. A `www` host that
 * served the same pages would be a second origin claiming to be the first, and
 * every one of those values would point somewhere else than the page it is on.
 *
 * So `www` redirects, permanently, and the redirect is *path-preserving* so a
 * deep link survives it. 308 rather than 301 because it keeps the method: a
 * permanent redirect that rewrites `POST` to `GET` would break an API call
 * rather than move it.
 *
 * This lives in a pure function, not inline in the middleware, for the reason
 * `same-origin.ts` does: the decision is worth a test, and a test of a URL
 * rewrite is worth reading.
 *
 * **Static assets are not covered.** The middleware matcher excludes
 * `_next/static` and image extensions, so a `www` request for an image is served
 * rather than redirected. That is deliberate: the asset is identical, the
 * certificate is valid, and adding a redirect to every image request would put a
 * function invocation in front of the CDN for no benefit.
 */
export function wwwRedirectUrl(input: {
  /** The `Host` header: hostname, optionally with a port, and case-insensitive. */
  host: string;
  pathname: string;
  search: string;
}): string | null {
  // A port is part of the incoming request, never of the public redirect: the
  // apex is reached on 443 and a `www:3000` in development is not a published
  // address.
  const bare = input.host.replace(/:\d+$/, "");
  const host = bare.toLowerCase().replace(/\.$/, "");
  if (!host.startsWith("www.")) return null;

  const apex = host.slice(4);
  // `www.` on its own is not a host to redirect to.
  if (apex.length === 0) return null;

  // `https:` written out rather than inherited: the redirect target is the apex's
  // origin, and behind the platform the incoming scheme is not something to trust
  // or to pass along.
  return `https://${apex}${input.pathname}${input.search}`;
}
