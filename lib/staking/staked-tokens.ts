import type { StakedHoldingRef } from "@/types/token";

/**
 * Staking tokens we can name, and the protocol each one belongs to.
 *
 * WHY THIS IS A CURATED LIST AND NOT A DETECTION
 *
 * A liquid staking token is an ordinary SPL token: `getTokenAccountsByOwner`
 * shows it beside dust, the Jupiter Price API prices it, and a sweep would sell
 * it just like anything else. Nothing *on the mint itself* says "this is staked
 * SOL" — the meaning lives in who issued it.
 *
 * We could infer it. Jupiter tags these `lst`, and the mint's authority being a
 * program is a strong hint (every entry below has one). But a hint is not a name:
 * `lib/sweep/pool-positions.ts` explains at length why this codebase refuses to
 * say "Raydium" about a mint it only knows is program-controlled. Calling mSOL
 * "staked with Marinade" is a claim about a specific protocol, so it has to rest
 * on a specific address we checked — not on a heuristic that happened to match.
 *
 * WHAT EACH ENTRY IS
 *
 * A mint we verified on mainnet, paired with the protocol name from that token's
 * own official listing. The list is deliberately the tokens a wallet is likely
 * to actually hold (the `lst` tag carries 160+ mints, most of them obscure), and
 * it is ordered by holder count so the intent is visible in the file.
 *
 * WHAT HAPPENS TO AN UNLISTED STAKING TOKEN
 *
 * Nothing bad. If its mint is program-controlled it is still caught by
 * `isPoolLikeMint` and still excluded from sweeps — it simply shows under the
 * generic "held in a program" note instead of a name we could not stand behind.
 * The failure mode of a missing entry is a vaguer label, never a wrong one.
 */

/** A recognised staking token: an SPL mint that represents a staked position. */
export interface StakedTokenEntry extends StakedHoldingRef {
  /** The SPL mint a wallet holds when it holds this position. */
  mint: string;
}

/**
 * The curated registry, highest holder count first.
 *
 * Sources, so the next person can re-check rather than re-guess: mints and
 * protocol names are from mainnet and from each token's own listing via
 * Jupiter's `tokens/v2/tag?query=lst`; the program-controlled mint authority of
 * every entry was confirmed with `probes/tmp-lst-authority-probe.mjs`.
 */
export const LIQUID_STAKING_TOKENS: readonly StakedTokenEntry[] = [
  // ~185k holders. The largest non-custodial LST.
  { mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", symbol: "JitoSOL", protocol: "Jito", underlying: "SOL" },
  // ~150k. The oldest, and the one the README's example names.
  { mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", symbol: "mSOL", protocol: "Marinade", underlying: "SOL" },
  { mint: "pSo1f9nQXWgXibFtKf7NWYxb5enAM4qfP6UJSiXRQfL", symbol: "PSOL", protocol: "Phantom", underlying: "SOL" },
  { mint: "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1", symbol: "bSOL", protocol: "BlazeStake", underlying: "SOL" },
  { mint: "sSo14endRuUbvQaJS3dq36Q829a3A6BEfoeeRGJywEh", symbol: "sSOL", protocol: "Solayer", underlying: "SOL" },
  { mint: "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm", symbol: "INF", protocol: "Sanctum", underlying: "SOL" },
  { mint: "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj", symbol: "stSOL", protocol: "Lido", underlying: "SOL" },
  { mint: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v", symbol: "JupSOL", protocol: "Jupiter", underlying: "SOL" },
  { mint: "LSTxxxnJzKDFSLr4dUkPcmCf5VyryEqzPLz5j4bpxFp", symbol: "LST", protocol: "Sanctum", underlying: "SOL" },
  { mint: "sonickAJFiVLcYXx25X9vpF293udaWqDMUCiGtk7dg2", symbol: "sonicSOL", protocol: "Sonic", underlying: "SOL" },
  { mint: "BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85", symbol: "BNSOL", protocol: "Binance", underlying: "SOL" },
  { mint: "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A", symbol: "hSOL", protocol: "Helius", underlying: "SOL" },
  { mint: "Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B", symbol: "bbSOL", protocol: "Bybit", underlying: "SOL" },
  { mint: "Gekfj7SL2fVpTDxJZmeC46cTYxinjB6gkAnb6EGT6mnn", symbol: "dzSOL", protocol: "DoubleZero", underlying: "SOL" },
  { mint: "BGSo18NXTWGtyNa5DBBP1ZCfUFRPWj6bECrPKakn8qN", symbol: "BGSOL", protocol: "Bitget", underlying: "SOL" },
  { mint: "BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXhtTs", symbol: "bonkSOL", protocol: "Bonk", underlying: "SOL" },
  { mint: "Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ", symbol: "dSOL", protocol: "Drift", underlying: "SOL" },
  { mint: "9EaLkQrbjmbbuZG9Wdpo8qfNUEjHATJFSycEmw6f1rGX", symbol: "pSOL", protocol: "Parrot", underlying: "SOL" },
];

/** Mint → entry. Built once, so a scan does a map lookup per holding, not a search. */
const BY_MINT = new Map<string, StakedTokenEntry>(
  LIQUID_STAKING_TOKENS.map((entry) => [entry.mint, entry]),
);

/**
 * Is this mint a staking token we can name?
 *
 * Returns the protocol reference, or `null` when the mint is not in the
 * registry — `null` meaning "we cannot name this", never "this is not staked".
 */
export function stakedTokenFor(mint: string): StakedHoldingRef | null {
  const entry = BY_MINT.get(mint);
  if (!entry) return null;
  return {
    protocol: entry.protocol,
    underlying: entry.underlying,
    symbol: entry.symbol,
  };
}

/**
 * What the scan says above the staked list, written here so no screen invents
 * its own.
 *
 * It has to do two jobs: say why these are not in the recoverable total (a sweep
 * will not sell them), and be clear that the position is not lost — staking is
 * reversible, just not from here.
 */
export const STAKED_POSITION_NOTE =
  "Liquid staking tokens: each one is a claim on staked SOL, issued by the protocol beside it, and it keeps earning as long as you hold it. A sweep does not sell these — unwinding one is a deliberate move made in that protocol's own app, so they are left out of the total above rather than cashed in for you.";
