/**
 * Server-only configuration.
 *
 * Naming this file `.ts` (not `.env.ts`) is deliberate: it is imported only by
 * Route Handlers and Server Components. Anything read here is available to the
 * server and never inlined into the client bundle, because Next.js only
 * substitutes `process.env.*` for variables prefixed with `NEXT_PUBLIC_`.
 */

/** Mainnet cluster. Dust sweeping on devnet is not a thing. */
export const CLUSTER = "mainnet-beta" as const;

/** Default public RPC, used only if you have not configured Helius. */
const DEFAULT_FALLBACK_RPC = "https://api.mainnet-beta.solana.com";

/**
 * Throw a 424-able message when a required key is missing.
 *
 * We use HTTP 424 Failed Dependency so the client's `apiFetch` can tell
 * "you forgot to configure the app" apart from "the upstream service broke",
 * and show the setup instructions instead of a generic error.
 */
export class MissingEnvError extends Error {
  override readonly name = "MissingEnvError";
  constructor(readonly variable: string, readonly hint: string) {
    super(`${variable} is not set. ${hint}`);
  }
}

/**
 * Helius API key — **optional**.
 *
 * When set, Spacedust uses the Helius DAS API, which is faster and returns
 * richer metadata. When absent, it falls back to core Solana RPC plus Jupiter's
 * token API, so a personal deployment needs no account and no key at all.
 *
 * The same key is used as the RPC endpoint when present; otherwise
 * `NEXT_PUBLIC_FALLBACK_RPC_URL` is used.
 */
export function getHeliusApiKey(): string | undefined {
  const key = process.env.HELIUS_API_KEY?.trim();
  return key ? key : undefined;
}

/** True when the premium DAS scanner is available. */
export function hasHelius(): boolean {
  return getHeliusApiKey() !== undefined;
}

/** RPC endpoint used by our own server-side calls (DAS, ALT lookups). */
export function getServerRpcUrl(): string {
  const key = getHeliusApiKey();
  if (key) return `https://mainnet.helius-rpc.com/?api-key=${key}`;
  const fallback = process.env.NEXT_PUBLIC_FALLBACK_RPC_URL?.trim();
  return fallback && fallback.length > 0 ? fallback : DEFAULT_FALLBACK_RPC;
}

/**
 * Jupiter API key. Optional — Jupiter allows keyless access at a low rate
 * limit, which is enough for a personal dust sweeper at zero cost.
 */
export function getJupiterApiKey(): string | undefined {
  const key = process.env.JUPITER_API_KEY?.trim();
  return key ? key : undefined;
}

/** Base URL for Jupiter Swap API v2. */
export const JUPITER_SWAP_BASE = "https://api.jup.ag/swap/v2";


/** Base URL for Jupiter Price API v3. */
export const JUPITER_PRICE_BASE = "https://api.jup.ag/price/v3";