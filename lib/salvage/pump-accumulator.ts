import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { PUMP_AMM_PROGRAM_ID } from "@/lib/security/program-ids";

/**
 * Pump.fun user volume accumulator.
 *
 * Pump.fun's AMM keeps one small program account per wallet to track volume for
 * fee tiers. It holds no tokens — only rent — and it is invisible to
 * `getTokenAccountsByOwner` because it is owned by the Pump AMM, not the token
 * program. Sol Incinerator surfaces it as a "Pump accumulator" and closes it
 * with `close_user_volume_accumulator`.
 *
 * Everything below is taken from Pump's published AMM IDL and then checked
 * against a real mainnet close:
 *
 *   IDL: https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/pump_amm.json
 *   live: 5Lpo4pLFyBArKRUEoxQkFGpieugkEHrHgYN2UR99qH6KoJGAJuCdJFeViSz7vWDRYNHb3hGfLKFYVnk1uacMMMfb
 *
 * That transaction closed `J1KxZFZxDRjz1Zg2gZdeQXC6mDsY28R8Wqq4vSrSfimc` for
 * wallet `G4ucVPdGWwbPxJdox4acDpcN8tFXU2VP35Dg9wbEmG95`; the derivation and
 * discriminator tests pin exactly that pair.
 */

/**
 * The program id lives in `program-ids.ts`, with the rest of the ids the
 * instruction audit reasons about, so the builder and the allow-list cannot drift
 * apart. Re-exported here because this module is where the instruction is built.
 */
export { PUMP_AMM_PROGRAM_ID };
export const PUMP_AMM_PROGRAM = new PublicKey(PUMP_AMM_PROGRAM_ID);

export const USER_VOLUME_ACCUMULATOR_SEED = "user_volume_accumulator";
export const EVENT_AUTHORITY_SEED = "__event_authority";

/** Anchor discriminator for `close_user_volume_accumulator`. */
export const CLOSE_USER_VOLUME_ACCUMULATOR_DISCRIMINATOR = Uint8Array.from([
  249, 69, 164, 218, 150, 103, 84, 138,
]);

/** Anchor account discriminator for `UserVolumeAccumulator`. */
export const USER_VOLUME_ACCUMULATOR_DISCRIMINATOR = Uint8Array.from([
  86, 255, 112, 14, 102, 53, 154, 250,
]);

/** The per-wallet accumulator PDA: `["user_volume_accumulator", user]`. */
export function derivePumpAccumulator(owner: PublicKey | string): PublicKey {
  const user = typeof owner === "string" ? new PublicKey(owner) : owner;
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from(USER_VOLUME_ACCUMULATOR_SEED), user.toBuffer()],
    PUMP_AMM_PROGRAM,
  );
  return address;
}

/** The program's event authority PDA: `["__event_authority"]`. */
export function derivePumpEventAuthority(): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from(EVENT_AUTHORITY_SEED)],
    PUMP_AMM_PROGRAM,
  );
  return address;
}

/** True when account data begins with the UserVolumeAccumulator discriminator. */
export function isUserVolumeAccumulatorData(data: Uint8Array): boolean {
  if (data.length < USER_VOLUME_ACCUMULATOR_DISCRIMINATOR.length) return false;
  return USER_VOLUME_ACCUMULATOR_DISCRIMINATOR.every(
    (byte, index) => data[index] === byte,
  );
}

/**
 * Build the direct Pump AMM close instruction.
 *
 * Direct, not through Sol Incinerator's wrapper: the user signs, Pump returns
 * the account's lamports to the owner, and no third-party fee is inserted.
 * The account order and data match the live transaction above exactly.
 */
export function buildClosePumpAccumulatorInstruction(
  owner: PublicKey,
  accumulator?: PublicKey,
): TransactionInstruction {
  const expected = derivePumpAccumulator(owner);
  if (accumulator && !accumulator.equals(expected)) {
    throw new Error(
      "The Pump.fun volume account does not belong to this wallet.",
    );
  }

  return new TransactionInstruction({
    programId: PUMP_AMM_PROGRAM,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: expected, isSigner: false, isWritable: true },
      { pubkey: derivePumpEventAuthority(), isSigner: false, isWritable: false },
      { pubkey: PUMP_AMM_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(CLOSE_USER_VOLUME_ACCUMULATOR_DISCRIMINATOR),
  });
}
