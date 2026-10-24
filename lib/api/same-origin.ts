/**
 * Refuse a request that another site made, in a visitor's browser.
 *
 * Extracted from `/api/rpc` when `/api/sponsor` needed the same check. It is the
 * same *security* decision, so it lives in one place: an endpoint that spends
 * somebody's money must not be callable by a page the visitor did not intend.
 * A browser stamps every cross-origin POST with `Origin` and every request with
 * `Sec-Fetch-Site`, so both are checked when present. A request carrying
 * neither did not come from a browser, and the per-client budget is what governs
 * it.
 *
 * Returns the refusal message, or `null` when the request may proceed.
 */
export function crossOriginRefusal(request: Request): string | null {
  const site = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (site && site !== "same-origin" && site !== "none") {
    return "Cross-site requests are not served by this proxy.";
  }

  const origin = request.headers.get("origin");
  if (!origin) return null;

  try {
    if (new URL(origin).host !== new URL(request.url).host) {
      return "Cross-origin requests are not served by this proxy.";
    }
  } catch {
    return "The Origin header could not be read.";
  }
  return null;
}
