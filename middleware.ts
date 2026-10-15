import { NextResponse, type NextRequest } from "next/server";
import { limitedRouteForPath } from "@/lib/api/rate-limit";
import { checkSharedLimit } from "@/lib/api/rate-limit-store";

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
 */
export const config = { matcher: "/api/:path*" };

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const route = limitedRouteForPath(request.nextUrl.pathname);
  if (!route) return NextResponse.next();

  const allowance = await checkSharedLimit(request, route);
  if (allowance.allowed) return NextResponse.next();

  // `/api/rpc` owes its client a JSON-RPC error object, because its client is
  // web3.js and the app renders whatever comes back as an RPC failure. A plain
  // `{error}` body would reach it as a parse failure instead of a rate limit, so
  // this one endpoint gets the shape its own route would have sent.
  const body =
    route === "rpc"
      ? {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32005, message: "Rate limit exceeded. Try again shortly." },
        }
      : { error: "Too many requests from this address. Try again shortly." };

  return NextResponse.json(body, {
    status: 429,
    headers: { "Retry-After": String(allowance.retryAfterSeconds) },
  });
}
