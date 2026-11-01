import { getHeliusApiKey } from "@/lib/config/env";
import {
  HOLDER_COLLECTION,
  HOLDER_REQUIRED,
  countFromIndexResponse,
  holderStatus,
  unavailableStatus,
  type HolderStatus,
} from "./holder-membership";

/**
 * Ask the metadata index how many Turtles this wallet holds.
 *
 * `searchAssets` with both an owner and a grouping, rather than `getAssetsByOwner`
 * and a filter in memory: the filter version pages through every NFT in a wallet
 * that may hold thousands, to answer a question about ten. This asks for ten and
 * reads the total.
 *
 * `showUnverifiedCollections: false` is the part that matters for money. It makes
 * the index count only membership the collection authority actually signed — the
 * same guarantee the metadata account's `verified` flag gives, checked before the
 * assets are returned rather than after. Without it, anyone can mint ten NFTs
 * whose metadata *points at* this collection and collect a fee waiver for it.
 */

const CACHE_TTL_MS = 5 * 60_000;

/**
 * Answers, kept briefly and in memory.
 *
 * A holder opens a panel, previews, changes the amount, previews again — the
 * answer cannot change within that, and every re-ask costs an index credit. Five
 * minutes is short enough that selling the tokens takes effect in the same
 * session, and long enough to cover one flow's worth of hovering.
 */
const cache = new Map<string, { status: HolderStatus; at: number }>();
const CACHE_MAX = 500;

function readCache(owner: string): HolderStatus | null {
  const hit = cache.get(owner);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(owner);
    return null;
  }
  return hit.status;
}

function writeCache(owner: string, status: HolderStatus): void {
  if (cache.size >= CACHE_MAX) {
    // Oldest first: Map preserves insertion order, and a holder who has been
    // quiet for longer than the TTL would have been evicted anyway.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(owner, { status, at: Date.now() });
}

export async function readHolderStatus(owner: string): Promise<HolderStatus> {
  const cached = readCache(owner);
  if (cached) return cached;

  const apiKey = getHeliusApiKey();
  if (!apiKey) {
    // No index configured is not an error for the user: they are simply not
    // entitled, and the fee is charged as normal. Reporting a failure here would
    // put "could not check" in front of someone who never asked.
    return unavailableStatus();
  }

  const response = await fetch(
    `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "holder-membership",
        method: "searchAssets",
        params: {
          ownerAddress: owner,
          grouping: ["collection", HOLDER_COLLECTION],
          page: 1,
          limit: HOLDER_REQUIRED,
          displayOptions: { showUnverifiedCollections: false },
        },
      }),
      // Cached above, but a hung request must not hold a panel open.
      signal: AbortSignal.timeout(8_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Index returned ${response.status}`);
  }

  const json = (await response.json()) as {
    result?: { total?: number; items?: unknown[] };
    error?: { message?: string };
  };

  if (json.error) {
    throw new Error(json.error.message ?? "Index rejected the query");
  }

  const status = holderStatus(countFromIndexResponse(json.result ?? {}));
  writeCache(owner, status);
  return status;
}
