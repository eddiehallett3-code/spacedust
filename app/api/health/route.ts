import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { allowRequest, rateLimitResponse } from "@/lib/api/rate-limit";
import { sharedLimiterStatus } from "@/lib/api/rate-limit-store";
import { describeFailure, redactForLog } from "@/lib/api/redact";
import {
  getHeliusApiKey,
  getJupiterApiKey,
  getServerRpcUrl,
} from "@/lib/config/env";
import { getPublicFeeWallet } from "@/lib/config/public-env";
import { fetchRentMinimums } from "@/lib/solana/rent";
import { scanWallet } from "@/lib/token-source/index.server";

/**
 * `GET /api/health` — setup diagnostics.
 *
 * "Are my keys configured?" is the first question anyone asks, and guessing is
 * slow. This endpoint reports, per provider, whether a key is present **and
 * whether it actually works**, by making one real upstream call.
 *
 * It returns no secret material — only booleans, provider names, and a scrubbed
 * sentence per failure. That last part is load-bearing: this endpoint is public
 * and unauthenticated, and the key it is testing lives *inside* the RPC URL, so a
 * provider error that echoes the request URL would echo the key. Nothing upstream
 * is repeated verbatim; see `lib/api/redact.ts`, and the operator-facing copy of
 * each failure in the server log.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Check {
  configured: boolean;
  working: boolean;
  detail: string;
}

export async function GET(request: Request) {
  // The most expensive route per call — one real upstream request per provider,
  // including a DAS wallet scan — so it is metered rather than exempted on the
  // grounds of being a diagnostic. 12/min leaves room for a monitor checking every
  // five seconds.
  const quota = allowRequest(request, "health");
  if (!quota.allowed) return rateLimitResponse(quota);
  const checks: {
    helius: Check;
    jupiter: Check;
    fees: Check;
    ratelimit: Check;
  } = {
    helius: {
      configured: Boolean(getHeliusApiKey()),
      working: false,
      detail: "",
    },
    jupiter: {
      configured: Boolean(getJupiterApiKey()),
      working: false,
      detail: "",
    },
    fees: {
      configured: Boolean(getPublicFeeWallet()),
      working: false,
      detail: "",
    },
    ratelimit: {
      configured: false,
      working: false,
      detail: "",
    },
  };

  // ── Helius: prove it by scanning a known-active address ──────────────────
  if (!checks.helius.configured) {
    checks.helius.detail =
      "Not set. Spacedust falls back to the free public RPC, which is slower and rate-limited.";
  } else {
    try {
      // A widely-used burn address: guaranteed to hold many accounts, so the
      // scan exercises pagination rather than returning instantly.
      const result = await scanWallet("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

      if (result.source !== "helius-das") {
        // The key is present but DAS did not serve the request — the provider
        // selector fell back silently. Say so, because this is exactly the
        // kind of failure that otherwise looks like it is working.
        checks.helius.working = false;
        checks.helius.detail =
          `Key is set, but DAS did NOT serve the scan — it silently fell back to core-rpc ` +
          `(${result.holdings.length} holdings). Check the Helius dashboard for quota ` +
          `or an API change.`;
      } else {
        checks.helius.working = true;
        checks.helius.detail = `DAS responded — ${result.holdings.length} holdings via helius-das.`;
      }
    } catch (error) {
      // The public field is a diagnosis, not a transcript. The full message can
      // name the endpoint — and this endpoint carries the key in its query string
      // — so the raw error goes to the deployment log, where only the operator can
      // read it, and the response gets the same sentence with the key scoured out.
      console.warn(
        "[spacedust] /api/health: Helius probe failed —",
        redactForLog(error, [getHeliusApiKey() ?? "", getServerRpcUrl()]),
      );
      checks.helius.detail = `Key rejected or quota exhausted: ${describeFailure(
        error,
        [getHeliusApiKey() ?? "", getServerRpcUrl()],
      )}`;
    }
  }

  // ── Jupiter: prove it by fetching one price ──────────────────────────────
  try {
    const apiKey = getJupiterApiKey();
    const response = await fetch(
      "https://api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112",
      {
        headers: {
          Accept: "application/json",
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      },
    );
    const sol = (await response.json()) as Record<string, { usdPrice?: number }>;
    const price = sol["So11111111111111111111111111111111111111112"]?.usdPrice;
    if (response.ok && typeof price === "number") {
      checks.jupiter.working = true;
      checks.jupiter.detail = `Price API responding — SOL = $${price.toFixed(2)}${
        apiKey ? " (authenticated)" : " (keyless)"
      }.`;
    } else {
      checks.jupiter.detail = `Price API returned ${response.status}.${
        apiKey ? " The key may be invalid." : " Keyless access may be rate-limited."
      }`;
    }
  } catch (error) {
    // Same rule as Helius: the key here travels in a header rather than a URL, so
    // it is less likely to be echoed — but "less likely" is not a reason to quote
    // an upstream message at a public endpoint.
    console.warn(
      "[spacedust] /api/health: Jupiter probe failed —",
      redactForLog(error, [getJupiterApiKey() ?? ""]),
    );
    checks.jupiter.detail = `Jupiter unreachable: ${describeFailure(error, [
      getJupiterApiKey() ?? "",
    ])}`;
  }

  // ── Integrator fees ──────────────────────────────────────────────────────
  // One fee, and it is on reclaimed rent: a plain SOL transfer to the fee wallet
  // once each close has handed the rent back. There is no token account to create
  // and no asset list to keep in step — but the wallet does have to be *funded*,
  // because Solana refuses to send to an account below the rent-exempt minimum
  // and these fees are tens of thousands of lamports, far below it. An unfunded
  // wallet is therefore not "a fee that arrives later"; it is a transaction that
  // fails, which is why every flow checks before charging.
  const feeWallet = getPublicFeeWallet();
  const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

  if (!feeWallet) {
    checks.fees.detail =
      "Not set — every flow runs fee-free. Set NEXT_PUBLIC_FEE_WALLET to a wallet you control to collect 1.5% of the rent each flow reclaims, as SOL.";
  } else {
    let funded = false;
    try {
      const connection = new Connection(getServerRpcUrl(), "confirmed");
      const [rent, info] = await Promise.all([
        fetchRentMinimums(connection),
        connection.getAccountInfo(new PublicKey(feeWallet)),
      ]);
      funded = (info?.lamports ?? 0) >= rent.emptyAccount;
    } catch {
      funded = false;
    }

    checks.fees.working = funded;
    checks.fees.detail = funded
      ? `1.5% of reclaimed rent is paid to ${short(feeWallet)} as plain SOL — no claim step, and no token account to create.`
      : `${short(feeWallet)} is not funded, so every flow runs fee-free: a fee this small cannot create the account, and Solana refuses to send below the rent-exempt minimum.`;
  }

  // ── Rate limiting ────────────────────────────────────────────────────────
  // Not a provider, but the same question: is the thing protecting these keys
  // actually in play? It was not, for days — the shared counter is optional by
  // design, so an unset variable let every check pass while the deployment ran on
  // per-instance budgets alone. Advisory rather than blocking: the app works
  // either way, so this never turns `ok` false.
  const limiters = await sharedLimiterStatus();
  checks.ratelimit = {
    configured: limiters.configured,
    working: limiters.working,
    detail: limiters.detail,
  };

  const anyBlockingIssue =
    !checks.helius.working || !checks.jupiter.working;

  return NextResponse.json({
    ok: !anyBlockingIssue,
    checks,
    nextSteps: buildNextSteps(checks),
  });
}

/** Turn the results into instructions a human can act on. */
function buildNextSteps(checks: {
  helius: Check;
  jupiter: Check;
  fees: Check;
  ratelimit: Check;
}): string[] {
  const steps: string[] = [];

  if (!checks.helius.configured) {
    steps.push(
      "Optional: get a free Helius key at https://helius.dev and set HELIUS_API_KEY in .env.local, then restart the dev server. The app works without it, just slower.",
    );
  } else if (!checks.helius.working) {
    steps.push(
      "HELIUS_API_KEY is set but not working. Check you copied the whole key (no quotes/spaces) and that the free tier's daily credits are not exhausted.",
    );
  } else {
    steps.push("Helius is configured and responding. Nothing to do.");
  }

  if (checks.jupiter.working) {
    steps.push(
      checks.jupiter.configured
        ? "Jupiter is configured and responding."
        : "Jupiter works keyless. A free key at https://portal.jup.ag raises the rate limit.",
    );
  } else {
    steps.push(
      "Jupiter is not responding. Set JUPITER_API_KEY in .env.local (free at https://portal.jup.ag).",
    );
  }

  // One wallet, one fee: the rent-reclaim fee, as SOL.
  if (!checks.fees.configured) {
    steps.push(
      "Optional: set NEXT_PUBLIC_FEE_WALLET to a wallet you control. It collects 1.5% of the rent any flow reclaims, as SOL. Leave it unset to charge nothing anywhere.",
    );
  } else if (!checks.fees.working) {
    steps.push(
      "NEXT_PUBLIC_FEE_WALLET is set but not funded. Send it a little SOL: a fee this small cannot create the account, and Solana refuses to send to an address below the rent-exempt minimum. Every flow runs fee-free until it is funded.",
    );
  }

  // Advisory, not a setup blocker: without a store the app still works, it just
  // enforces each budget per instance instead of across the deployment. The cost
  // lands on Helius credits, which is why it is worth saying even though nothing
  // is broken.
  if (checks.ratelimit.working) {
    steps.push(
      "API budgets are counted in a shared store, so the limits hold across instances.",
    );
  } else if (checks.ratelimit.configured) {
    steps.push(
      "The counter store is set but not answering — check the URL and token, and that the database is not paused. Requests fail open meanwhile, so only the per-instance budgets apply.",
    );
  } else {
    steps.push(
      "Optional, and worth doing before this is public: the API budgets are per-instance until a shared counter exists, so anyone reaching the app can spend Helius credits up to the budget times however many instances run. Add Upstash or Vercel Redis — their own variable names are read as-is — or set RATE_LIMIT_REDIS_URL and RATE_LIMIT_REDIS_TOKEN.",
    );
  }

  return steps;
}