import { formatSol, pluralize } from "@/lib/utils/format";

/**
 * The one case a user genuinely cannot act on: no SOL for the network fee.
 *
 * Every reclaim flow assumes the wallet can pay a few thousand lamports to move
 * its own rent. When it cannot, nothing can be signed — and the wallet's own
 * answer ("insufficient funds for fee") is a dead end, because it says nothing
 * about how much is missing or where it has to come from.
 *
 * Sol Incinerator solves this by advancing the fee and taking it back out of the
 * rent in the same run. Doing that here would require the server to hold a key
 * and sign as fee payer, which this project does not do: the only thing that
 * ever produces a signature is the user's wallet. So the shortfall is detected
 * *before* signing and stated exactly — how much, to which address, and that it
 * has to come from somewhere else — and the flow stops there.
 *
 * WHY THE FIRST TRANSACTION IS THE WHOLE TEST. Solana deducts the fee before it
 * executes any instruction, so rent released by a close in the same transaction
 * cannot pay for it, and rent released by transaction 1 can only pay for
 * transaction 2. The hard barrier is therefore the first transaction alone; the
 * rest of the batch is normally funded by the closes ahead of it.
 */

/** One 0.001 SOL step: an amount a person can type, or withdraw from an exchange. */
const SENDABLE_STEP_LAMPORTS = 1_000_000;

/**
 * Enough for a transaction or two beyond the shortfall, so a second attempt is
 * not blocked by a fee that moved by a thousand lamports.
 */
export const FEE_TOP_UP_HEADROOM_LAMPORTS = 100_000;

/** What a wallet is short of, and what to send it. */
export interface FeeShortfall {
  /** The fee payer, which for every flow here is the user's own wallet. */
  payer: string;
  /** What the wallet holds now, in lamports. */
  availableLamports: number;
  /** The network fee of the first transaction, in lamports. */
  firstFeeLamports: number;
  /**
   * Lamports the first transaction must also deposit for an account it opens —
   * the output token account a swap sends into.
   *
   * Not a fee: Solana returns it when that account closes, which a sweep does in
   * the same transaction. It is still lamports the wallet must have before the
   * transaction can run, so it belongs in the figure the user is asked to send.
   */
  rentLamports: number;
  /**
   * Lamports the wallet must keep simply to remain a legal account.
   *
   * Solana refuses to leave a non-zero balance below the rent-exempt floor, so a
   * wallet holding 87,348 lamports cannot pay a 7,000 fee — it would end at
   * 80,348, which is neither empty nor exempt. That is `InsufficientFundsForRent`
   * even though the fee is affordable, and it is a different cost from the
   * deposit above: nothing is opened, and nothing comes back.
   */
  reserveLamports: number;
  /** The fees of the whole batch, in lamports. */
  totalFeeLamports: number;
  /** How many transactions the batch would send. */
  transactionCount: number;
  /** `firstFeeLamports - availableLamports`; always greater than zero. */
  shortfallLamports: number;
  /** What to send: the shortfall plus headroom, rounded up to a sendable step. */
  suggestedLamports: number;
}

/** The copy a shortfall produces. Structurally a `FriendlyError`. */
export interface FeeShortfallCopy {
  title: string;
  message: string;
  hint: string;
}

export interface FeeShortfallInput {
  payer: string;
  availableLamports: number;
  firstFeeLamports: number;
  totalFeeLamports: number;
  transactionCount: number;
  /** Deposit for an account this transaction opens. Defaults to none. */
  rentLamports?: number;
  /** Lamports the wallet must keep to stay rent-exempt. Defaults to none. */
  reserveLamports?: number;
}

/**
 * Round the shortfall up to something a person can actually send.
 *
 * A requirement of 3,271 lamports is not an amount anyone can withdraw, and a
 * wallet funded to the exact lamport would be one fee change away from failing
 * again. So the figure quoted is the shortfall plus a little headroom, rounded
 * up to 0.001 SOL — and it is quoted as "at least", because it is a floor.
 */
export function suggestedTopUpLamports(shortfallLamports: number): number {
  const withHeadroom =
    Math.max(0, Math.trunc(shortfallLamports)) + FEE_TOP_UP_HEADROOM_LAMPORTS;
  return Math.max(
    SENDABLE_STEP_LAMPORTS,
    Math.ceil(withHeadroom / SENDABLE_STEP_LAMPORTS) * SENDABLE_STEP_LAMPORTS,
  );
}

/**
 * Can this wallet pay for the first transaction?
 *
 * Returns `null` when it can, or when there is nothing to compare — a planner
 * must never invent a shortfall out of a failed balance read.
 */
export function assessFeeShortfall(
  input: FeeShortfallInput,
): FeeShortfall | null {
  const availableLamports = Math.max(0, Math.trunc(input.availableLamports));
  const firstFeeLamports = Math.max(0, Math.trunc(input.firstFeeLamports));
  const rentLamports = Math.max(0, Math.trunc(input.rentLamports ?? 0));
  const reserveLamports = Math.max(0, Math.trunc(input.reserveLamports ?? 0));

  const requiredLamports = firstFeeLamports + rentLamports + reserveLamports;
  if (requiredLamports <= 0) return null;
  if (availableLamports >= requiredLamports) return null;

  const shortfallLamports = requiredLamports - availableLamports;
  return {
    payer: input.payer,
    availableLamports,
    firstFeeLamports,
    rentLamports,
    reserveLamports,
    totalFeeLamports: Math.max(
      firstFeeLamports,
      Math.trunc(input.totalFeeLamports),
    ),
    transactionCount: Math.max(1, Math.trunc(input.transactionCount)),
    shortfallLamports,
    suggestedLamports: suggestedTopUpLamports(shortfallLamports),
  };
}

/**
 * Say exactly what to do about it.
 *
 * The address is the user's own wallet, which is the point: nothing is being
 * asked of a third party, and no key but theirs exists. The last sentence is the
 * part that took the longest to get right — "why can't the rent pay for this?"
 * is the obvious question, and the answer is that the fee is taken first.
 */
export function describeFeeShortfall(shortfall: FeeShortfall): FeeShortfallCopy {
  const others = shortfall.transactionCount - 1;
  const opensAccount = shortfall.rentLamports > 0;
  const belowMinimum = shortfall.reserveLamports > 0;
  const othersNote =
    others > 0
      ? ` The other ${pluralize(others, "transaction")} need about ${formatSol(
          Math.max(0, shortfall.totalFeeLamports - shortfall.firstFeeLamports),
        )} more, which the rent those closes return normally covers.`
      : "";
  const rentNote = opensAccount
    ? ` plus ${formatSol(shortfall.rentLamports)} for the account it opens, which comes back when that account closes at the end of the same transaction`
    : "";
  // A wallet can be short of neither the fee nor a deposit and still be unable to
  // pay: Solana will not leave an account holding a non-zero balance below its
  // rent-exempt minimum. Quoting "not enough for the fee" there would be a lie,
  // and the raw cluster sentence ("insufficient funds for rent") is a dead end.
  const reserveNote = belowMinimum
    ? `, and the account has to keep ${formatSol(
        shortfall.reserveLamports,
      )} more to stay above Solana's rent-exempt minimum`
    : "";
  const whyNote = opensAccount
    ? "The fee and that deposit are both taken before any instruction runs, so neither can come out of what the transaction itself returns."
    : belowMinimum
      ? "An account cannot be left holding less than the rent-exempt minimum — it must be either empty or above it — so this balance cannot pay a fee at all."
      : "Reclaimed rent cannot pay for this one: Solana takes the fee before a close releases anything.";

  return {
    // A swap needs more than a fee, and saying "for the fee" while quoting a
    // deposit would be the kind of half-truth this app keeps out of its copy.
    title: opensAccount
      ? "Not enough SOL to send this"
      : belowMinimum
        ? "This wallet is below the minimum balance"
        : "Not enough SOL for the fee",
    message: `This wallet holds ${formatSol(
      shortfall.availableLamports,
    )}, and the first transaction needs ${formatSol(
      shortfall.firstFeeLamports,
    )} in network fees${rentNote}${reserveNote} — ${formatSol(
      shortfall.shortfallLamports,
    )} short, so there is nothing to sign yet.`,
    hint: `Send at least ${formatSol(
      shortfall.suggestedLamports,
    )} to ${shortfall.payer} from another wallet or exchange, then run the preview again. ${whyNote}${othersNote}`,
  };
}

/**
 * Thrown during planning, before a signature is requested.
 *
 * Typed rather than matched by text, so `toFriendlyError` can return the exact
 * figures instead of a generic "not enough SOL" line.
 */
export class FeeShortfallError extends Error {
  override readonly name = "FeeShortfallError";

  constructor(readonly shortfall: FeeShortfall) {
    super(describeFeeShortfall(shortfall).message);
  }
}


/**
 * A wallet holding no lamports at all.
 *
 * This is a different failure from "short of the fee", and it used to be
 * misreported as one: an account with zero lamports does not exist on chain, so
 * the cluster answers `AccountNotFound` — which the simulator read as "a token
 * account no longer exists, rescan your wallet". Measured against a real
 * zero-balance wallet trying to swap 20¢ of USDC, and it sent the user off to
 * rescan a wallet that was never the problem.
 */
export function describeEmptyWallet(payer: string): FeeShortfallCopy {
  return {
    title: "This wallet has no SOL",
    message:
      "It holds no lamports at all, so it has no account on chain yet — which is why this could not even be simulated. Nothing can be signed from it until it has some SOL.",
    hint: `If it has an empty token account, close it in Salvage first: Spacedust advances that fee and takes it back out of the rent, so it costs nothing. Otherwise send a little SOL to ${payer} from another wallet or exchange, then try again.`,
  };
}

/** Thrown when the fee payer has no account at all. */
export class EmptyWalletError extends Error {
  override readonly name = "EmptyWalletError";

  constructor(readonly payer: string) {
    super(describeEmptyWallet(payer).message);
  }
}
