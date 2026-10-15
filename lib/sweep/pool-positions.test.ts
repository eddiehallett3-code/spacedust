import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { isPoolLikeMint, isPoolPosition, POOL_POSITION_NOTE } from "@/lib/sweep/pool-positions";

/**
 * "A wallet can be a mint authority; a program cannot."
 *
 * That asymmetry is the whole detection, and these tests exist because the first
 * two attempts at it were both wrong in ways that looked fine:
 *
 *  - "a one-of-one with no decimals" flagged **every NFT ever minted**. Run
 *    against the Incinerator as a control, it produced 18 confident pool
 *    positions (ArtPunk, Lunaroid, Frame) and not one was a pool.
 *  - A revoked authority is not a program authority. The control run found 996
 *    held mints and all 996 had theirs revoked, so anything that read "no
 *    authority" as interesting would have flagged the lot.
 */

/** A real PDA: off the curve by construction, which is what a program's is. */
function programAddress(seed: string): string {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed)],
    new PublicKey("11111111111111111111111111111111"),
  )[0].toBase58();
}

const WALLET = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";

describe("isPoolLikeMint", () => {
  it("accepts a program-controlled mint", () => {
    expect(isPoolLikeMint(programAddress("lp"))).toBe(true);
  });

  it("rejects a wallet, because a wallet can be an authority", () => {
    expect(isPoolLikeMint(WALLET)).toBe(false);
  });

  it("rejects a revoked authority", () => {
    // The state of all 996 mints in the control run. If this ever returned true,
    // every ordinary finished token would be reported as a pool position.
    expect(isPoolLikeMint(null)).toBe(false);
    expect(isPoolLikeMint("")).toBe(false);
  });

  it("rejects anything that is not an address", () => {
    // A malformed response must not become a claim about the user's wallet.
    expect(isPoolLikeMint("not base58")).toBe(false);
    expect(isPoolLikeMint("0")).toBe(false);
  });

  it("does not confuse a PDA with the program that owns it", () => {
    // The program id itself is a real public key. Only the *derived* address a
    // program controls is off the curve, so the two are told apart.
    const program = new PublicKey("11111111111111111111111111111111").toBase58();
    expect(isPoolLikeMint(program)).toBe(false);
    expect(isPoolLikeMint(programAddress("lp"))).not.toBe(
      isPoolLikeMint(program),
    );
  });
});

describe("POOL_POSITION_NOTE", () => {
  it("explains why the value is not in the total", () => {
    expect(POOL_POSITION_NOTE).toContain("not counted in the total");
  });

  it("says what the signal is, rather than claiming it is proof", () => {
    // "controlled by a program" is a fact about the mint. "This is a Raydium
    // position" would be a claim we cannot support — we know no pool, no reserve
    // and no protocol for it.
    expect(POOL_POSITION_NOTE).toContain("controlled by a program");
    expect(POOL_POSITION_NOTE).not.toMatch(/Raydium|Orca|Meteora|Whirlpool/);
  });

  it("warns that burning one gives the share away", () => {
    expect(POOL_POSITION_NOTE).toContain("burning one would give the share away");
  });
});

/**
 * The shape is a signal; a market is the verdict.
 *
 * These tests exist because the signal alone was wrong in the wild, in both
 * directions and twice: Pudgy Penguins — 562k holders, quoted by Jupiter, and a
 * mint authority held by a multisig vault — was labelled a liquidity position in
 * the read-only scan, and then removed from the sweeper's token list entirely
 * once that list learned to respect the label.
 */
describe("isPoolPosition", () => {
  /** A real PDA: off the curve by construction, which is what a program's is. */
  const programAuthority = programAddress("lp");
  const walletAuthority = WALLET;

  it("refuses a program-controlled mint that no market prices", () => {
    // The case the refusal was always for: a claim with nowhere to go.
    expect(isPoolPosition(programAuthority, false)).toBe(true);
  });

  it("accepts a program-controlled mint that has a market — the PENGU case", () => {
    // Shape says program, the market says tradable. The market wins, because
    // shape does not decide whether anybody will buy it.
    expect(isPoolPosition(programAuthority, true)).toBe(false);
  });

  it("accepts a wallet-controlled mint, priced or not", () => {
    // An ordinary unpriced token is not a position — The Void can still burn it
    // for the rent, which is the recoverable part.
    expect(isPoolPosition(walletAuthority, false)).toBe(false);
    expect(isPoolPosition(walletAuthority, true)).toBe(false);
  });

  it("accepts a revoked authority, which belongs to nobody", () => {
    // The state of all 996 mints in the Incinerator control run.
    expect(isPoolPosition(null, false)).toBe(false);
  });
});
