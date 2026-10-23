import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  CLOSE_USER_VOLUME_ACCUMULATOR_DISCRIMINATOR,
  PUMP_AMM_PROGRAM_ID,
  USER_VOLUME_ACCUMULATOR_DISCRIMINATOR,
  buildClosePumpAccumulatorInstruction,
  derivePumpAccumulator,
  derivePumpEventAuthority,
  isUserVolumeAccumulatorData,
} from "./pump-accumulator";

/**
 * These values are not invented. They are the ones from a real mainnet close
 * (`5Lpo4pLFyBAr…`): wallet `G4ucVPdGWwbPx…`, accumulator
 * `J1KxZFZxDRjz1…`, event authority `GS4CU59F31iL…`. If Pump changes a seed or
 * an Anchor discriminator, this test fails before a user signs anything.
 */
const OWNER = "G4ucVPdGWwbPxJdox4acDpcN8tFXU2VP35Dg9wbEmG95";
const ACCUMULATOR = "J1KxZFZxDRjz1Zg2gZdeQXC6mDsY28R8Wqq4vSrSfimc";
const EVENT_AUTHORITY = "GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR";

describe("Pump.fun user volume accumulator", () => {
  it("derives the known per-wallet accumulator", () => {
    expect(derivePumpAccumulator(OWNER).toBase58()).toBe(ACCUMULATOR);
  });

  it("derives the known event authority", () => {
    expect(derivePumpEventAuthority().toBase58()).toBe(EVENT_AUTHORITY);
  });

  it("uses the close discriminator from Pump's AMM IDL", () => {
    expect([...CLOSE_USER_VOLUME_ACCUMULATOR_DISCRIMINATOR]).toEqual([
      249, 69, 164, 218, 150, 103, 84, 138,
    ]);
  });

  it("builds the exact account list and data the program expects", () => {
    const owner = new PublicKey(OWNER);
    const instruction = buildClosePumpAccumulatorInstruction(owner);

    expect(instruction.programId.toBase58()).toBe(PUMP_AMM_PROGRAM_ID);
    expect(instruction.keys).toEqual([
      { pubkey: owner, isSigner: true, isWritable: true },
      {
        pubkey: new PublicKey(ACCUMULATOR),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: new PublicKey(EVENT_AUTHORITY),
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: new PublicKey(PUMP_AMM_PROGRAM_ID),
        isSigner: false,
        isWritable: false,
      },
    ]);
    expect([...instruction.data]).toEqual([
      ...CLOSE_USER_VOLUME_ACCUMULATOR_DISCRIMINATOR,
    ]);
  });

  it("refuses an accumulator that is not the wallet's PDA", () => {
    expect(() =>
      buildClosePumpAccumulatorInstruction(
        new PublicKey(OWNER),
        new PublicKey("11111111111111111111111111111111"),
      ),
    ).toThrow(/does not belong/);
  });

  it("recognises only UserVolumeAccumulator account data", () => {
    expect(
      isUserVolumeAccumulatorData(
        Uint8Array.from([...USER_VOLUME_ACCUMULATOR_DISCRIMINATOR, 0, 0, 0]),
      ),
    ).toBe(true);
    expect(isUserVolumeAccumulatorData(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(
      false,
    );
    expect(isUserVolumeAccumulatorData(Uint8Array.from([1, 2, 3]))).toBe(false);
  });
});
