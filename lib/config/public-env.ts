/**
 * Public (browser-visible) configuration.
 *
 * Only `NEXT_PUBLIC_*` variables reach the client, and every value here is
 * deliberately public: the fee wallet is a receiving address that ends up in
 * swap instructions on chain anyway, and the fallback RPC is a public
 * endpoint. Anything secret belongs in `lib/config/env.ts` instead.
 *
 * Access is guarded so a missing build-time substitution yields `null` rather
 * than the literal string "undefined" being rendered into a transfer.
 */

import { isValidSolanaAddress } from "@/lib/utils/sanitize";

/**
 * Wallet that receives integrator fees, or `null` when fees are switched off.
 *
 * This has to be public rather than server-only: a swap fee is applied by the
 * server through Jupiter, but The Void's fee is a SOL transfer the *browser*
 * builds, and the browser cannot read a server-only variable. Publishing a
 * receiving address costs nothing — it is visible on chain regardless.
 *
 * Validated here rather than at each use site, so an invalid value disables
 * fees instead of building a transfer to a typo.
 */
export function getPublicFeeWallet(): string | null {
  const value = process.env.NEXT_PUBLIC_FEE_WALLET?.trim();
  if (!value) return null;
  return isValidSolanaAddress(value) ? value : null;
}

/** Public RPC fallback used when Helius is unavailable. */
export function getPublicFallbackRpcUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_FALLBACK_RPC_URL?.trim();
  return value && value.length > 0 ? value : null;
}