import { budgetFor, clientKey, type Allowance, type LimitedRoute } from "./rate-limit";

/**
 * A shared counter for the API budgets, so they hold across instances.
 *
 * `lib/api/rate-limit.ts` counts in a `Map`, which on serverless means one
 * instance's worth of traffic: what the deployment will actually serve is that
 * budget multiplied by however many instances the platform decides to start. This
 * closes that gap with a counter every instance can see.
 *
 * **Two environment variables, both optional:**
 *
 *   RATE_LIMIT_REDIS_URL=https://eu1-xxxx.upstash.io
 *   RATE_LIMIT_REDIS_TOKEN=xxxx
 *
 * Any Redis-compatible HTTP endpoint works (Upstash's free tier is the usual
 * choice — it speaks HTTP, which is what makes it usable from a serverless
 * function without a connection pool). Unset, every check passes and nothing else
 * changes, so this costs nothing until you decide it is worth having.
 *
 * **It fails open, deliberately.** A counter store that is down or slow must not
 * take the API down with it: refusing every request because Redis blinked would be
 * worse than the abuse it prevents. On any error the request proceeds, and the
 * in-process limiter still applies.
 *
 * Privacy: the counter key contains the client IP, as the in-process one does, and
 * both expire after a minute. Nothing about the request itself is stored.
 */

/** Short on purpose: this sits in front of every API call. */
const TIMEOUT_MS = 1_500;

/** Must match the in-process window, or the two layers disagree about "now". */
const WINDOW_SECONDS = 60;

function store(): { url: string; token: string } | null {
  const url = process.env.RATE_LIMIT_REDIS_URL?.trim().replace(/\/+$/, "");
  const token = process.env.RATE_LIMIT_REDIS_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

/** One round trip for both counters, whichever way the answer goes. */
async function runPipeline(
  endpoint: { url: string; token: string },
  commands: unknown[][],
): Promise<number[]> {
  const response = await fetch(`${endpoint.url}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${endpoint.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`counter store answered ${response.status}`);

  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error("counter store answered nothing usable");

  return body.map((entry) => {
    const result = (entry as { result?: unknown })?.result;
    if (typeof result !== "number") throw new Error("counter store answered oddly");
    return result;
  });
}

/**
 * The shared verdict for this request.
 *
 * Both budgets are counted, mirroring the in-process pair: the client's own budget,
 * and the route ceiling a flood of rotating keys still has to pass. The answer is
 * the same shape as `allowRequest`'s, so a route can treat the two identically.
 */
export async function checkSharedLimit(
  request: Request,
  route: LimitedRoute,
): Promise<Allowance> {
  const endpoint = store();
  if (!endpoint) return { allowed: true, retryAfterSeconds: 0 };

  const budget = budgetFor(route);
  const clientPrefix = `rl:${route}:ip:${clientKey(request)}`;
  const routeKey = `rl:${route}:all`;

  try {
    const [clientCount, , clientTtl, routeCount, , routeTtl] = await runPipeline(
      endpoint,
      [
        ["INCR", clientPrefix],
        ["EXPIRE", clientPrefix, WINDOW_SECONDS, "NX"],
        ["TTL", clientPrefix],
        ["INCR", routeKey],
        ["EXPIRE", routeKey, WINDOW_SECONDS, "NX"],
        ["TTL", routeKey],
      ],
    );

    // `INCR` creates the key with no expiry; `EXPIRE … NX` then sets one, so the
    // window turns over on its own and a quiet route leaves nothing behind. A
    // missing TTL (-1) still means "wait for the window" rather than "wait zero".
    const retryAfter = (ttl: number | undefined) => ({
      allowed: false as const,
      retryAfterSeconds: ttl && ttl > 0 ? ttl : WINDOW_SECONDS,
    });

    if ((clientCount ?? 0) > budget.perClient) return retryAfter(clientTtl);
    if ((routeCount ?? 0) > budget.perRoute) return retryAfter(routeTtl);
    return { allowed: true, retryAfterSeconds: 0 };
  } catch {
    // Fail open, and say so nowhere: a store that is unreachable is an operational
    // problem, not the caller's fault, and the in-process limiter still applies.
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
