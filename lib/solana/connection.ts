"use client";

import { useMemo } from "react";
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
} from "@solana/web3.js";

/**
 * Browser-side Solana connection.
 *
 * `HELIUS_API_KEY` is deliberately *not* exposed to the client, so the browser
 * cannot talk to Helius directly. Instead it posts to our own same-origin
 * `/api/rpc` proxy, which forwards an allow-list of JSON-RPC methods with the
 * key attached server-side.
 *
 * Trade-off: one extra hop. In exchange, a free Helius key can never be
 * scraped from the page source, and we keep a single place to enforce rate
 * limits and reject unsafe methods.
 */

/** Build the same-origin proxy URL for the current environment. */
export function rpcProxyUrl(): string {
  if (typeof window === "undefined") {
    // During SSR there is no origin; this path is never used server-side.
    return "http://localhost:3000/api/rpc";
  }
  return `${window.location.origin}/api/rpc`;
}

/**
 * A `Connection` pointed at the proxy.
 *
 * `commitment: confirmed` is the sweet spot for a consumer dApp: `processed`
 * can report balances that later revert, while `finalized` adds ~13 seconds of
 * latency for no benefit when we immediately re-scan after a sweep.
 */
export function getConnection(): Connection {
  return new Connection(rpcProxyUrl(), {
    commitment: "confirmed",
    // Confirmed is plenty here and much cheaper to serve.
    confirmTransactionInitialTimeout: 60_000,
  });
}

/**
 * Load the address lookup tables Jupiter referenced in its `/build` responses.
 *
 * Jupiter returns `addressesByLookupTableAddress: { <altAddress>: [addresses] }`.
 * We must resolve each ALT from the chain before compiling a v0 message, and we
 * cache the results for the lifetime of the page because a single sweep usually
 * reuses the same small set of tables across every token.
 */
export async function loadLookupTables(
  connection: Connection,
  altAddresses: string[],
): Promise<AddressLookupTableAccount[]> {
  const unique = Array.from(new Set(altAddresses)).filter(Boolean);
  if (unique.length === 0) return [];

  const cache = getAltCache();
  const results = await Promise.all(
    unique.map(async (address) => {
      const cached = cache.get(address);
      if (cached) return cached;

      try {
        const response = await connection.getAddressLookupTable(
          new PublicKey(address),
        );
        const value = response.value;
        // A deactivated ALT cannot resolve addresses. If Jupiter handed us one,
        // the safest thing is to drop it and let the packer discover that the
        // swap cannot be compressed into a v0 message.
        if (!value || !value.isActive()) return null;
        cache.set(address, value);
        return value;
      } catch {
        return null;
      }
    }),
  );

  return results.filter(
    (table): table is AddressLookupTableAccount => table !== null,
  );
}

let altCache: Map<string, AddressLookupTableAccount> | null = null;

/** Lazily created module-level cache. Cleared by `clearLookupTableCache`. */
function getAltCache(): Map<string, AddressLookupTableAccount> {
  if (!altCache) altCache = new Map();
  return altCache;
}

/** Drop cached lookup tables — used when starting a brand new sweep. */
export function clearLookupTableCache(): void {
  altCache = new Map();
}

/** React hook wrapper so the connection identity is stable across renders. */
export function useSolanaConnection(): Connection {
  return useMemo(() => getConnection(), []);
}