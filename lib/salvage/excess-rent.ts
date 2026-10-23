import { PublicKey, TransactionInstruction } from "@solana/web3.js";

/**
 * Token-2022 excess rent.
 *
 * A token account can hold more lamports than its rent-exempt minimum — a
 * program credited it, an old deposit is larger than today's rate, or the
 * account was funded by mistake. Token-2022 has an instruction for exactly
 * this: `WithdrawExcessLamports`, which returns everything above the minimum
 * **without** touching the token balance or closing the account.
 *
 * The account order and instruction byte are verified against a real mainnet
 * transaction (`5j4SDENMCwB66…`):
 *
 *   accounts: [token account, destination, owner]
 *   data:     [38]
 *
 * Legacy SPL Token has no equivalent instruction, so this is Token-2022 only.
 * A native (wrapped-SOL) account is excluded by the caller: its lamports are
 * the wrapped balance, not spare rent.
 */

export const TOKEN_2022_PROGRAM_ID =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const TOKEN_2022_PROGRAM = new PublicKey(TOKEN_2022_PROGRAM_ID);

/** SPL Token-2022 instruction discriminant for `WithdrawExcessLamports`. */
export const WITHDRAW_EXCESS_LAMPORTS_INSTRUCTION = 38;

/** How much is above rent, or zero when the account is at/below the minimum. */
export function computeExcessLamports(
  lamports: number,
  rentLamports: number,
): number {
  if (!Number.isFinite(lamports) || !Number.isFinite(rentLamports)) return 0;
  return Math.max(0, Math.trunc(lamports) - Math.trunc(rentLamports));
}

/** Build the Token-2022 withdraw instruction for one token account. */
export function buildWithdrawExcessLamportsInstruction(
  tokenAccount: PublicKey,
  destination: PublicKey,
  authority: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM,
    keys: [
      { pubkey: tokenAccount, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([WITHDRAW_EXCESS_LAMPORTS_INSTRUCTION]),
  });
}
