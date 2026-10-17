import { describe, expect, it } from "vitest";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { nonCanonicalMints } from "./canonical";

/**
 * Which balances a swap cannot reach.
 *
 * The rule exists because Jupiter's route drains `ATA(owner, mint)` — it is given
 * a taker, not a source account — so a holding in any other token account would
 * move nothing and fail on chain after costing fees. Getting this wrong in either
 * direction is expensive: too loose and users sign a doomed transaction, too tight
 * and a perfectly sweepable token is refused.
 */

const OWNER = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OTHER = "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv";

const ata = (mint: string, program = TOKEN_PROGRAM_ID): string =>
  getAssociatedTokenAddressSync(
    new PublicKey(mint),
    new PublicKey(OWNER),
    true,
    program,
  ).toBase58();

const token = (
  mint: string,
  tokenAccount: string | null,
  program: "legacy" | "token2022" = "legacy",
): { mint: string; program: "legacy" | "token2022"; tokenAccount: string | null } => ({
  mint,
  program,
  tokenAccount,
});

describe("nonCanonicalMints", () => {
  it("says nothing about a balance held in the wallet's own ATA", () => {
    const mints = nonCanonicalMints(OWNER, [token(USDC, ata(USDC))]);
    expect(mints.size).toBe(0);
  });

  it("flags a balance held anywhere else", () => {
    // The shape an old airdrop leaves behind: a real account, the right mint,
    // and one a swap will never touch.
    const mints = nonCanonicalMints(OWNER, [token(USDC, OTHER)]);
    expect([...mints]).toEqual([USDC]);
  });

  it("flags only the tokens that are held oddly", () => {
    const mints = nonCanonicalMints(OWNER, [
      token(USDC, ata(USDC)),
      token(OTHER, OTHER),
    ]);
    expect([...mints]).toEqual([OTHER]);
  });

  it("leaves an unknown account alone — the composer derives the ATA for it", () => {
    const mints = nonCanonicalMints(OWNER, [token(USDC, null)]);
    expect(mints.size).toBe(0);
  });

  it("uses the mint's own token program in the derivation", () => {
    // A Token-2022 mint's ATA is a different address from the legacy one for the
    // same mint and owner, so the legacy address is *not* canonical here.
    const legacyAta = ata(USDC);
    const token2022Ata = ata(USDC, TOKEN_2022_PROGRAM_ID);

    expect(legacyAta).not.toBe(token2022Ata);
    expect(
      nonCanonicalMints(OWNER, [token(USDC, legacyAta, "token2022")]).has(USDC),
    ).toBe(true);
    expect(
      nonCanonicalMints(OWNER, [token(USDC, token2022Ata, "token2022")]).size,
    ).toBe(0);
  });

  it("flags nothing when the owner will not parse", () => {
    // The caller's schema refuses that request outright; this must not throw.
    expect(nonCanonicalMints("not an address", [token(USDC, OTHER)]).size).toBe(0);
  });
});
