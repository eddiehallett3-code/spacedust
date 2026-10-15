import { parseBaseAmount } from "@/lib/utils/sanitize";

/**
 * How much of a token to swap.
 *
 * Slingshot began as a dust sweeper: every selected token went in **full**, and
 * the account it emptied was closed for its rent. Letting a user choose part of
 * a balance changes two things at once, and the second is the one that bites:
 *
 *  - the swap is built for the chosen amount instead of the balance;
 *  - **the rent reclaim has to be skipped.** `closeAccount` is only legal once
 *    the account is empty, so a partial swap leaves a balance behind and the
 *    close fails — and because the packer puts many swaps in one transaction,
 *    a single bad close takes the entire batch down with it.
 *
 * So "how much" and "can we close it" are the same question, and this file is
 * where it is answered once for both callers. `emptiesAccount` is that answer.
 *
 * EVERYTHING HERE IS `bigint`-ONLY
 *
 * Balances are base-unit strings throughout, never floats. A `u64` balance can
 * exceed `Number.MAX_SAFE_INTEGER`, and `1.005 * 1e6` is 1004999.9999999999 —
 * the exact float bug that once left a residue an account could never be closed
 * for. See `toBaseAmount` in `lib/utils/sanitize.ts` for the other half of this.
 */

/** Why a chosen amount cannot be used. */
export type AmountProblem = "not-a-number" | "zero" | "exceeds-balance";

export type AmountResolution =
  | {
      ok: true;
      /** The amount to swap, in base units. */
      raw: string;
      /**
       * True when this is the whole balance, so the swap will empty the account
       * and its rent can be reclaimed.
       */
      emptiesAccount: boolean;
      /** `raw` as a fraction of the balance, 0..1. Used to scale USD figures. */
      fraction: number;
    }
  | { ok: false; problem: AmountProblem };

/**
 * Resolve a chosen amount against the balance it came from.
 *
 * An absent choice means the whole balance, which is the pre-existing behaviour
 * and must stay the default: a sweep with no per-token amounts selected behaves
 * exactly as it did before this existed.
 *
 * A choice that is malformed, zero, or **above the balance** is refused rather
 * than clamped. Clamping an over-balance request would quietly swap the whole
 * balance when the user asked for something that cannot exist, and silently
 * doing something other than what was asked is the failure mode this codebase
 * refuses everywhere else.
 */
export function resolveAmount(
  fullRaw: string,
  chosenRaw?: string | null,
): AmountResolution {
  const full = parseBaseAmount(fullRaw);
  if (full == null) return { ok: false, problem: "not-a-number" };
  // Nothing to swap. Callers already exclude a zero balance, so this is the
  // honest answer rather than a resolution of "0".
  if (full === 0n) return { ok: false, problem: "zero" };

  // No choice made: the whole balance, and the account will be emptied.
  if (chosenRaw == null || chosenRaw === "") {
    return {
      ok: true,
      raw: full.toString(),
      emptiesAccount: true,
      fraction: 1,
    };
  }

  const chosen = parseBaseAmount(chosenRaw);
  if (chosen == null) return { ok: false, problem: "not-a-number" };
  if (chosen <= 0n) return { ok: false, problem: "zero" };
  if (chosen > full) return { ok: false, problem: "exceeds-balance" };

  return {
    ok: true,
    raw: chosen.toString(),
    emptiesAccount: chosen === full,
    // Four decimal places is plenty for scaling a USD figure the user reads.
    fraction: full > 0n ? Number((chosen * 10_000n) / full) / 10_000 : 0,
  };
}

/**
 * A percentage of a balance, floored to whole base units.
 *
 * Floored, never rounded: 50% of a balance with an odd number of base units is
 * not representable, and rounding *up* would ask to swap more than the user
 * selected — the one direction that can fail on chain. `100` returns the balance
 * exactly, so "100%" always means "the whole thing", never 99.99% of it.
 */
export function percentOfBalance(fullRaw: string, percent: number): string {
  const full = parseBaseAmount(fullRaw) ?? 0n;
  if (!Number.isFinite(percent) || percent <= 0 || full === 0n) return "0";
  if (percent >= 100) return full.toString();
  return ((full * BigInt(Math.floor(percent))) / 100n).toString();
}

/**
 * Base units to a plain decimal string, for an input field.
 *
 * No grouping separators and no trailing zeros: this is text a user edits, so
 * "1,234.500000" would be both harder to type over and rejected by the parser
 * on the way back in. `toBaseAmount` accepts what this produces, which is the
 * property that matters — round-tripping an amount through the field must never
 * change it.
 */
export function rawToDecimalString(raw: string, decimals: number): string {
  const value = parseBaseAmount(raw);
  if (value == null) return "0";
  if (!Number.isInteger(decimals) || decimals <= 0) return value.toString();

  const digits = value.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

/** The only fields the rent-reclaim decision needs from a token. */
export interface CloseCandidate {
  mint: string;
  rawAmount: string;
  hasTransferFee: boolean;
}

/**
 * Which mints must **not** have their token account closed after the swap.
 *
 * Two reasons, and both are the same fact: the account will still hold something
 * when the close runs.
 *
 *  - A **partial** amount leaves a balance behind, and `closeAccount` refuses a
 *    non-empty account. Because the packer puts many swaps in one transaction,
 *    that single bad close fails the whole sweep — so this is not a missed
 *    optimisation, it is the difference between a batch landing and none of it
 *    landing.
 *  - A **transfer-fee** mint keeps a residue for its own reason, which predates
 *    partial amounts.
 *
 * Conservative by construction: an amount the resolver rejects is treated as
 * "will not empty" and skipped, never assumed safe.
 */
export function mintsWithoutRentReclaim(
  tokens: readonly CloseCandidate[],
  amounts: ReadonlyMap<string, string>,
): Set<string> {
  const skip = new Set<string>();
  for (const token of tokens) {
    if (token.hasTransferFee) {
      skip.add(token.mint);
      continue;
    }
    const chosen = amounts.get(token.mint);
    // No override, or an override equal to the balance: the swap empties it.
    if (chosen == null || chosen === token.rawAmount) continue;
    const amount = resolveAmount(token.rawAmount, chosen);
    if (!amount.ok || !amount.emptiesAccount) skip.add(token.mint);
  }
  return skip;
}
