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
 * The rent-exempt floor for an empty system account: the minimum a wallet may
 * hold without its balance becoming illegal.
 *
 * Solana will not let an account end a transaction holding a non-zero balance
 * below this figure — it must be either exactly zero (the account is gone) or at
 * least this much. So a wallet with 87,348 lamports cannot pay a 7,000-lamport
 * fee: it would be left at 80,348, which the cluster refuses as
 * `InsufficientFundsForRent` even though the fee itself is affordable.
 *
 * Measured against mainnet on 2026-10-25 rather than remembered: 650,240
 * lamports for a zero-byte account. (The first draft of this constant said
 * 890,880 from memory and was wrong by 240,640 — the kind of error that would
 * have told a wallet with 700,000 lamports it was fine when it was not.)
 */
export const SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS = 650_240;

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
 * Solana's per-transaction account-lock ceiling. A transaction can reference at
 * most 64 distinct accounts (including the payer, program IDs and every proof
 * account), even when an address lookup table makes the message smaller. The
 * runtime rejects a transaction over this with "transaction locked too many
 * accounts", so the packer has to treat it as a second budget alongside bytes.
 */
export const MAX_LOCKED_ACCOUNTS_PER_TX = 64;

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

/**
 * Compute budget for one SNS name burn.
 *
 * The legacy registry delete measured 1,801 CU on mainnet. The current registrar
 * burn wraps that delete with reverse and resale-state cleanup, so 30,000 CU per
 * name is a deliberately conservative allowance rather than the old measured
 * figure. It costs a few lamports of priority fee and avoids a batch failing on
 * the one instruction that does more than the measurement covered.
 */
export const DELETE_COMPUTE_UNITS_PER_UNIT = 30_000;

/** Floor for a delete transaction's compute budget. */
export const DELETE_COMPUTE_UNIT_FLOOR = 50_000;

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
 * Lamports a native-SOL send must leave in the wallet.
 *
 * A batch pays its network fees from the same wallet, and a transaction with no
 * lamports left cannot pay one. This is the floor the UI treats as "max" — a
 * reserve, not a fee: Spacedust keeps none of it. 0.001 SOL covers a base fee and
 * the priority fee for a whole batch with room to spare.
 */
export const SOL_SEND_FEE_RESERVE_LAMPORTS = 1_000_000;

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

/**
 * Extra compute for sending one compressed NFT.
 *
 * A Bubblegum transfer is not a token transfer: before it rewrites anything it
 * verifies the leaf's merkle proof and walks the tree's root, which measured in
 * the tens of thousands of CU rather than the low thousands a token transfer
 * uses. Added on top of `SEND_COMPUTE_UNITS_PER_UNIT` per cNFT rather than
 * replacing it, because the unit still packs, pays and checks like any other —
 * and the priority fee is billed on the budget *requested*, so under-asking is a
 * failed transaction while over-asking is a fraction of a lamport.
 */
export const CNFT_TRANSFER_COMPUTE_UNITS = 60_000;

/** Solana's own ceiling on one transaction's compute budget. */
export const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;

/** The runtime's hard ceiling on loaded account data, used to clamp at encode. */
export const MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES = 67_108_864;

/**
 * Explicit ceiling on the account data a transaction may load, in bytes (64 MiB).
 *
 * This is the runtime's own maximum, declared explicitly rather than left
 * implicit. A transaction can set it with a Compute Budget instruction; Phantom's
 * guidance for avoiding simulation warnings is to state both budgets, so we do.
 *
 * WHY THE PREVIOUS 1 MiB WAS WRONG: the loaded-account-data figure includes the
 * **executable program accounts**, not just the token accounts and pool state a
 * route touches. Measured on mainnet from the upgradeable loader's ProgramData
 * accounts:
 *
 *   Jupiter              2,892,269 B
 *   Account Compression  2,349,085 B
 *   Token-2022           1,382,061 B
 *   Bubblegum            1,349,853 B
 *   Core                   848,365 B
 *   Token Metadata         794,036 B
 *   SPL Token              108,645 B
 *   Associated Token       105,032 B
 *
 * A single Jupiter swap therefore loads ~2.9 MB before it reads an account, and
 * a packed Void transaction can load several Metaplex routes at once — ~9.8 MB
 * from the programs above alone. Both flows failed simulation with
 * `MaxLoadedAccountsDataSizeExceeded` under the 1 MiB declaration.
 *
 * WHY THE CEILING, NOT A TIGHTER MEASURED NUMBER: a Jupiter route also CPI-calls
 * whichever AMM programs it picked at quote time, and those binaries count too.
 * They are not knowable here, so any static cap is a guess about a program this
 * app does not choose. A guess below the real load is exactly the failure this
 * replaces. Declaring the ceiling costs nothing — it is a cap, not a purchase;
 * the fee is charged on compute units, not on this limit.
 */
export const LOADED_ACCOUNTS_DATA_SIZE_LIMIT =
  MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES;


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

/**
 * How long a tap confirmation stays on screen.
 *
 * "Preview ready" and "Wallet rescanned" confirm something the user just asked
 * for; they are not paragraphs to study and should not sit over the preview
 * they are about to review. Sonner's four-second default felt like a lingering
 * popup, so these fade after two and a half seconds.
 */
export const TOAST_BRIEF_MS = 2_500;

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
   * Lookup tables created for a cNFT burn whose rent has not been reclaimed.
   *
   * A table outlives the burn and can only be closed after a 512-slot wait, so
   * the addresses have to survive a refresh. Losing them would strand exactly
   * the rent the reclaim flow exists to return.
   */
  lookupTableCleanup: "spacedust:v1:lookupTableCleanup",
  /**
   * Whether to start the lookup-table cleanup automatically after a burn that
   * created one. Off by default: the cleanup needs two wallet approvals, so it
   * is a choice rather than something that happens behind the user's back.
   */
  lookupTableAutoReclaim: "spacedust:v1:lookupTableAutoReclaim",
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
  /** Whether the essential-storage notice has been dismissed. */
  cookieNotice: "spacedust:v1:cookieNotice",
  /**
   * Interface depth: Basic hides the more involved flows and controls; Pro
   * shows everything. Defaults to Basic so a first visit stays simple.
   */
  siteMode: "spacedust:v1:siteMode",
} as const;

export const HISTORY_MAX_ENTRIES = 25;