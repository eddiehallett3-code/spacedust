import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  TOKEN_2022_PROGRAM_ID,
  buildWithdrawExcessLamportsInstruction,
  computeExcessLamports,
} from "./excess-rent";

/**
 * The exact case from the wallet in the report. The two NFT accounts held
 * 1,912,566 lamports at space 174, whose rent-exempt minimum is 1,534,160.
 * Sol Incinerator withdrew the difference — 378,406 — and left the NFTs open.
 */
describe("excess rent", () => {
  it("computes the live transaction's 378,406 lamports", () => {
    expect(computeExcessLamports(1_912_566, 1_534_160)).toBe(378_406);
  });

  it("never returns a negative amount", () => {
    expect(computeExcessLamports(1_534_160, 1_534_160)).toBe(0);
    expect(computeExcessLamports(1_000_000, 1_534_160)).toBe(0);
    expect(computeExcessLamports(Number.NaN, 1_534_160)).toBe(0);
  });

  it("builds the exact account order and instruction byte", () => {
    const account = new PublicKey(
      "A2xKwTtehdNF9KzkMbEwwj14yBbKqARf2Rbk8o4ezaK",
    );
    const owner = new PublicKey(
      "G4ucVPdGWwbPxJdox4acDpcN8tFXU2VP35Dg9wbEmG95",
    );
    const instruction = buildWithdrawExcessLamportsInstruction(
      account,
      owner,
      owner,
    );

    expect(instruction.programId.toBase58()).toBe(TOKEN_2022_PROGRAM_ID);
    expect(instruction.keys).toEqual([
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ]);
    expect([...instruction.data]).toEqual([38]);
  });
});
