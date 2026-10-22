import { OUTPUT_ASSETS } from "@/lib/utils/constants";
import { planEmptyAccountCloses } from "@/lib/sweep/empty-accounts";
import { isSweepableToken } from "@/lib/sweep/sweepable";
import type { WalletScan } from "@/types/token";

/**
 * "What could I actually get back from this wallet?"
 *
 * This is the arithmetic behind the read-only scan, which answers that question
 * for an address nobody has connected a wallet to. Two rules follow from the
 * fact that the answer is a *promise about a future transaction*:
 *
 *  - **Rent is only counted for accounts we can genuinely close.** A frozen
 *    account, a mint with a transfer hook, and a transfer-fee mint that keeps a
 *    residue in its ATA all fail on chain. Counting them would repeat the exact
 *    mistake that made this project's earlier rent figures wrong — a number that
 *    looks authoritative, is quoted to the user, and does not survive contact
 *    with the chain.
 *  - **A token with no price contributes its rent and nothing else.** Not a
 *    rounding choice: an unpriced token has no USD value, and The Void can still
 *    burn it for the rent, which is precisely the recoverable part.
 *
 * Everything here is derived from a scan the user can reproduce with a wallet
 * connected, so the number is checkable rather than statistical.
 */

/** Holdings the scan saw that we cannot act on, and why. Each is a real count. */
export interface RecoverableLimitations {
  /**
   * Staking tokens we can name — mSOL, JitoSOL and the rest.
   *
   * Same consequence as `poolLike` (a sweep will not sell one), but a better
   * answer: these are not anonymous program-controlled mints, they are positions
   * whose protocol we know. They are separated from `poolLike` so the screen can
   * say "staked with Marinade" instead of "in a liquidity pool", which is the
   * truth about a different thing.
   *
   * Counted *instead of* `poolLike`, never as well as it: nearly every staking
   * token is also a program-controlled mint, so adding both would double-count
   * one holding. This is the stronger of the two readings and leads.
   */
  staked: number;
  /**
   * Program-controlled mints — a pool share or a program-issued receipt.
   *
   * Not a dust token at all, whatever the balance: there is no market to sell it
   * in, and a token account holding a balance cannot be closed, so its value and
   * its rent are both out of reach. Counting either would be the same mistake as
   * counting a frozen account, one step further from obvious.
   *
   * A recognised staking token is program-controlled too, but is reported under
   * `staked` above rather than here.
   */
  poolLike: number;
  /**
   * Frozen accounts. The mint's freeze authority has locked them: they cannot be
   * transferred, burned or closed, so both the value and the rent are out of
   * reach until that authority releases them.
   */
  frozen: number;
  /**
   * Transfer-hook mints. Spacedust refuses these outright rather than sign an
   * instruction whose effects we cannot see, so they are neither sold nor burned.
   */
  transferHook: number;
  /**
   * Transfer-fee mints. These *can* be swept, but the ATA keeps a residue, so it
   * cannot be closed. The value counts; the rent does not.
   */
  transferFee: number;
  /**
   * Balances whose token account the scanner could not identify. Without the
   * account address we cannot close anything, and we must never guess a derived
   * ATA in its place.
   */
  unknownAccount: number;
  /**
   * Already-empty accounts another key is set as close authority on.
   *
   * Verified on mainnet: once a close authority is set, the owner's signature is
   * no longer accepted — the program answers "owner does not match". Those
   * accounts are listed but their rent cannot be promised.
   */
  emptyAuthority: number;
  /**
   * Already-empty Token-2022 accounts holding withheld transfer fees.
   *
   * Verified on mainnet: `Custom: 35` — the close is refused until the mint
   * harvests them, and harvesting needs the mint's authority, not the holder's.
   */
  emptyWithheldFees: number;
}

export interface RecoverableBreakdown {
  /** Token accounts a sweep could close, once their balance is emptied. */
  closableAccounts: number;
  /** Already-empty accounts whose rent is still recoverable by closing them. */
  emptyAccounts: number;
  /**
   * Rent sitting in accounts that are **already empty**, summed from each
   * account's own lamports.
   *
   * Funded accounts are deliberately not counted. Their rent is real, but it is
   * not available now: the account has to be emptied first — sold, or burned in
   * The Void — and only then can it be closed. A scan is a promise about what is
   * reachable *today*, and quoting rent that a funded account cannot release
   * until some other flow has run is precisely the kind of number this file
   * exists to avoid. `closableAccounts` still reports how many would free their
   * rent if emptied, so the two facts stay separate.
   *
   * Each empty account is priced at its own balance, read from the account, not
   * from a constant: a Token-2022 account with extensions holds 2,074,080 where
   * a legacy one holds 2,039,280.
   */
  rentLamports: number;
  /** The part of `rentLamports` that sits in accounts which are already empty. */
  emptyRentLamports: number;
  /** `rentLamports` in USD, or null when there is no SOL price to convert at. */
  rentUsd: number | null;
  /** USD value a sweep could actually sell — frozen and hook-held value excluded. */
  sweepableValueUsd: number;
  /** USD value of every token in the scan, including the ones we refuse. */
  heldValueUsd: number;
  /**
   * Everything the wallet holds in USD: every token, native SOL, and any
   * wrapped-SOL accounts the full scan read.
   *
   * The question this page is usually opened to answer is "what is in here?",
   * not "what can I get out?" — and those are different numbers. Null when the
   * wallet's native value could not be priced.
   */
  walletValueUsd: number | null;
  /** Lamports in non-empty wSOL accounts, including their rent deposits. */
  wrappedSolLamports: number;
  /** The wSOL portion of `walletValueUsd`, or null when SOL could not be priced. */
  wrappedSolUsd: number | null;
  /** `sweepableValueUsd` + `rentUsd`. Null when there is no SOL price. */
  totalUsd: number | null;
  /** The SOL price used for conversion, so the UI can state its basis. */
  solPriceUsd: number | null;
  limitations: RecoverableLimitations;
  /** Native balance, passed through untouched: it is never part of the total. */
  nativeLamports: number;
}

/**
 * Total what a sweep would bring back.
 *
 * `rentPerAccountLamports` is a parameter rather than a constant because rent is
 * set by the network and has changed before — see `lib/solana/rent.ts`. Callers
 * with a live figure must pass it; the default exists only so a render path with
 * no plan yet can still show something.
 */
export function summariseRecoverable(
  scan: Pick<
    WalletScan,
    "tokens" | "native" | "outputPrices" | "owner" | "emptyAccounts" | "wrappedSol"
  >,
): RecoverableBreakdown {
  const limitations: RecoverableLimitations = {
    staked: 0,
    poolLike: 0,
    frozen: 0,
    transferHook: 0,
    transferFee: 0,
    unknownAccount: 0,
    emptyAuthority: 0,
    emptyWithheldFees: 0,
  };

  let closableAccounts = 0;
  let sweepableValueUsd = 0;
  let heldValueUsd = 0;

  for (const token of scan.tokens) {
    heldValueUsd += token.valueUsd;

    // The same answer the sweeper's own list uses — see `lib/sweep/sweepable.ts`.
    // Sharing it is the whole point: a total that excluded something the sweep
    // would then happily sell was a promise that did not survive being checked.
    if (isSweepableToken(token)) sweepableValueUsd += token.valueUsd;

    // Ranked, not merged: a staking token is very often a program-controlled
    // mint as well, and reporting it as both would count one holding twice.
    // `staked` is the named answer, so it wins.
    if (token.staked) limitations.staked += 1;
    else if (token.poolLike) limitations.poolLike += 1;
    else if (token.frozen) limitations.frozen += 1;
    else if (token.hasTransferHook) limitations.transferHook += 1;
    else if (token.hasTransferFee) limitations.transferFee += 1;
    else if (!token.tokenAccount) limitations.unknownAccount += 1;
    else closableAccounts += 1;
  }

  /**
   * Already-empty accounts, through the same rule the closer uses.
   *
   * Sharing `planEmptyAccountCloses` is the point: a read-only scan that
   * promised rent the connected flow would then refuse is exactly the failure
   * this file exists to prevent. One rule, one answer, both screens.
   */
  const emptyPlan = planEmptyAccountCloses(scan.emptyAccounts, scan.owner);

  for (const { reason } of emptyPlan.skipped) {
    if (reason === "foreign-close-authority") limitations.emptyAuthority += 1;
    else if (reason === "withheld-fees") limitations.emptyWithheldFees += 1;
    // "nothing to reclaim" and "invalid address" are not limitations: the first
    // is an account holding no lamports, the second a defensive case that cannot
    // arise from a parsed response. The planner still reports both by reason.
  }

  const emptyRentLamports = emptyPlan.lamports;
  // Only what is reachable today: an empty account's own deposit. A funded
  // account has rent too, but nothing can collect it until the balance is sold
  // or burned, and this page is a promise about what can be done now.
  const rentLamports = emptyRentLamports;

  const solPriceUsd = validPrice(scan.outputPrices[OUTPUT_ASSETS.SOL.mint]);
  const rentUsd = solPriceUsd == null ? null : (rentLamports / 1e9) * solPriceUsd;
  const totalUsd = rentUsd == null ? null : sweepableValueUsd + rentUsd;

  // Native value comes from the scan, which priced it with the same SOL price —
  // so the two halves of this total cannot disagree about what SOL is worth.
  const nativeUsd = scan.native.valueUsd;
  // wSOL is native SOL in a token account. It is part of the wallet's value, but
  // never part of the recoverable total: unwrapping returns the same principal,
  // it does not create value. The rent inside those accounts is a different
  // question, and the Salvage planner handles it separately.
  const wrappedSolLamports = (scan.wrappedSol ?? []).reduce(
    (sum, account) => sum + account.lamports,
    0,
  );
  const wrappedSolUsd =
    scan.wrappedSol === undefined
      ? 0
      : solPriceUsd == null
        ? null
        : (wrappedSolLamports / 1e9) * solPriceUsd;
  const walletValueUsd =
    nativeUsd == null || wrappedSolUsd == null
      ? null
      : heldValueUsd + nativeUsd + wrappedSolUsd;

  return {
    closableAccounts,
    emptyAccounts: emptyPlan.closeable.length,
    rentLamports,
    emptyRentLamports,
    rentUsd,
    sweepableValueUsd,
    heldValueUsd,
    walletValueUsd,
    wrappedSolLamports,
    wrappedSolUsd,
    totalUsd,
    solPriceUsd,
    limitations,
    nativeLamports: scan.native.lamports,
  };
}

/** A price we are willing to multiply by. Anything else means "no price". */
function validPrice(price: number | undefined): number | null {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  return price;
}

/** Every limitation across the scan, for a one-line "and N we cannot touch". */
export function totalLimitations(limitations: RecoverableLimitations): number {
  return (
    limitations.staked +
    limitations.poolLike +
    limitations.frozen +
    limitations.transferHook +
    limitations.transferFee +
    limitations.unknownAccount +
    // The two empty-account refusals count here as well. They are rent the
    // screen must not promise, which is exactly what this total is for: leaving
    // them out would hide a refusal behind a smaller number rather than a
    // missing one.
    limitations.emptyAuthority +
    limitations.emptyWithheldFees
  );
}
