import type { Connection } from "@solana/web3.js";
import {
  EMPTY_ACCOUNT_RENT_LAMPORTS,
  HUSK_ACCOUNT_RENT_LAMPORTS,
  TOKEN_ACCOUNT_RENT_LAMPORTS,
  TOKEN_ACCOUNT_SIZE_BYTES,
  VOID_FEE_BPS,
} from "@/lib/utils/constants";

/**
 * Rent figures, fetched rather than assumed.
 *
 * The network sets rent-exemption, and it does change. It dropped from 3,480 to
 * 2,540 lamports per byte-year at some point, which quietly made our hardcoded
 * token-account rent ~37% too high. That fed two bug reports at once: every
 * "rent reclaimed" figure was inflated, and The Void's fee — a percentage *of
 * that rent* — silently charged 2.06% where the UI promised 1.5%.
 *
 * So nothing that touches money reads the constant any more. Both flows ask the
 * chain, once per plan, and thread the answer through. The constants survive
 * only as fallbacks for render paths that have no plan yet, and as the last
 * resort if the RPC call fails (charging a slightly stale fee is far better
 * than failing a burn outright).
 */
export interface RentMinimums {
  /** Rent-exempt minimum for one SPL token account (165 bytes). */
  tokenAccount: number;
  /** Rent-exempt minimum for an account with no data. */
  emptyAccount: number;
  /**
   * Rent-exempt minimum for a **one-byte** account.
   *
   * Not a curiosity: it is what a burned Core asset is left as. Core's burn
   * empties the asset account and shrinks it to a single zero byte rather than
   * closing it, so that byte keeps its rent and the wallet gets back the rest.
   * Measured on mainnet at 655,320 lamports apiece — a real fraction of the
   * reclaim on a typical asset, and the reason a Core burn was promising more
   * rent than it returned.
   */
  huskAccount: number;
}

/**
 * Fetch the rent minimums in one round trip.
 *
 * Never throws: a failure falls back to the constants. Callers are mid-plan and
 * must not be derailed by a rent query.
 */
export async function fetchRentMinimums(
  connection: Connection,
): Promise<RentMinimums> {
  const fallback: RentMinimums = {
    tokenAccount: TOKEN_ACCOUNT_RENT_LAMPORTS,
    emptyAccount: EMPTY_ACCOUNT_RENT_LAMPORTS,
    huskAccount: HUSK_ACCOUNT_RENT_LAMPORTS,
  };

  try {
    const [tokenAccount, emptyAccount, huskAccount] = await Promise.all([
      connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE_BYTES),
      connection.getMinimumBalanceForRentExemption(0),
      connection.getMinimumBalanceForRentExemption(CORE_HUSK_SIZE_BYTES),
    ]);

    return {
      // A zero or nonsense answer means the RPC did not really answer.
      tokenAccount: tokenAccount > 0 ? tokenAccount : fallback.tokenAccount,
      emptyAccount: emptyAccount > 0 ? emptyAccount : fallback.emptyAccount,
      huskAccount: huskAccount > 0 ? huskAccount : fallback.huskAccount,
    };
  } catch {
    return fallback;
  }
}

/**
 * What a burned Core asset's account is left as.
 *
 * Core shrinks the account to one zero byte instead of closing it, so this is
 * the size to price the rent at. `isCoreHusk` in `lib/solana/liveness.ts`
 * recognises the same shape in data.
 *
 * Verified rather than assumed: simulating a real burn on a real mainnet asset
 * leaves exactly one zero byte, and the Core program has no instruction that
 * would close the remainder. The residue — 655,320 lamports on the asset that
 * was measured — is stranded, which is why the rent a Core burn does *not*
 * return is priced here rather than left out. See `probes/tmp-core-husk.mjs`.
 */
export const CORE_HUSK_SIZE_BYTES = 1;

/**
 * A fee in basis points, taken from rent, floored.
 *
 * One implementation, because the two numbers that must not drift — the rate and
 * the rent it is applied to — are both arguments. Integer maths on BN-scale
 * values, floored: nobody is ever charged a lamport more than the stated rate.
 */
export function feeFromRentLamports(
  rentLamports: number,
  feeBps: number,
): number {
  if (rentLamports <= 0 || feeBps <= 0) return 0;
  return Number(
    (BigInt(Math.trunc(rentLamports)) * BigInt(feeBps)) / 10_000n,
  );
}

/**
 * The Void's fee for one closed account, priced against real rent.
 *
 * Takes the rent as an argument precisely so it cannot be called against a stale
 * constant by accident — a hardcoded rent once made this charge 2.06% while the
 * UI promised 1.5%.
 */
export function voidFeeFromRentLamports(rentLamports: number): number {
  return feeFromRentLamports(rentLamports, VOID_FEE_BPS);
}
