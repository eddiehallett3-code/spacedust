/**
 * App-wide constants.
 *
 * Anything a user could tweak lives in `types/sweep.ts` or in the UI. This file
 * holds values that are either on-chain identities or safety limits.
 */

/** Wrapped SOL. Jupiter uses this as the mint for native SOL swaps. */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** Circle USDC (mainnet). */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Jupiter (JUP) — a legacy SPL token with 6 decimals. */
export const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

/** Output choices offered in the UI. */
export const OUTPUT_ASSETS = {
  SOL: { mint: WSOL_MINT, symbol: "SOL", label: "SOL", decimals: 9 },
  USDC: { mint: USDC_MINT, symbol: "USDC", label: "USDC", decimals: 6 },
  JUP: { mint: JUP_MINT, symbol: "JUP", label: "JUP", decimals: 6 },
} as const;

/** Token programs. */
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export const ASSOCIATED_TOKEN_PROGRAM_ID =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** Size of an SPL token account, in bytes. Fixed by the token program. */
export const TOKEN_ACCOUNT_SIZE_BYTES = 165;

/**
 * FALLBACK rent-exempt minimum for a token account (1,488,440 lamports).
 *
 * This is a fallback only. `getMinimumBalanceForRentExemption` is the source of
 * truth, and both flows fetch it at plan time (`lib/solana/rent.ts`), so the
 * figure cannot drift again. Reach for this only where a number is needed
 * *before* a plan exists.
 *
 * Why the distinction is load-bearing: this used to be 2,039,280 — correct for
 * years, then silently ~37% too high once the network cut its rent rate from
 * 3,480 to 2,540 lamports per byte-year. Two things broke at once. Every rent
 * label overstated what the user got back, and The Void's fee is *derived* from
 * this number, so the app advertised "1.5% of reclaimed rent" while charging
 * 2.06% of it. A stale constant here moves real money.
 */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 1_488_440;

/**
 * FALLBACK rent-exempt minimum for an account with **no data** (650,240
 * lamports). Fetched at plan time for the same reason as above.
 *
 * Solana will not bring an account into existence below this, so a small SOL
 * transfer to an address that does not exist yet is rejected with
 * `InsufficientFundsForRent` instead of creating it. That matters for The
 * Void's fee, which is ~0.00003 SOL: it can only be sent to a fee wallet that
 * is already funded, and is skipped otherwise.
 */
export const EMPTY_ACCOUNT_RENT_LAMPORTS = 650_240;

/**
 * Rent-exempt minimum for a one-byte account — the size a burned Core asset is
 * left at.
 *
 * MPL Core's burn does not close the asset account: it empties the data and
 * shrinks the account to a single zero byte, and that byte keeps its rent. So
 * this much of a Core asset's rent never comes back, and a "rent reclaimed"
 * figure that ignores it overstates every Core burn by ~0.00065 SOL — measured
 * on mainnet at exactly 655,320 lamports.
 */
export const HUSK_ACCOUNT_RENT_LAMPORTS = 655_320;

/** System program. */
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

/** Compute budget program. */
export const COMPUTE_BUDGET_PROGRAM_ID =
  "ComputeBudget111111111111111111111111111111";

// ── Safety limits ────────────────────────────────────────────────────────────

/** Absolute ceiling on a serialized Solana transaction. 1232 is the hard cap. */
export const MAX_TX_SIZE_BYTES = 1232;

/**
 * We stop packing before the true limit so that the wallet's own signing and
 * any network overhead cannot push us over. Leave headroom.
 */
export const TX_SIZE_HEADROOM_BYTES = 40;

/**
 * Upper bound on instructions per transaction. A soft guard so a pathological
 * batch of tiny swaps cannot produce a transaction that is technically under
 * 1232 bytes but fails on compute limits.
 */
export const MAX_INSTRUCTIONS_PER_TX = 24;

/** Max dust tokens we will sweep in one flow. Beyond this, users are scammed. */
export const MAX_TOKENS_PER_SWEEP = 40;

// ── Threshold ───────────────────────────────────────────────────────────────

export const THRESHOLD_MIN_USD = 0.1;
export const THRESHOLD_MAX_USD = 50;
export const THRESHOLD_DEFAULT_USD = 5;
/** Slider granularity. */
export const THRESHOLD_STEP_USD = 0.1;

// ── Slippage & fees ─────────────────────────────────────────────────────────

/** Default slippage tolerance in basis points (0.5%). */
export const DEFAULT_SLIPPAGE_BPS = 50;
export const SLIPPAGE_MIN_BPS = 10;
export const SLIPPAGE_MAX_BPS = 500;

/**
 * Compute units requested for a packed transaction. Deliberately below the
 * 1.4M per-instruction cap: our swaps are small and the CU budget is priced per
 * unit, so over-requesting wastes the user's SOL on a dust sweep.
 */
export const COMPUTE_UNIT_LIMIT = 800_000;

/**
 * Compute units requested for a revoke transaction.
 *
 * Revoking a delegate costs a few thousand CU; a swap can cost hundreds of
 * thousands. The wallet pays its priority fee on the budget that is *requested*,
 * not the compute actually used, so asking for the sweep's 800,000 here would
 * charge roughly 1,500 lamports per transaction for headroom nobody needs — on
 * an action that recovers nothing at all. 200,000 still covers a full
 * 24-revoke transaction several times over.
 */
export const REVOKE_COMPUTE_UNIT_LIMIT = 200_000;

/**
 * Compute units requested for a rent-reclaim transaction.
 *
 * Closing already-empty token accounts, measured on mainnet: a legacy close
 * costs 120 CU, and a Token-2022 close 1,400–1,900 depending on extensions. The
 * packer never puts more than `MAX_INSTRUCTIONS_PER_TX` instructions in one
 * transaction, so the worst packet it can build is about 24 × 1,900 ≈ 46,000 CU
 * — an invariant asserted in `close-accounts.test.ts` rather than assumed here.
 *
 * 200,000 is therefore several times the ceiling. The headroom costs almost
 * nothing in priority fee, and unlike a revoke this transaction *returns* money:
 * reclaiming ~0.1 SOL of rent for a few hundred lamports of fee.
 */
export const CLOSE_COMPUTE_UNIT_LIMIT = 200_000;

/** The worst-case cost of one `closeAccount`, for sizing the budget above. */
export const CLOSE_COMPUTE_UNITS_PER_ACCOUNT = 2_000;

/** Base fee per signature, in lamports. The priority fee is billed per CU. */
export const BASE_FEE_LAMPORTS = 5000;

/**
 * Micro-lamports per compute unit.
 *
 * Deliberately low: a dust sweep is latency-insensitive, and priority fees are
 * charged whether or not the transaction wins. Overpaying here would eat a
 * meaningful share of the dust being recovered.
 *
 * Also deliberately fixed rather than asked for. This replaced a
 * `PRIORITY_FEE_PERCENTILE` constant that was meant to have Jupiter price the
 * fee but was never read by anything — we build our own compute-budget
 * instructions and discard Jupiter's, so a percentile would have had no effect.
 * Keeping the value explicit makes the entire cost of a sweep predictable.
 */
export const PRIORITY_FEE_MICRO_LAMPORTS = 2_500;

// ── Integrator fees ─────────────────────────────────────────────────────────

/**
 * Fee taken on each swap, in basis points (1 bps = 0.01%).
 *
 * Charged on the swap's **output** through Jupiter's platform-fee mechanism, so
 * it comes out of the asset the user is sweeping into and never touches the
 * dust being recovered. Jupiter keeps the fee transfer inside the swap
 * instruction, which means it cannot be skipped, duplicated, or redirected by
 * the client.
 *
 * Where it lands: the **fee wallet's own token account** for that output asset —
 * `ATA(NEXT_PUBLIC_FEE_WALLET, mint)`, derived rather than configured
 * (`lib/solana/fee-account.ts`). The whole 0.5% arrives there and stays there:
 * there is no claim step, and nobody takes a cut between the swap and the
 * balance.
 *
 * Deliberately *not* routed through Jupiter's Referral Program, which is the
 * other way to point this same platform fee somewhere. A referral token account
 * is charged identically, but a claim then pays out that account's on-chain
 * `share_bps` to the partner and the remainder to the project — ours reads 8000,
 * so 0.4% would be kept and **0.1% handed to Jupiter**. Aiming the fee at our
 * own wallet keeps all of it. `probes/tmp-direct-fee-probe.mjs` measures both halves of
 * that claim; the README's fee section carries the numbers.
 */
export const SWAP_FEE_BPS = 50; // 0.5%

/**
 * Fee taken by The Void, in basis points of the rent reclaimed.
 *
 * A burn destroys the token, so the *only* value in a Void send is the rent
 * locked in each token account. The fee is therefore taken from that rent, as a
 * plain SOL transfer once the account is closed.
 *
 * The rate is applied to the rent the *network* reports, not to a constant —
 * see `voidFeeFromRentLamports` in `lib/solana/rent.ts`.
 */
export const VOID_FEE_BPS = 150; // 1.5%

/**
 * Fee taken when **empty accounts are closed and rent is reclaimed**.
 *
 * Deliberately its own rate rather than The Void's, even though both currently
 * charge 1.5% of reclaimed rent: they are different actions with different costs
 * behind them, and the whole point of separate constants is that they can be
 * repriced without dragging each other along.
 *
 * This price changed. Closing an already-empty account was originally free, on the
 * reasoning that the user is recovering their own deposit rather than trading —
 * and that promise was written into the panel, this file's neighbours and the
 * README. It is now charged, which is a pricing decision and therefore one that is
 * stated wherever the old promise was, rather than left to be discovered.
 */
export const RECLAIM_FEE_BPS = 150; // 1.5%

/**
 * FALLBACK fee per closed account, in lamports. Floored, never rounded up.
 *
 * Real burns are priced by `voidFeeFromRentLamports` against the rent actually
 * fetched at plan time. This exists only for render paths with no plan yet, and
 * is derived from the fallback rent so the two can never disagree.
 */
export const VOID_FEE_LAMPORTS = Number(
  (BigInt(TOKEN_ACCOUNT_RENT_LAMPORTS) * BigInt(VOID_FEE_BPS)) / 10_000n,
);

/**
 * Fee taken by Payload, in basis points of the rent its sends reclaim.
 *
 * A send moves the assets; the only value Payload *creates* is the rent freed
 * when a send empties the token account the asset came from. The fee is taken
 * from that rent alone — never from the assets being sent — so a send that frees
 * no rent costs nothing beyond network fees.
 *
 * Its own constant rather than sharing The Void's rate, so the two can be
 * repriced independently even though they start equal.
 */
export const PAYLOAD_FEE_BPS = 150; // 1.5%

/**
 * Measured compute for one send unit: create the recipient's account, transfer,
 * close the source.
 *
 * 15,243 CU was measured by simulating that exact unit against real mainnet
 * accounts (`probes/tmp-payload-transfer-probe.mjs`); this is that figure rounded up.
 * The budget is sized from the unit count rather than from a round number,
 * because the priority fee is billed on the budget you *request* — the lesson
 * that took a revoke from the sweep's 800,000 CU down to 200,000.
 */
export const SEND_COMPUTE_UNITS_PER_UNIT = 16_000;

/** Solana's own ceiling on one transaction's compute budget. */
export const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;

/**
 * Measured compute for one SNS domain delete.
 *
 * 1,801 CU was measured by simulating the real instruction against a real mainnet
 * name account — 207 bytes, `err: null`, refunding that account's own rent. That
 * figure is carried into the comment rather than the constant's name because the
 * budget below is sized from it: the priority fee is billed on the budget you
 * *request*, so a delete priced like a swap would overpay for headroom nobody uses.
 */
export const DELETE_COMPUTE_UNITS_PER_UNIT = 5_000;

/** Floor for a delete transaction's compute budget. */
export const DELETE_COMPUTE_UNIT_FLOOR = 50_000;

// ── Scanning ────────────────────────────────────────────────────────────────

/** DAS page size. */
export const DAS_PAGE_SIZE = 1000;
/** Hard cap on pages so one request can never run unbounded. */
export const DAS_MAX_PAGES = 10;
/** Jupiter Price API v3 accepts at most 50 ids per call. */
export const PRICE_BATCH_SIZE = 50;
/** Below this balance a token cannot be meaningfully swapped, so we hide it. */
export const MIN_SWEEPABLE_RAW = 1n;

// ── Smart filter ────────────────────────────────────────────────────────────

/** Hide tokens whose quote shows worse price impact than this (fraction). */
export const SMART_FILTER_MAX_PRICE_IMPACT = 0.3;

// ── Toasts ──────────────────────────────────────────────────────────────────

/**
 * How long a toast that has to be **read** stays on screen.
 *
 * Sonner's default is 4 seconds, which is roughly 60 characters at reading
 * speed: right for "Address copied", useless for a burn result, which is a
 * paragraph explaining where the rent went and why the asset may keep showing in
 * a wallet. A message the user has to absorb gets time to be absorbed — the
 * confirmations of things they just did keep the default.
 */
export const TOAST_READ_MS = 10_000;

/** localStorage keys. Versioned so a schema change can never break old data. */
export const STORAGE_KEYS = {
  threshold: "spacedust:v1:threshold",
  outputAsset: "spacedust:v1:outputAsset",
  smartFilter: "spacedust:v1:smartFilter",
  sweepHistory: "spacedust:v1:sweepHistory",
  /**
   * Assets this browser should stop showing.
   *
   * Two sources, and the difference matters. A **burn the app watched** is a
   * fact and is recorded the moment it lands, because the scan reads an index
   * and an index lags — a destroyed asset can return on the very next rescan.
   * (Helius's own `burnt` flag settles it later, on every device, and is the
   * only other signal that reaches a cNFT.) A **hide the user asked for** is a
   * preference: they may be looking at something genuinely gone, or simply want
   * a row off the screen — so it can be undone.
   */
  hiddenAssets: "spacedust:v1:hiddenAssets",
  /**
   * The site-wide tally under the app: how many sweeps this browser has run and
   * what they recovered.
   *
   * These lived in `lib/utils/tally.ts` as strings it built itself, which made
   * this object *not* the answer to "what does this app keep on device?" — and
   * the security page enumerates that answer to users, so a key living somewhere
   * else was a key the page did not mention. The values are the same strings the
   * tally module used to build by hand, so existing data still reads.
   */
  sweptWallets: "spacedust:v1:sweepHistory:sweptWallets",
  sweptUsd: "spacedust:v1:sweepHistory:sweptUsd",
} as const;

export const HISTORY_MAX_ENTRIES = 25;