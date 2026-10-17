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

function store(): { url: string; token: string; source: string } | null {
  for (const convention of STORE_CONVENTIONS) {
    const url = process.env[convention.url]?.trim().replace(/\/+$/, "");
    const token = process.env[convention.token]?.trim();
    if (url && token) {
      return { url, token, source: convention.source };
    }
  }
  return null;
}

/**
 * The environment conventions this accepts, in precedence order.
 *
 * Four pairs, because each is one a platform actually creates — and a deployment
 * that has to rename what its integration just created is a deployment that ends
 * up not configuring this at all. That is not hypothetical: production ran with no
 * store for days because the only names this read were ones nothing had set.
 *
 *   RATE_LIMIT_REDIS_URL/_TOKEN             this app's own names, first so they
 *                                           can override anything else
 *   RATE_LIMIT_REDIS_KV_REST_API_URL/_TOKEN what Vercel's integration creates
 *                                           when that prefix is chosen
 *   UPSTASH_REDIS_REST_URL/_TOKEN           what Upstash's dashboard gives you
 *   KV_REST_API_URL/_TOKEN                  an unprefixed Vercel connection
 */
const STORE_CONVENTIONS = [
  {
    source: "RATE_LIMIT_REDIS_URL",
    url: "RATE_LIMIT_REDIS_URL",
    token: "RATE_LIMIT_REDIS_TOKEN",
  },
  {
    // What Vercel's Upstash integration creates when the custom prefix is
    // `RATE_LIMIT_REDIS`: it prepends the prefix to its own KV_* names rather than
    // substituting into them, so the pair arrives as …_KV_REST_API_URL/…_TOKEN
    // instead of the …_URL/…_TOKEN two entries up. The connection also creates
    // …_KV_URL and …_REDIS_URL siblings, which are `redis://` connection strings
    // and are deliberately not read here — this client speaks HTTP.
    source: "RATE_LIMIT_REDIS_KV_REST_API_URL",
    url: "RATE_LIMIT_REDIS_KV_REST_API_URL",
    token: "RATE_LIMIT_REDIS_KV_REST_API_TOKEN",
  },
  {
    source: "UPSTASH_REDIS_REST_URL",
    url: "UPSTASH_REDIS_REST_URL",
    token: "UPSTASH_REDIS_REST_TOKEN",
  },
  {
    source: "KV_REST_API_URL",
    url: "KV_REST_API_URL",
    token: "KV_REST_API_TOKEN",
  },
] as const;

/**
 * Whether the shared counter is actually in play, for `/api/health`.
 *
 * "Configured" is not the useful fact — a wrong token or a paused database looks
 * configured — so this round-trips the store the way the provider checks do. It
 * exists because the failure it reports was invisible: the store was unset in
 * production, every check passed, and the deployment quietly served on the
 * per-instance budgets alone.
 */
export async function sharedLimiterStatus(): Promise<{
  configured: boolean;
  source: string | null;
  working: boolean;
  detail: string;
}> {
  const endpoint = store();
  if (!endpoint) {
    return {
      configured: false,
      source: null,
      working: false,
      detail:
        "No shared counter store, so the API budgets are per-instance — on serverless the real ceiling is the budget multiplied by however many instances are running. Add Upstash or Vercel Redis (their own variable names work), or set RATE_LIMIT_REDIS_URL and RATE_LIMIT_REDIS_TOKEN.",
    };
  }

  try {
    const [count] = await runPipeline(endpoint, [
      ["INCR", "rl:health:probe"],
      ["EXPIRE", "rl:health:probe", WINDOW_SECONDS, "NX"],
    ]);
    return {
      configured: true,
      source: endpoint.source,
      working: typeof count === "number",
      detail: `Counting through ${endpoint.source} — budgets hold across instances, not just per instance.`,
    };
  } catch (error) {
    return {
      configured: true,
      source: endpoint.source,
      working: false,
      detail: `Set from ${endpoint.source} but not answering (${
        error instanceof Error ? error.message.slice(0, 120) : "unknown error"
      }). Requests fail open, so only the per-instance budgets apply.`,
    };
  }
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
