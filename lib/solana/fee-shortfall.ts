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

  if (firstFeeLamports <= 0) return null;
  if (availableLamports >= firstFeeLamports) return null;

  const shortfallLamports = firstFeeLamports - availableLamports;
  return {
    payer: input.payer,
    availableLamports,
    firstFeeLamports,
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
  const othersNote =
    others > 0
      ? ` The other ${pluralize(others, "transaction")} need about ${formatSol(
          Math.max(0, shortfall.totalFeeLamports - shortfall.firstFeeLamports),
        )} more, which the rent those closes return normally covers.`
      : "";

  return {
    title: "Not enough SOL for the fee",
    message: `This wallet holds ${formatSol(
      shortfall.availableLamports,
    )}, and the first transaction needs ${formatSol(
      shortfall.firstFeeLamports,
    )} in network fees — ${formatSol(
      shortfall.shortfallLamports,
    )} short, so there is nothing to sign yet.`,
    hint: `Send at least ${formatSol(
      shortfall.suggestedLamports,
    )} to ${shortfall.payer} from another wallet or exchange, then run the preview again. Reclaimed rent cannot pay for this one: Solana takes the fee before a close releases anything.${othersNote}`,
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
