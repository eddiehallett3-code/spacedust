import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { allowRequest, rateLimitResponse } from "@/lib/api/rate-limit";
import { MintLayout } from "@solana/spl-token";
import { z } from "zod";
import { scanWallet } from "@/lib/token-source/index.server";
import {
  looksLikeCollectible,
  toCollectibleAsset,
} from "@/lib/token-source/collectible-shape";
import { fetchTokenMetadata, type TokenMetadata } from "@/lib/token-source/metadata.server";
import { fetchPrices } from "@/lib/jupiter/server";
import { runWithConcurrency } from "@/lib/utils/concurrency";
import { priceAllMints } from "@/lib/token-source/prices";
import { getServerRpcUrl, MissingEnvError } from "@/lib/config/env";
import { isPoolPosition } from "@/lib/sweep/pool-positions";
import { stakedTokenFor } from "@/lib/staking/staked-tokens";
import { readNativeStakeAccounts } from "@/lib/staking/native-stake.server";
import { readTokenApprovals } from "@/lib/solana/approvals";
import { readSnsDomains } from "@/lib/salvage/sns.server";
import { listWrappedSolAccounts } from "@/lib/token-source/wrapped-sol.server";
import { fetchRentMinimums } from "@/lib/solana/rent";
import { OUTPUT_ASSETS } from "@/lib/utils/constants";
import {
  baseAmountToNumber,
  isValidSolanaAddress,
  parseBaseAmount,
  sanitizeLogoUri,
  sanitizeSymbol,
  sanitizeText,
} from "@/lib/utils/sanitize";
import type { DustToken, WalletScan } from "@/types/token";
import type { SalvageDomain, WrappedSolAccount } from "@/types/salvage";

/**
 * `GET /api/tokens?owner=<pubkey>`
 *
 * Returns every dust-eligible SPL and Token-2022 holding, already valued in USD.
 *
 * `approvals=1` adds the approvals read; `extras=1` adds wSOL and SNS names for
 * the full Wallet Scan. Both are opt-in so the sweeper's ordinary rescan does
 * not pay for a read it never displays.
 *
 * Runs on the server so the Helius key and the Jupiter key both stay private.
 */

export const runtime = "nodejs";
/**
 * How long this function may run before the platform cuts it.
 *
 * A wallet with thousands of holdings is genuinely expensive: every mint is
 * priced 50 at a time and every mint authority read 100 at a time. Both loops now
 * run four batches at a time rather than one after another, which is most of a
 * 49-second scan back — but the budget is still declared rather than inherited,
 * because the work remains proportional to the wallet and a platform default that
 * changed would start cutting scans at a number nobody chose.
 *
 * The client waits 90 seconds (`hooks/use-wallet-scan.ts`), deliberately longer
 * than this: the server should be the one to give up, with an error the user can
 * read, rather than the browser aborting a request that is about to finish.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  owner: z
    .string()
    .refine(isValidSolanaAddress, { message: "Not a valid Solana address" }),
});

export async function GET(request: Request) {
  // Before the scan, not after: this route runs a DAS wallet scan plus metadata
  // and price lookups on every call, so the cheapest possible rejection is the
  // only one worth having.
  const quota = allowRequest(request, "tokens");
  if (!quota.allowed) return rateLimitResponse(quota);

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({ owner: url.searchParams.get("owner") });
  // `/scan` asks for this; the sweeper does not need an approvals read on every
  // rescan, so it stays opt-in rather than adding two owner-wide account reads
  // to every request.
  const wantsApprovals = url.searchParams.get("approvals") === "1";
  // Wallet Scan asks for the full read: wSOL and SNS names are not needed by
  // the sweeper, Salvage or Payload, so they stay opt-in rather than adding
  // two extra owner-wide reads to every rescan.
  const wantsExtras = url.searchParams.get("extras") === "1";

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide a valid Solana wallet address." },
      { status: 400 },
    );
  }

  const startedAt = Date.now();

  try {
    const {
      holdings,
      nonFungibles,
      nativeLamports,
      pages,
      truncated,
      source,
      emptyAccounts,
      emptyAccountsError,
    } = await scanWallet(parsed.data.owner);

    const prices = await priceAllMints(
      holdings.map((holding) => holding.mint),
      fetchPrices,
    );

    /**
     * Enrich metadata, but only where it is actually needed.
     *
     * DAS already returns symbols and logos, so this only runs on the free
     * core-RPC path. And it only runs for tokens that have a price — a dust
     * wallet can hold thousands of worthless mints, and Jupiter's token
     * endpoint is rate-limited on the keyless tier. Fetching metadata for only
     * the tradeable handful is both faster and far kinder to the API.
     */
    let metadata = new Map<string, TokenMetadata>();
    if (source === "core-rpc") {
      const pricedMints = holdings
        .filter((holding) => prices[holding.mint] != null)
        .map((holding) => holding.mint);
      metadata = await fetchTokenMetadata(pricedMints);
    }

    const poolLike = new Set<string>();
    let poolLikeError: string | null = null;
    const connection = new Connection(getServerRpcUrl(), "confirmed");
    const approvalsRead: Promise<{
      list: Awaited<ReturnType<typeof readTokenApprovals>> | null;
      error: string | null;
    }> | null = wantsApprovals
      ? readTokenApprovals(connection, new PublicKey(parsed.data.owner))
          .then((approvals) => ({ list: approvals, error: null }))
          .catch((error) => ({
            list: null,
            error:
              error instanceof Error
                ? error.message
                : "Could not read token approvals.",
          }))
      : null;

    const wrappedSolRead = wantsExtras
      ? listWrappedSolAccounts(parsed.data.owner)
          .then((accounts) => ({ accounts, error: null as string | null }))
          .catch((error) => ({
            accounts: [] as WrappedSolAccount[],
            error:
              error instanceof Error
                ? error.message
                : "Could not read wrapped SOL accounts.",
          }))
      : null;

    const snsRead = wantsExtras
      ? readSnsDomains(parsed.data.owner)
          .then((result) => ({ ...result, error: null as string | null }))
          .catch((error) => ({
            domains: [] as SalvageDomain[],
            truncated: false,
            error:
              error instanceof Error
                ? error.message
                : "Could not read SNS names.",
          }))
      : null;
    try {
      const holdingByMint = new Map(
        holdings.map((holding) => [holding.mint, holding]),
      );
      const authorityBatches: string[][] = [];
      for (let i = 0; i < holdings.length; i += 100) {
        authorityBatches.push(
          holdings.slice(i, i + 100).map((holding) => holding.mint),
        );
      }

      // 100 mints per call, four calls in flight. Sequentially this was ~31
      // round-trips on a 3,000-holding wallet — most of what made the scan slow.
      const authorityReads = await runWithConcurrency(
        authorityBatches,
        async (batch) => {
          const infos = await connection.getMultipleAccountsInfo(
            batch.map((mint) => new PublicKey(mint)),
          );
          const flagged: string[] = [];

          infos.forEach((info, index) => {
            // bigint-buffer (via spl-token's u64 layout) has no patched release
            // and overflows on short input (CVE-2025-3194), so never decode a
            // truncated account.
            if (!info || info.data.length < MintLayout.span) return;
            try {
              // The same 82 bytes for both token programs, so one decode covers
              // SPL and Token-2022 alike.
              const decoded = MintLayout.decode(info.data);
              const mint = batch[index];
              if (!mint) return;

              // A price is direct evidence of a market, and a market is what
              // makes a token sellable — a program-controlled mint *with* a price
              // is a normal token whose authority happens to be a PDA, not a
              // claim. That distinction is not academic: Pudgy Penguins is
              // exactly this shape, and treating the shape alone as a verdict hid
              // it from the sweeper. See `isPoolPosition`.
              const price =
                prices[mint]?.usdPrice ??
                holdingByMint.get(mint)?.dasPriceUsd ??
                null;
              const hasMarket = price != null && price > 0;

              if (
                isPoolPosition(
                  decoded.mintAuthority?.toBase58() ?? null,
                  hasMarket,
                )
              ) {
                flagged.push(mint);
              }
            } catch {
              // An undecodable mint is not a position we can name.
            }
          });

          return flagged;
        },
        { concurrency: 4 },
      );

      for (const read of authorityReads) {
        if (read.error !== undefined) {
          // One failed batch no longer takes the rest with it: whatever was read
          // still counts, and the first error is the one reported.
          poolLikeError ??= read.error;
          continue;
        }
        for (const mint of read.result ?? []) poolLike.add(mint);
      }
    } catch (error) {
      poolLikeError =
        error instanceof Error ? error.message : "Could not read mint authorities.";
    }

    const tokens: DustToken[] = holdings.map((holding) => {
      const raw = parseBaseAmount(holding.rawAmount) ?? 0n;
      const price = prices[holding.mint]?.usdPrice ?? holding.dasPriceUsd;
      const priceChange24h = prices[holding.mint]?.priceChange24h ?? null;
      const balance = baseAmountToNumber(raw, holding.decimals) ?? 0;
      const hasNoPrice = price == null;
      const valueUsd = hasNoPrice ? 0 : balance * (price as number);

      const info = metadata.get(holding.mint);
      const symbol = info?.symbol
        ? sanitizeSymbol(info.symbol)
        : holding.symbol;
      const name = info?.name
        ? sanitizeText(info.name, 48, symbol)
        : holding.name;
      const logoUri = info?.logoUri
        ? sanitizeLogoUri(info.logoUri)
        : holding.logoUri;

      return {
        mint: holding.mint,
        name,
        symbol,
        logoUri,
        rawAmount: raw.toString(),
        balance,
        decimals: holding.decimals,
        priceUsd: hasNoPrice ? null : (price as number),
        priceChange24h,
        valueUsd,
        program: holding.program,
        // The address that actually holds this balance. The sweep closes this
        // rather than re-deriving an ATA, which is what made a non-canonical
        // holding fail on-chain with `InvalidAccountData`.
        tokenAccount: holding.tokenAccount ?? null,
        hasNoPrice,
        hasTransferHook: holding.hasTransferHook,
        // Lets the client skip rent reclaim: a fee-charging mint keeps a
        // residue in the source ATA, so closeAccount would fail.
        hasTransferFee: holding.hasTransferFee,
        // Surfaced so nothing counts a frozen balance as recoverable. Frozen
        // accounts cannot be transferred, burned or closed.
        frozen: holding.frozen,
        // A program-controlled mint: a pool share or a program-issued receipt.
        // Listed, never counted and never burned — see `lib/sweep/pool-positions.ts`.
        poolLike: poolLike.has(holding.mint),
        // A staking token we can name, which outranks the `poolLike` guess above:
        // mSOL and JitoSOL are program-controlled mints too, so without this they
        // would be listed as anonymous pool shares instead of as what they are.
        // Named, never swept — see `lib/staking/staked-tokens.ts`.
        staked: stakedTokenFor(holding.mint),
      };
    });

    // Largest dust first. Users care about the biggest wins, and this keeps the
    // highest-value tokens inside the first transaction's byte budget.
    tokens.sort((a, b) => b.valueUsd - a.valueUsd);

    // ── Collectible-shaped assets leave the token list ────────────────────────
    // A 0-decimal asset with no market is a collectible the index could not tell
    // from a fungible — the rule and the reasoning are in
    // `lib/token-source/collectible-shape.ts`. It is not dust: no route can swap
    // it, so the swap list could only ever offer a token the sweeper would fail
    // on, and the Void pre-selects unpriced tokens for burning. It is presented
    // with the collectibles instead, where nothing is ticked on the user's behalf
    // and the burn is a deliberate act.
    const dustTokens: DustToken[] = [];
    const collectibleTokens: DustToken[] = [];
    for (const token of tokens) {
      (looksLikeCollectible(token) ? collectibleTokens : dustTokens).push(token);
    }

    /**
     * Live rent-exemption figures, fetched once per scan.
     *
     * The scan is where rent-reclaim numbers are first shown, and those numbers
     * must not come from a constant — a stale one is how this app once
     * overstated every figure it quoted. `fetchRentMinimums` never throws: it
     * degrades to the constants rather than failing a scan over a rent query.
     */
    const [rent, nativeStake] = await Promise.all([
      fetchRentMinimums(connection),
      // Native stake accounts: not tokens, so their own read. It never throws —
      // a failure comes back as an error string beside an empty list, so a
      // failed read cannot be mistaken for "this wallet has no stake".
      readNativeStakeAccounts(parsed.data.owner),
    ]);

    // Always price the selectable output assets, even when the wallet holds
    // none of them. The UI needs these to show a live "you will receive"
    // estimate, and SOL is never a token account anyway.
    const outputMints = Object.values(OUTPUT_ASSETS).map((asset) => asset.mint);
    const outputPriceMap: Record<string, number> = {};
    try {
      const outputPrices = await fetchPrices(outputMints);
      for (const [mint, entry] of Object.entries(outputPrices)) {
        outputPriceMap[mint] = entry.usdPrice;
      }
    } catch {
      // Never fail the whole scan over a supplementary price lookup. The UI
      // hides the estimate when a price is missing; the token list still works.
    }

    /**
     * The SOL price, for anything the scan quotes in dollars.
     *
     * It has to come from the *output* prices, not from the token prices: SOL is
     * never a token account, so `prices` has no entry for it and reading it there
     * returned null on every scan — which silently blanked the wallet's native
     * value. The output lookup always includes SOL, and it is the same figure the
     * UI converts at, so the two cannot disagree.
     */
    const solPrice =
      outputPriceMap[OUTPUT_ASSETS.SOL.mint] ??
      prices[OUTPUT_ASSETS.SOL.mint]?.usdPrice ??
      null;

    const [approvals, wrappedSol, sns] = await Promise.all([
      approvalsRead ?? Promise.resolve(null),
      wrappedSolRead ?? Promise.resolve(null),
      snsRead ?? Promise.resolve(null),
    ]);

    const payload: WalletScan = {
      owner: parsed.data.owner,
      tokens: dustTokens,
      // The scanner's own NFTs and cNFTs, plus the collectible-shaped assets the
      // index typed as fungible. Both are presented — and burned — the same way;
      // the only difference is which of them arrived needing to be told apart from
      // a token.
      nonFungibles: [
        ...nonFungibles,
        ...collectibleTokens.map(toCollectibleAsset),
      ],
      native: {
        lamports: nativeLamports,
        sol: nativeLamports / 1e9,
        valueUsd: solPrice == null ? null : (nativeLamports / 1e9) * solPrice,
      },
      outputPrices: outputPriceMap,
      // Empty accounts are not dust and are never merged into `tokens`: there is
      // nothing to sell or burn. They are carried so the rent locked inside them
      // can be reclaimed — the one thing a sweep cannot do for a balance that is
      // already gone.
      emptyAccounts,
      emptyAccountsError,
      // Native stake positions, kept out of `tokens` for the same reason NFTs
      // are: they are not dust, and nothing may sweep a stake account.
      stakedAccounts: nativeStake.accounts,
      stakedAccountsError: nativeStake.error,
      // Live rent-exempt minimum for one token account, so the client never has
      // to price rent from a constant. See `lib/solana/rent.ts`.
      tokenAccountRentLamports: rent.tokenAccount,
      // Null means we did read the mints and found no positions. Set means the
      // read failed, which is a different answer and is shown as one.
      poolLikeError,
      pages,
      durationMs: Date.now() - startedAt,
      truncated,
      source,
      ...(approvals === null
        ? {}
        : {
            approvalsCount: approvals.list?.length ?? null,
            approvalsError: approvals.error,
            approvals: approvals.list,
          }),
      ...(wrappedSol === null
        ? {}
        : {
            wrappedSol: wrappedSol.accounts,
            wrappedSolError: wrappedSol.error,
          }),
      ...(sns === null
        ? {}
        : {
            snsDomains: sns.domains,
            snsError: sns.error,
            snsTruncated: sns.truncated,
          }),
    };

    // Short shared-cache window: repeated rescans of the same wallet are common
    // right after a sweep, and a few seconds of staleness is harmless.
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
    });
  } catch (error) {
    if (error instanceof MissingEnvError) {
      return NextResponse.json(
        { error: error.message, provider: "helius" },
        { status: 424 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to scan this wallet.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}