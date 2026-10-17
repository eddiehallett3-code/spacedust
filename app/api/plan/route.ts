import { NextResponse } from "next/server";
import { z } from "zod";
import { allowRequest, rateLimitResponse } from "@/lib/api/rate-limit";
import { Connection } from "@solana/web3.js";
import { buildSwap, buildSwapsSerial, fetchPrices } from "@/lib/jupiter/server";
import { getServerRpcUrl } from "@/lib/config/env";
import { fetchRentMinimums } from "@/lib/solana/rent";
import { resolveAmount, type AmountProblem } from "@/lib/sweep/amounts";
import { nonCanonicalMints } from "@/lib/sweep/canonical";
import {
  MAX_TOKENS_PER_SWEEP,
  OUTPUT_ASSETS,
  SLIPPAGE_MAX_BPS,
  SLIPPAGE_MIN_BPS,
} from "@/lib/utils/constants";
import {
  baseAmountToNumber,
  isValidSolanaAddress,
  parseBaseAmount,
} from "@/lib/utils/sanitize";
import type { PlanResponse, SwapBuild } from "@/types/sweep";

/**
 * `POST /api/plan`
 *
 * Builds one Jupiter `/build` route per selected token and returns the raw
 * instructions to the browser.
 *
 * WHY INSTRUCTIONS AND NOT QUOTES: Jupiter's `/build` returns *instructions*
 * specifically so integrators can compose their own transactions. That is what
 * lets the client pack many dust swaps and their `closeAccount` calls into a
 * single transaction. Nothing is signed here — this route only reads.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TokenInputSchema = z.object({
  mint: z.string().refine(isValidSolanaAddress, "Invalid mint"),
  symbol: z.string().max(16).optional(),
  logoUri: z.string().max(512).nullable().optional(),
  rawAmount: z.string().regex(/^\d{1,30}$/, "Invalid amount"),
  /**
   * How much of `rawAmount` to actually swap, in base units. Absent means all of
   * it, which is the original dust-sweep behaviour.
   *
   * Both numbers are needed, not just the one being swapped: whether the swap
   * empties the account decides whether its rent can be reclaimed, and a partial
   * amount leaves a balance behind that `closeAccount` refuses to act on. See
   * `lib/sweep/amounts.ts`.
   */
  swapAmountRaw: z.string().regex(/^\d{1,30}$/, "Invalid swap amount").optional(),
  program: z.enum(["legacy", "token2022"]),
  /**
   * The token account the scanner found holding this balance. Optional so an
   * older client still works; when present and valid it is preferred over a
   * re-derived ATA for rent reclaim.
   */
  tokenAccount: z.string().refine(isValidSolanaAddress, "Invalid token account").nullable().optional(),
  hasTransferFee: z.boolean().optional(),
  valueUsd: z.number().min(0).max(1e12).optional(),
});

const PlanRequestSchema = z.object({
  owner: z.string().refine(isValidSolanaAddress, "Invalid owner"),
  tokens: z.array(TokenInputSchema).min(1).max(MAX_TOKENS_PER_SWEEP),
  outputMint: z.string().refine(isValidSolanaAddress, "Invalid output mint"),
  slippageBps: z.number().int().min(SLIPPAGE_MIN_BPS).max(SLIPPAGE_MAX_BPS),
});

/**
 * Only these two output assets are permitted.
 *
 * This is a hard allow-list, not a UI-only constraint: an open output mint would
 * let a crafted request point a user's dust at an attacker's token.
 */
const ALLOWED_OUTPUT_MINTS = new Set<string>([
  OUTPUT_ASSETS.SOL.mint,
  OUTPUT_ASSETS.USDC.mint,
  OUTPUT_ASSETS.JUP.mint,
]);

export async function POST(request: Request) {
  // One plan per preview, and each plan quotes Jupiter and simulates against the
  // cluster, so this is metered as a scan rather than as a read.
  const quota = allowRequest(request, "plan");
  if (!quota.allowed) return rateLimitResponse(quota);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: first?.message ?? "Invalid sweep request",
        issues: parsed.error.issues.slice(0, 5).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const { owner, tokens, outputMint, slippageBps } = parsed.data;

  if (!ALLOWED_OUTPUT_MINTS.has(outputMint)) {
    return NextResponse.json(
      { error: "Output asset must be SOL, USDC or JUP." },
      { status: 400 },
    );
  }

  // Re-validate amounts after parsing. Zod matched the shape; this confirms each
  // one is a non-zero value we will actually swap.
  const sweepable = tokens.filter((token) => {
    const amount = parseBaseAmount(token.rawAmount);
    return amount != null && amount > 0n;
  });

  if (sweepable.length === 0) {
    return NextResponse.json(
      { error: "None of the selected tokens have a valid non-zero balance." },
      { status: 400 },
    );
  }

  // Decided before any upstream call, so a holding a swap cannot reach costs no
  // Jupiter request and no RPC read. See `nonCanonicalMints` for why the account
  // Jupiter will drain is not necessarily the one the scanner reported.
  const unreachable = nonCanonicalMints(owner, sweepable);

  const startedAt = Date.now();

  try {
    // One price batch for the output asset plus every input, so we can report a
    // real price-impact figure instead of a guess.
    const priceInput = new Set<string>([
      outputMint,
      ...sweepable.map((token) => token.mint),
    ]);
    let prices: Record<string, { usdPrice: number }> = {};
    try {
      const fetched = await fetchPrices(Array.from(priceInput));
      prices = Object.fromEntries(
        Object.entries(fetched).map(([mint, entry]) => [
          mint,
          { usdPrice: entry.usdPrice },
        ]),
      );
    } catch {
      // Price impact is a nice-to-have. Losing it must not block the sweep.
      prices = {};
    }

    const outputDecimals =
      outputMint === OUTPUT_ASSETS.SOL.mint
        ? OUTPUT_ASSETS.SOL.decimals
        : OUTPUT_ASSETS.USDC.decimals;
    const outputPriceUsd = prices[outputMint]?.usdPrice ?? null;

    // Resolve what each token will actually swap, once. The build, the USD
    // figures and the rent-reclaim count all read this same map, so the three
    // cannot disagree about how much is being swapped.
    const swapAmounts = new Map<string, string>();
    const amountFailures: PlanResponse["failures"] = [];
    const toBuild: typeof sweepable = [];
    for (const token of sweepable) {
      // A balance Jupiter's route cannot reach: the swap drains the wallet's
      // associated account, not the one the scanner named. Reported rather than
      // dropped, because The Void can still take it — a burn acts on the reported
      // account.
      if (unreachable.has(token.mint)) {
        amountFailures.push({
          mint: token.mint,
          symbol: token.symbol ?? "???",
          reason:
            "Held in a non-standard token account, which a swap cannot drain — send it into The Void instead.",
        });
        continue;
      }

      const amount = resolveAmount(token.rawAmount, token.swapAmountRaw ?? null);
      if (!amount.ok) {
        amountFailures.push({
          mint: token.mint,
          symbol: token.symbol ?? "???",
          reason: describeAmountProblem(amount.problem),
        });
        continue;
      }
      swapAmounts.set(token.mint, amount.raw);
      toBuild.push(token);
    }

    const results = await buildSwapsSerial(
      toBuild,
      async (token) =>
        buildSwap({
          inputMint: token.mint,
          outputMint,
          // The chosen amount, or the whole balance when nothing was chosen.
          amount: swapAmounts.get(token.mint) ?? token.rawAmount,
          taker: owner,
          slippageBps,
          maxAccounts: 32,
        }),
      { concurrency: 4, gapMs: 120 },
    );

    const processed = processSwaps({
      results,
      sweepable: toBuild,
      swapAmounts,
      prices,
      outputMint,
      outputDecimals,
      outputPriceUsd,
    });

    // Rent is fetched, not assumed. The network halved-and-a-bit its rent rate
    // once already, and because the old constant fed both this total AND The
    // Void's percentage fee, a stale number moved real money. Never again.
    const rent = await fetchRentMinimums(
      new Connection(getServerRpcUrl(), "confirmed"),
    );

    const payload: PlanResponse = {
      builds: processed.builds,
      // Amount problems first: when every token was refused for its amount, the
      // client reports `failures[0].reason`, and "Jupiter could not route" would
      // be the wrong explanation for a request we declined ourselves.
      failures: [...amountFailures, ...processed.failures],
      totalInValueUsd: processed.totalInValueUsd,
      totalExpectedOutUsd: processed.totalExpectedOutUsd,
      estimatedRentReclaimLamports:
        processed.rentReclaimMints * rent.tokenAccount,
      tokenAccountRentLamports: rent.tokenAccount,
      emptyAccountRentLamports: rent.emptyAccount,
      warnings: [],
      // Base fee for a single signature. The client recalculates this precisely
      // once the packer knows the real transaction count.
      estimatedFeeLamports: 5000,
      createdAt: Date.now(),
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
        "X-Plan-Duration-Ms": String(Date.now() - startedAt),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to build the sweep.";
    return NextResponse.json(
      { error: message, provider: "jupiter" },
      { status: 502 },
    );
  }
}

interface ProcessSwapsInput {
  results: Array<{
    item: z.infer<typeof TokenInputSchema>;
    result?: Awaited<ReturnType<typeof buildSwap>>;
    error?: string;
  }>;
  sweepable: Array<z.infer<typeof TokenInputSchema>>;
  /** mint → the base-unit amount that was actually built, from `resolveAmount`. */
  swapAmounts: Map<string, string>;
  prices: Record<string, { usdPrice: number }>;
  outputMint: string;
  outputDecimals: number;
  outputPriceUsd: number | null;
}

interface ProcessSwapsOutput {
  builds: SwapBuild[];
  failures: PlanResponse["failures"];
  totalInValueUsd: number;
  totalExpectedOutUsd: number;
  rentReclaimMints: number;
}

/**
 * Turn Jupiter's per-token responses into a validated plan.
 *
 * Every entry is re-checked here. Jupiter is trusted to be a well-behaved API,
 * not trusted to be correct: an echoed `inputMint` that does not match what we
 * asked for means something is badly wrong, and we drop that token rather than
 * build an instruction for the wrong pair.
 */
function processSwaps({
  results,
  sweepable,
  swapAmounts,
  outputMint,
  outputDecimals,
  outputPriceUsd,
}: ProcessSwapsInput): ProcessSwapsOutput {
  const builds: SwapBuild[] = [];
  const failures: PlanResponse["failures"] = [];
  let totalInValueUsd = 0;
  let totalExpectedOutUsd = 0;
  let rentReclaimMints = 0;

  results.forEach((entry, index) => {
    const token = sweepable[index];
    if (!token) return;

    const fail = (reason: string): void => {
      failures.push({
        mint: token.mint,
        symbol: token.symbol ?? "???",
        reason,
      });
    };

    if (entry.error || !entry.result) {
      fail(entry.error ?? "Jupiter returned no route");
      return;
    }

    const data = entry.result;

    if (data.inputMint !== token.mint || data.outputMint !== outputMint) {
      fail("Jupiter returned a route for a different pair");
      return;
    }

    const outAmount = parseBaseAmount(data.outAmount);
    if (outAmount == null || outAmount <= 0n) {
      fail("Jupiter quoted a zero output amount");
      return;
    }

    const fullAmount = parseBaseAmount(token.rawAmount) ?? 0n;
    const inputAmount =
      parseBaseAmount(swapAmounts.get(token.mint) ?? token.rawAmount) ?? 0n;
    if (inputAmount <= 0n) {
      fail("There is no amount to swap");
      return;
    }

    const outValueUsd =
      outputPriceUsd == null
        ? 0
        : (baseAmountToNumber(outAmount, outputDecimals) ?? 0) * outputPriceUsd;

    // Value is scaled to what is being swapped, not to the whole balance: 10% of
    // a $500 token contributes $50 to the total. Price impact has to compare like
    // with like for the same reason — against the full balance, a partial swap
    // would read as a catastrophic loss when nothing was lost.
    const swappedFraction =
      fullAmount > 0n ? Number((inputAmount * 10_000n) / fullAmount) / 10_000 : 1;
    const inValueUsd = (token.valueUsd ?? 0) * swappedFraction;

    // Real price impact: the fraction of input value lost to spread and fees.
    const priceImpactPct =
      inValueUsd > 0 && outputPriceUsd != null && outValueUsd > 0
        ? Math.max(0, 1 - outValueUsd / inValueUsd)
        : null;

    const routeLabels = Array.from(
      new Set(
        (data.routePlan ?? [])
          .map((step) => step?.swapInfo?.label)
          .filter((label): label is string => typeof label === "string"),
      ),
    );

    builds.push({
      mint: token.mint,
      symbol: token.symbol ?? "???",
      logoUri: token.logoUri ?? null,
      inAmount: inputAmount.toString(),
      tokenAccount: token.tokenAccount ?? null,
      outAmount: data.outAmount,
      otherAmountThreshold: data.otherAmountThreshold,
      outputMint,
      priceImpactPct,
      routeLabels,
      // We set one shared compute budget for the whole packed transaction, so
      // Jupiter's per-swap budget is dropped and never reaches the chain.
      computeBudgetInstructions: [],
      bundle: {
        setup: data.setupInstructions ?? [],
        swap: data.swapInstruction,
        cleanup: data.cleanupInstruction ?? null,
        other: data.otherInstructions ?? [],
      },
      addressesByLookupTableAddress: data.addressesByLookupTableAddress ?? null,
      lastValidBlockHeight: data.blockhashWithMetadata?.lastValidBlockHeight ?? 0,
      error: null,
    });

    // The chosen amount's value, not the whole holding's — the same figure the
    // price impact above is computed against, so the two can never disagree.
    totalInValueUsd += inValueUsd;
    totalExpectedOutUsd += outValueUsd;

    // Rent is only reclaimable when the swap empties the account. A partial
    // amount leaves a balance behind, and `closeAccount` refuses a non-empty
    // account — which, because the packer batches many swaps into one
    // transaction, would take the whole sweep down rather than just this close.
    // A transfer-fee mint keeps a residue for its own reason.
    if (!token.hasTransferFee && inputAmount === fullAmount) rentReclaimMints += 1;
  });

  return {
    builds,
    failures,
    totalInValueUsd,
    totalExpectedOutUsd,
    rentReclaimMints,
  };
}

/**
 * What the user is told when their chosen amount cannot be used.
 *
 * Written here rather than at the throw site so every path that refuses an
 * amount says the same thing — the same rule the rest of this app follows for
 * copy that reaches a screen.
 */
function describeAmountProblem(problem: AmountProblem): string {
  switch (problem) {
    case "exceeds-balance":
      return "The amount is more than the balance held, so it was not swapped.";
    case "zero":
      return "The amount to swap is zero.";
    default:
      return "That is not a usable amount.";
  }
}