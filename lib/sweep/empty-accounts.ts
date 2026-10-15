import { isValidSolanaAddress } from "@/lib/utils/sanitize";
import type { EmptyTokenAccount } from "@/types/token";

/**
 * Which already-empty token accounts can actually be closed.
 *
 * An emptied account still exists and still holds its rent-exempt deposit —
 * about 0.002 SOL, and read from the account rather than assumed, because a
 * Token-2022 account with extensions holds more and the network's own minimum has
 * moved before. Nothing in the app could see them —
 * both scanners drop `amount === "0"` — so that rent was simply unreachable:
 * a sweep only ever closes accounts *its own swap* emptied.
 *
 * The rules below are not inferred from documentation. Every one was settled by
 * building this exact instruction and simulating it against real mainnet
 * accounts — see `probes/tmp-empty-accounts.mjs`, and the findings recorded here:
 *
 * | The account | Closing it |
 * |---|---|
 * | empty, ordinary | works — 120 CU |
 * | empty **and frozen** | works. Freezing blocks transfer, burn and revoke, but *not* close |
 * | empty with a **delegate** | works. A delegate is a transfer permission, and close is not a transfer |
 * | empty with a **foreign close authority** | **fails** — `Custom: 4`, "owner does not match" |
 * | Token-2022, empty | works — ~1,500 CU, more with extensions |
 * | Token-2022 with **withheld transfer fees** | **fails** — `Custom: 35`, the mint must harvest them first |
 *
 * Two of those contradict what this project previously assumed, which is why
 * they are asserted in `empty-accounts.test.ts` rather than left as comments:
 * the frozen rule is the *opposite* of the one for a burn or a revoke, and a
 * close authority can take the account out of the owner's hands entirely.
 */

export type EmptyAccountSkipReason =
  | "foreign-close-authority"
  | "withheld-fees"
  | "nothing-to-reclaim"
  | "invalid-address";

/** An account the wallet cannot close, and the reason it cannot. */
export interface SkippedEmptyAccount {
  account: EmptyTokenAccount;
  reason: EmptyAccountSkipReason;
}

export interface EmptyAccountPlan {
  /** Accounts whose rent will genuinely come back. */
  closeable: EmptyTokenAccount[];
  /** Accounts that will not, each with a reason. Never silently dropped. */
  skipped: SkippedEmptyAccount[];
  /**
   * Rent the closeable accounts hold, in lamports.
   *
   * Summed from each account's **own** balance rather than multiplied by a rent
   * constant, because the two programs do not hold the same amount: a
   * Token-2022 account with extensions holds 2,074,080 lamports where a legacy
   * account holds 2,039,280, and one carrying a withheld fee held 2,192,400.
   * Pricing from a single figure would understate every Token-2022 row — the
   * same shape of error as the rent this project once overstated by 37%.
   */
  lamports: number;
}

/** A human-readable reason, for the one line each skipped account gets. */
export const EMPTY_ACCOUNT_SKIP_TEXT: Record<EmptyAccountSkipReason, string> = {
  "foreign-close-authority":
    "another key is set as its close authority, so only that key can close it",
  "withheld-fees":
    "it holds withheld transfer fees, which the mint has to harvest first",
  "nothing-to-reclaim": "it holds no lamports to return",
  "invalid-address": "its address could not be verified",
};

/**
 * Split empty accounts into the ones that will close and the ones that will not.
 *
 * `owner` is the connected wallet: it both signs and receives the rent.
 */
export function planEmptyAccountCloses(
  accounts: readonly EmptyTokenAccount[],
  owner: string,
): EmptyAccountPlan {
  const closeable: EmptyTokenAccount[] = [];
  const skipped: SkippedEmptyAccount[] = [];
  let lamports = 0;

  const seen = new Set<string>();

  for (const account of accounts) {
    const skip = (reason: EmptyAccountSkipReason): void => {
      skipped.push({ account, reason });
    };

    // A duplicate would be a second close of the same account: the first
    // succeeds, the second fails and takes the whole transaction with it.
    if (seen.has(account.address)) continue;
    seen.add(account.address);

    if (!isValidSolanaAddress(account.address)) {
      skip("invalid-address");
      continue;
    }

    // Verified: once a close authority is set, only it may close the account —
    // *even though* we sign as the owner. The owner's signature is not enough,
    // so this is a hard refusal rather than a risk to weigh.
    if (account.closeAuthority !== null && account.closeAuthority !== owner) {
      skip("foreign-close-authority");
      continue;
    }

    // Verified: `Custom: 35` — "An account can only be closed if its withheld
    // fee balance is zero, harvest fees to the mint and try again." Harvesting
    // needs the mint's authority, which we do not have.
    if (account.withheldFees > 0) {
      skip("withheld-fees");
      continue;
    }

    if (!Number.isFinite(account.lamports) || account.lamports <= 0) {
      skip("nothing-to-reclaim");
      continue;
    }

    // `frozen` is deliberately not consulted. A frozen account closes, which is
    // the opposite of every other flow here: a frozen balance can be neither
    // sold nor burned, but its rent is recoverable.
    lamports += Math.trunc(account.lamports);
    closeable.push(account);
  }

  return { closeable, skipped, lamports };
}

