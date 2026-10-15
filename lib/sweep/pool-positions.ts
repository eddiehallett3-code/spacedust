import { PublicKey } from "@solana/web3.js";

/**
 * Is this mint controlled by a program rather than a person?
 *
 * The **signal**, not the verdict — see `isPoolPosition` below for the decision,
 * and for the token that proved this signal alone is not enough.
 *
 * WHY THIS AXIS, and how it was arrived at: the first attempt at detecting a liquidity position was "a one-of-one with no decimals",
 * which is every NFT in existence. Running that against the Incinerator as a
 * control produced 18 confident "pool positions" — ArtPunk, Lunaroid, Frame —
 * and none of them was a pool. The second attempt used the mint authority, and
 * the control showed why that is the right axis: of 996 mints held there, all 996
 * had their authority **revoked**, and a revoked authority belongs to nobody. The
 * signal is silent on ordinary tokens and NFTs, exactly as it should be.
 *
 * A wallet can be a mint authority. A program cannot. That asymmetry is the whole
 * test, and it needs no AMM SDK, no pool registry and no price.
 */
export function isPoolLikeMint(authority: string | null): boolean {
  if (!authority) {
    // Revoked: the mint is controlled by nobody, which is what an ordinary
    // finished token looks like — the state of all 996 mints in the control run.
    return false;
  }

  try {
    // A PDA is, by construction, not a valid ed25519 public key. Anything that
    // fails this is either on the curve (a wallet) or not an address at all
    // (garbage from a malformed response) — neither is a program.
    return !PublicKey.isOnCurve(new PublicKey(authority).toBytes());
  } catch {
    return false;
  }
}

/**
 * The decision: is this holding a position that cannot be sold?
 *
 * Shape alone is not enough, and this is where that was settled. **Pudgy
 * Penguins is the counterexample**: 562k holders, a live market, quoted by
 * Jupiter — and a mint authority that sits off the curve, because the project
 * holds it with a multisig vault. On the shape alone PENGU was classified as a
 * liquidity position, which removed a perfectly tradable token from every
 * sellable list. It surfaced twice, in both directions: first as a wrong label in
 * the read-only scan, then as the token disappearing from the sweeper's own list
 * once that list learned to respect the signal.
 *
 * A market is what actually decides. It is also already fetched — every scan
 * prices every holding — so asking "will anybody buy this?" costs nothing extra.
 * A program-controlled mint is therefore refused **only when no market will price
 * it**: a claim with nowhere to go, which is what the refusal was always meant to
 * catch. Program-controlled *with* a price is a token with a market, and it is
 * sold like any other.
 *
 * The residual case is a priced claim — an LP token some oracle quotes. It is
 * then treated as sellable, and if it cannot really be routed the sale fails and
 * is reported per token, which is a visible outcome rather than a silent
 * exclusion.
 */
export function isPoolPosition(
  authority: string | null,
  hasMarket: boolean,
): boolean {
  if (hasMarket) return false;
  return isPoolLikeMint(authority);
}

/**
 * What the scan says above the list, written here so no screen invents its own.
 *
 * It has to do two jobs at once: explain why these are not in the total, and not
 * pretend to know more than the signal does.
 */
export const POOL_POSITION_NOTE =
  "These are not ordinary tokens: their mint is controlled by a program and no market prices them, which is the shape of a pool share or a vault receipt whose pool is gone. The value, if any, sits inside that program, and only it can give the value back — a sweep cannot sell them, so they are not counted in the total above, and burning one would give the share away for nothing.";
