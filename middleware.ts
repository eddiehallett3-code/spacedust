import { NextResponse, type NextRequest } from "next/server";
import { limitedRouteForPath } from "@/lib/api/rate-limit";
import { checkSharedLimit } from "@/lib/api/rate-limit-store";
import { buildCsp, cspHeaderName } from "@/lib/security/csp";

/**
 * The shared half of the API rate limiting.
 *
 * `lib/api/rate-limit.ts` counts in a `Map`, which on serverless means one
 * instance's worth of traffic — so the deployment's real ceiling is that budget
 * multiplied by however many instances the platform decides to start. This runs
 * once in front of every API route and applies the same budgets through a counter
 * every instance shares. See `lib/api/rate-limit-store.ts` for the store, and for
 * why an unconfigured or unreachable one is deliberately not an error.
 *
 * It lives here rather than in each route for one reason: six copies of a check is
 * five chances to forget it, and the seventh route added later would not have it
 * at all. `limitedRouteForPath` derives the budget from the path, so a new endpoint
 * is covered by being under `/api/`.
 *
 * Deliberately small. It must not read bodies, touch a database, or decide anything
 * about the request beyond how many of them this client has sent.
 *
 * It also issues the Content-Security-Policy nonce. That is not a second
 * responsibility so much as the same one — a header that has to be decided once
 * per request, for every request — and doing it here avoids a second middleware
 * whose matcher would have to be kept in step with this one.
 */
export const config = {
  /**
   * Pages as well as API routes: a policy on a JSON response is harmless, but a
   * page without one is the case that matters. Static assets are excluded — they
   * are not documents, and including them would add an invocation per file for no
   * policy value.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

/** A per-request nonce, from the platform's CSPRNG. */
function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const route = limitedRouteForPath(request.nextUrl.pathname);

  if (route) {
    const allowance = await checkSharedLimit(request, route);
    if (!allowance.allowed) {
      // `/api/rpc` owes its client a JSON-RPC error object, because its client is
      // web3.js and the app renders whatever comes back as an RPC failure. A plain
      // `{error}` body would reach it as a parse failure instead of a rate limit, so
      // this one endpoint gets the shape its own route would have sent.
      const body =
        route === "rpc"
          ? {
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32005,
                message: "Rate limit exceeded. Try again shortly.",
              },
            }
          : { error: "Too many requests from this address. Try again shortly." };

      return NextResponse.json(body, {
        status: 429,
        headers: { "Retry-After": String(allowance.retryAfterSeconds) },
      });
    }
  }

  // ── The policy ────────────────────────────────────────────────────────────
  // A nonce has to be new for every response and must reach the scripts Next
  // renders. It travels on the *request* headers, which the server sees and the
  // browser does not: Next reads the nonce out of the policy there and applies it
  // to its own bootstrap and chunk scripts. Without that, a strict `script-src`
  // blocks hydration on every page.
  const nonce = createNonce();
  const policy = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // Report-only unless `CSP_ENFORCE=1`: see `cspHeaderName`.
  response.headers.set(cspHeaderName(), policy);
  return response;
}
