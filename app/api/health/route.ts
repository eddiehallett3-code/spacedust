import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { allowRequest, rateLimitResponse } from "@/lib/api/rate-limit";
import { sharedLimiterStatus } from "@/lib/api/rate-limit-store";
import {
  getHeliusApiKey,
  getJupiterApiKey,
  getServerRpcUrl,
} from "@/lib/config/env";
import { getPublicFeeWallet } from "@/lib/config/public-env";
import { feeAccountExists } from "@/lib/solana/fee.server";
import { swapFeeAccount } from "@/lib/solana/fee-account";
import { fetchRentMinimums } from "@/lib/solana/rent";
import { scanWallet } from "@/lib/token-source/index.server";
import { OUTPUT_ASSETS, SWAP_FEE_BPS } from "@/lib/utils/constants";

/**
 * `GET /api/health` — setup diagnostics.
 *
 * "Are my keys configured?" is the first question anyone asks, and guessing is
 * slow. This endpoint reports, per provider, whether a key is present **and
 * whether it actually works**, by making one real upstream call.
 *
 * It returns no secret material — only booleans, provider names, and error text.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Check {
  configured: boolean;
  working: boolean;
  detail: string;
}

/** One output asset's fee account, and whether a fee could land in it. */
interface FeeAccountReport {
  symbol: string;
  mint: string;
  account: string;
  usable: boolean;
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
      checks.helius.detail =
        error instanceof Error
          ? `Key rejected or quota exhausted: ${error.message.slice(0, 160)}`
          : "Helius scan failed.";
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
    checks.jupiter.detail =
      error instanceof Error ? error.message.slice(0, 160) : "Jupiter unreachable.";
  }

  // ── Integrator fees ──────────────────────────────────────────────────────
  // The destination is the fee wallet's own token account for each output asset:
  // a swap fee is charged in the output mint, so it needs one account per asset.
  // Each is read from chain rather than assumed, because Jupiter verifies none of
  // them — a missing or frozen account does not error, it just produces a swap
  // that cannot land. What the fee is *worth* needs no reading: it is ours in
  // full, with no claim step and no program taking a share.
  const feeWallet = getPublicFeeWallet();
  const rate = (SWAP_FEE_BPS / 100).toFixed(1);
  const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
  let feeAccounts: FeeAccountReport[] = [];

  if (!feeWallet) {
    checks.fees.detail =
      `Not set — swaps run fee-free. Set NEXT_PUBLIC_FEE_WALLET to a wallet you control to collect ${rate}% of each swap's output, in the output asset itself.`;
  } else {
    feeAccounts = await Promise.all(
      Object.values(OUTPUT_ASSETS).map(async (asset) => {
        const account = swapFeeAccount(feeWallet, asset.mint);
        return {
          symbol: asset.symbol,
          mint: asset.mint,
          account,
          usable: await feeAccountExists(account),
        };
      }),
    );

    const ready = feeAccounts.filter((entry) => entry.usable);
    const missing = feeAccounts.filter((entry) => !entry.usable);
    checks.fees.working = missing.length === 0;

    checks.fees.detail =
      missing.length === 0
        ? `${rate}% fee active on all ${feeAccounts.length} output assets, paid into ${short(feeWallet)} in the output asset itself — no claim step, and no third party's cut.`
        : `${rate}% fee CANNOT be collected for ${missing.map((m) => m.symbol).join(", ")}: ${short(feeWallet)} has no usable token account for those assets, so swaps into them run fee-free. Missing: ${missing.map((m) => `${m.symbol} → ${m.account}`).join(" | ")}. Ready: ${ready.map((r) => r.symbol).join(", ") || "none"}.`;
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

  /**
   * What a new token account costs, read from the chain rather than quoted from
   * a constant.
   *
   * This figure is printed inside an instruction that somebody is about to act
   * on, and the constant it used to quote was **wrong by 37%**: it said
   * ~0.00204 SOL where the network now charges 1,488,440 lamports for a freshly
   * created account. A number that costs real money to follow is the last place
   * to repeat a remembered value — the same reasoning as `lib/solana/rent.ts`,
   * which is why the app prices rent per account everywhere else.
   *
   * A failure here is swallowed: diagnostics must not fail over a rent read, and
   * the wording degrades to a version that needs no figure.
   */
  let tokenAccountRentLamports: number | null = null;
  try {
    const rent = await fetchRentMinimums(
      new Connection(getServerRpcUrl(), "confirmed"),
    );
    tokenAccountRentLamports = rent.tokenAccount;
  } catch {
    tokenAccountRentLamports = null;
  }

  return NextResponse.json({
    ok: !anyBlockingIssue,
    checks,
    nextSteps: buildNextSteps(checks, feeAccounts, tokenAccountRentLamports),
  });
}

/** Turn the results into instructions a human can act on. */
function buildNextSteps(
  checks: { helius: Check; jupiter: Check; fees: Check; ratelimit: Check },
  feeAccounts: FeeAccountReport[],
  /**
   * Live rent-exempt minimum for one token account, in lamports, or null when
   * the read failed. Null changes only the wording, never the instruction.
   */
  tokenAccountRentLamports: number | null,
): string[] {
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

  // Both fee paths read the same variable — the swap fee in the output asset,
  // the rent-reclaim fee as SOL — so an unset wallet is one instruction here,
  // not two that say almost the same thing.
  if (!checks.fees.configured) {
    steps.push(
      "Optional: set NEXT_PUBLIC_FEE_WALLET to a wallet you control. It collects both fees — 0.5% of each swap's output, in the output asset, and 1.5% of the rent any flow reclaims, as SOL. Leave it unset to charge nothing anywhere.",
    );
  } else if (!checks.fees.working) {
    const feeWallet = getPublicFeeWallet();
    // The cost is the live rent-exempt minimum for one 165-byte account — which
    // is exactly what the command below locks up. When that read failed the
    // sentence drops the figure rather than quoting a remembered one.
    const cost =
      tokenAccountRentLamports == null
        ? "a few thousand lamports of rent, refunded if you close it"
        : `~${(tokenAccountRentLamports / 1e9).toFixed(5)} SOL of rent, refunded if you close it`;
    // One command per missing account: the mint and the owner are the only parts
    // that vary, and both are known right here.
    for (const entry of feeAccounts.filter((account) => !account.usable)) {
      steps.push(
        `Create the ${entry.symbol} fee account (${cost}; whoever pays is the only signer): ` +
          `spl-token create-account ${entry.mint} --owner ${feeWallet} --fee-payer <YOUR WALLET> -u mainnet-beta`,
      );
    }
    steps.push(
      "Until an account exists, swaps into that asset run fee-free rather than failing — a fee is only ever asked for once its destination is confirmed usable.",
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