import "server-only";

/**
 * Jupiter token metadata, fetched in batches.
 *
 * This is what replaces the metadata Helius DAS used to provide. `/tokens/v2/search`
 * accepts a comma-separated list of mints, and returns `symbol`, `name`,
 * `icon`, `decimals` and `tokenProgram` — enough to render a complete row.
 *
 * It degrades well: a token it has never heard of simply comes back absent, and
 * the caller falls back to a letter avatar and a truncated mint.
 */

/** Subset of the Jupiter token payload we consume. */
interface JupiterTokenInfo {
  id: string;
  name?: string;
  symbol?: string;
  icon?: string;
  decimals?: number;
  holderCount?: number;
  /** e.g. Tokenkeg… or Tokenz… — confirms which program owns the mint. */
  tokenProgram?: string;
}

export interface TokenMetadata {
  symbol: string | null;
  name: string | null;
  logoUri: string | null;
  decimals: number | null;
  holderCount: number | null;
  isToken2022: boolean | null;
}

const SEARCH_BASE = "https://lite-api.jup.ag/tokens/v2/search";

/**
 * Look up metadata for many mints at once.
 *
 * Batch size is kept modest: a very long query string is more likely to be
 * truncated or rejected than a short one, and dust wallets rarely exceed a few
 * hundred mints.
 */
export async function fetchTokenMetadata(
  mints: string[],
  batchSize = 25,
): Promise<Map<string, TokenMetadata>> {
  const out = new Map<string, TokenMetadata>();
  const unique = Array.from(new Set(mints));
  if (unique.length === 0) return out;

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    try {
      const response = await fetch(
        `${SEARCH_BASE}?query=${encodeURIComponent(batch.join(","))}`,
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(15_000),
          cache: "no-store",
        },
      );
      if (!response.ok) continue;

      const tokens = (await response.json()) as JupiterTokenInfo[];
      if (!Array.isArray(tokens)) continue;

      for (const token of tokens) {
        if (!token?.id) continue;
        out.set(token.id, {
          symbol: typeof token.symbol === "string" ? token.symbol : null,
          name: typeof token.name === "string" ? token.name : null,
          // Sanitised again on the way out by the caller; store raw here.
          logoUri: typeof token.icon === "string" ? token.icon : null,
          decimals:
            typeof token.decimals === "number" &&
            Number.isInteger(token.decimals) &&
            token.decimals >= 0 &&
            token.decimals <= 30
              ? token.decimals
              : null,
          holderCount:
            typeof token.holderCount === "number" ? token.holderCount : null,
          isToken2022: token.tokenProgram?.startsWith("Tokenz") ?? null,
        });
      }
    } catch {
      // Metadata is cosmetic. A failed batch must never fail the scan.
      continue;
    }
  }

  return out;
}