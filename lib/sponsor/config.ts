import "server-only";

import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

/**
 * The fee-sponsor key.
 *
 * **This is the only key Spacedust ever holds.** It exists for one purpose: to
 * pay the network fee for a wallet that has rent to reclaim and no SOL to pay
 * for the transaction that reclaims it. It is not a treasury, it does not hold
 * user funds, and it cannot move a user's assets — the policy in
 * `lib/sponsor/policy.ts` refuses any transaction that names it outside its own
 * repayment, and it is never a signer of anything the user did not sign first.
 *
 * Handling rules, in order of how much they matter:
 *
 *  1. It lives in `FEE_SPONSOR_SECRET_KEY`, unprefixed. A `NEXT_PUBLIC_` name
 *     would publish it to every visitor, and this module imports `server-only`
 *     so an accidental client import fails the build instead of shipping it.
 *  2. It is never logged. `getSponsorAddress()` is what diagnostics print.
 *  3. It is a hot wallet by design. Treat the float as money already spent:
 *     fund it with a small amount, top it up by hand, and rotate it by replacing
 *     the variable — there is no state to migrate.
 *
 * Accepted formats: the base58 secret key a wallet exports, or the 64-number
 * JSON array `solana-keygen` writes. Anything else disables sponsorship rather
 * than half-enabling it.
 */
function parseSecret(value: string): Keypair | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  try {
    if (trimmed.startsWith("[")) {
      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return null;
      const bytes = Uint8Array.from(parsed as number[]);
      return bytes.length === 64 ? Keypair.fromSecretKey(bytes) : null;
    }
    const bytes = bs58.decode(trimmed);
    return bytes.length === 64 ? Keypair.fromSecretKey(bytes) : null;
  } catch {
    // A malformed key must never fall through to "enabled with something else".
    return null;
  }
}

/** `undefined` until the first read; `null` once we know it is not configured. */
let cached: Keypair | null | undefined;

/** The sponsor, or `null` when sponsorship is switched off. */
export function getSponsorKeypair(): Keypair | null {
  if (cached !== undefined) return cached;
  cached = parseSecret(process.env.FEE_SPONSOR_SECRET_KEY ?? "");
  return cached;
}

/** The sponsor's public address — safe to show, and the only thing logged. */
export function getSponsorAddress(): string | null {
  return getSponsorKeypair()?.publicKey.toBase58() ?? null;
}

/** True when a usable key is configured. */
export function isSponsorConfigured(): boolean {
  return getSponsorKeypair() !== null;
}
