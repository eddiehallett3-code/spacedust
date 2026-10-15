import { NextResponse } from "next/server";

/**
 * Best-effort rate limiting for the API routes.
 *
 * Why this exists: every route here spends somebody's API credits. The browser
 * cannot hold the Helius or Jupiter key, so it posts to these handlers and the
 * handlers attach it — which means anyone who can reach the app can spend those
 * credits, with `curl` if not with a browser. The method allow-list in
 * `lib/config/rpc-methods.ts` stops `/api/rpc` becoming a general-purpose relay,
 * but every method on that list is still chargeable, and `getTokenAccountsByOwner`
 * — a paged scan of every account an owner holds — is the expensive one.
 *
 * **What this is not.** A `Map` in a serverless function is per-instance and dies
 * with the instance, so on Vercel this caps what one instance will serve, not what
 * the deployment will serve. It raises the cost of abuse; it does not make abuse
 * impossible. The durable fix is limiting at the edge — a Cloudflare or Vercel WAF
 * rule, or a shared counter — and this module is what protects the keys until that
 * exists, and a second layer once it does.
 *
 * **Two budgets, because they fail differently.** A per-client budget stops one
 * script looping, but it is keyed on a forwarding header: on a platform that does
 * not overwrite that header, rotating it rotates the key, so it must not be the
 * only limit. A per-route ceiling cannot be spoofed at all, being one shared
 * counter, so it is the backstop any header-rotating flood still has to pass
 * through. The ceiling sits well above a client budget, so it is never the limit a
 * normal user meets.
 */

export type LimitedRoute =
  | "rpc"
  | "plan"
  | "tokens"
  | "domains"
  | "asset-proof"
  | "health";

/**
 * Requests per minute for a single client, sized against what the app itself does
 * rather than picked for roundness:
 *
 *  - `rpc` is the noisy one. Preparing one sweep fetches a blockhash, quotes fees
 *    and simulates each packed transaction, then sends and polls for status —
 *    dozens within a few seconds. 240/min passes an impatient repeat sweep while
 *    capping a loop at a rate Helius will not notice.
 *  - `plan` builds one plan per preview; `tokens`, `domains` and `asset-proof` each
 *    back a single screen's scan.
 *  - `health` is the most expensive *per call* — it makes one real upstream request
 *    per provider, including a DAS wallet scan, to answer "are the keys working?".
 *    12/min is one every five seconds, which covers any sane uptime monitor and
 *    caps an abuser at twelve wallet scans a minute instead of thousands. It is
 *    still limited rather than exempt, because "diagnostic" is not a reason to
 *    hand out an unmetered scan.
 */
const BUDGETS: Record<LimitedRoute, number> = {
  rpc: 240,
  plan: 60,
  tokens: 30,
  domains: 30,
  "asset-proof": 30,
  health: 12,
};

const WINDOW_MS = 60_000;

/**
 * How many clients' worth of traffic one route may serve per window before the
 * ceiling clamps it. High enough that a busy day never touches it, low enough that
 * a flood with randomised keys cannot run unbounded.
 */
const GLOBAL_MULTIPLIER = 50;

/** Above this many tracked keys, expired windows are dropped on the next request. */
const SWEEP_THRESHOLD = 5_000;

export interface Allowance {
  allowed: boolean;
  /** Whole seconds until the budget resets. `0` when the request is allowed. */
  retryAfterSeconds: number;
}

interface Counter {
  used: number;
  resetAt: number;
}

/**
 * The rate limiter, as a factory.
 *
 * Built this way so a test can hold its own instance with an injected clock
 * instead of reaching into module state to reset it — a limiter whose window
 * cannot be moved forward is a limiter whose reset behaviour cannot be tested, and
 * the reset is the part that goes wrong.
 */
export function createRateLimiter(options?: { windowMs?: number }) {
  const windowMs = options?.windowMs ?? WINDOW_MS;
  const perClient = new Map<string, Counter>();
  const perRoute = new Map<string, Counter>();

  function take(
    map: Map<string, Counter>,
    key: string,
    limit: number,
    now: number,
  ): Allowance {
    const existing = map.get(key);
    const counter =
      existing && existing.resetAt > now
        ? existing
        : { used: 0, resetAt: now + windowMs };

    if (counter.used >= limit) {
      map.set(key, counter);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((counter.resetAt - now) / 1000)),
      };
    }

    counter.used += 1;
    map.set(key, counter);
    if (map.size > SWEEP_THRESHOLD) sweep(map, now);

    return { allowed: true, retryAfterSeconds: 0 };
  }

  return function check(route: LimitedRoute, key: string, now = Date.now()): Allowance {
    const budget = BUDGETS[route];

    const client = take(perClient, `${route}|${key}`, budget, now);
    if (!client.allowed) return client;

    return take(perRoute, route, budget * GLOBAL_MULTIPLIER, now);
  };
}

/** Drop windows that have already reset, so the maps cannot grow without bound. */
function sweep(map: Map<string, Counter>, now: number): void {
  for (const [key, counter] of map) {
    if (counter.resetAt <= now) map.delete(key);
  }
}

/**
 * The bucket a request is counted against.
 *
 * The first entry of `x-forwarded-for` is the client; anything after it is a hop.
 * On a host that overwrites this header — Vercel does — it cannot be forged, which
 * is what makes the per-client budget meaningful there. On one that appends
 * instead, a client rotating the header gets a fresh budget every request, which is
 * why the per-route ceiling exists rather than a comment claiming this is airtight.
 *
 * A request with no forwarding information at all shares one bucket with every
 * other such request. That is the conservative direction: an unidentifiable caller
 * is pooled, not exempted.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}

/**
 * The two numbers a route is allowed, in one place.
 *
 * Exported so the shared counter in `rate-limit-store.ts` cannot drift from the
 * in-process one: both layers price the same route from the same source.
 */
export function budgetFor(route: LimitedRoute): {
  perClient: number;
  perRoute: number;
} {
  const budget = BUDGETS[route];
  return { perClient: budget, perRoute: budget * GLOBAL_MULTIPLIER };
}

/**
 * Which budget applies to a request path, or null for one no budget covers.
 *
 * Paths, not requests: this map is what lets a single middleware apply the right
 * budget to every API route without each route having to repeat its own name. An
 * `/api/` path that is not listed has no budget and is not counted — a new endpoint
 * then fails towards "unlimited" rather than towards "unexpectedly rate limited",
 * which is the failure that gets noticed and fixed.
 */
export function limitedRouteForPath(pathname: string): LimitedRoute | null {
  const match = /^\/api\/([^/?#]+)/.exec(pathname);
  const name = match?.[1];
  if (!name) return null;
  return name in BUDGETS ? (name as LimitedRoute) : null;
}

/** The instance the routes share. */
const limiter = createRateLimiter();

/**
 * Whether this request may proceed, and how long to wait if it may not.
 *
 * The caller formats its own refusal: `/api/rpc` owes its client a JSON-RPC error
 * object and the rest return a plain `NextResponse`, so this returns a verdict
 * rather than a response.
 */
export function allowRequest(request: Request, route: LimitedRoute): Allowance {
  return limiter(route, clientKey(request));
}

/**
 * The refusal, built once so every route answers identically.
 *
 * `Retry-After` is the reason this is shared rather than inlined five times: it is
 * the easiest part to leave out, and a client told to wait without being told how
 * long simply retries straight away.
 *
 * `/api/rpc` does not use this — it owes its client a JSON-RPC error object and
 * builds its own — which is exactly the kind of exception worth having one obvious
 * place for.
 */
export function rateLimitResponse(allowance: Allowance): NextResponse {
  return NextResponse.json(
    { error: "Too many requests from this address. Try again shortly." },
    { status: 429, headers: { "Retry-After": String(allowance.retryAfterSeconds) } },
  );
}
