import {
  AccountMeta,
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  COMPUTE_BUDGET_PROGRAM_ID,
  COMPUTE_UNIT_LIMIT,
  LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
  MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@/lib/utils/constants";
import { base64ToBytes, isBase64 } from "@/lib/utils/base64";
import { assertValidMint, isValidSolanaAddress } from "@/lib/utils/sanitize";
import type { ApiInstruction } from "@/types/jupiter";

/**
 * Translation layer between Jupiter's JSON instructions and web3.js.
 *
 * This is a trust boundary. Jupiter's response is JSON over the network, and an
 * instruction carries an arbitrary `programId`, account list and opaque `data`.
 * Anything not validated here becomes an on-chain instruction the user is asked
 * to sign, so every field is checked before it can reach a transaction.
 */

/** Convert a Jupiter instruction into a validated web3.js instruction. */
export function apiToInstruction(api: ApiInstruction): TransactionInstruction {
  if (!api || typeof api !== "object") {
    throw new Error("Malformed instruction from Jupiter");
  }
  if (!isValidSolanaAddress(api.programId)) {
    throw new Error("Invalid program id in Jupiter instruction");
  }
  const programId = new PublicKey(api.programId);

  if (!Array.isArray(api.accounts) || api.accounts.length > 64) {
    throw new Error("Invalid accounts array in Jupiter instruction");
  }
  const keys: AccountMeta[] = api.accounts.map((account) => {
    if (!account || !isValidSolanaAddress(account.pubkey)) {
      throw new Error("Invalid account address in Jupiter instruction");
    }
    return {
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner === true,
      isWritable: account.isWritable === true,
    };
  });

  if (typeof api.data !== "string" || !isBase64(api.data)) {
    throw new Error("Invalid instruction data from Jupiter");
  }

  return new TransactionInstruction({
    keys,
    programId,
    data: Buffer.from(base64ToBytes(api.data)),
  });
}

/** Convert a batch. Throws on the first invalid entry — we never partially trust. */
export function apiToInstructions(
  apiList: ApiInstruction[] | undefined | null,
): TransactionInstruction[] {
  if (!Array.isArray(apiList)) return [];
  return apiList.map(apiToInstruction);
}

/**
 * Compute budget instructions.
 *
 * We discard Jupiter's per-swap compute budget and set one budget for the whole
 * packed transaction. Compute units are billed per unit, so a single shared
 * budget costs less than N per-swap budgets, and it guarantees the last swap in
 * the batch cannot be starved by the ones before it.
 *
 * All three declarations are emitted together, because a transaction that states
 * its compute limit but not the account data it may load is only half-described:
 * a wallet simulating it knows how much work to expect but not how much state to
 * read, and that is exactly the gap Phantom's simulation warning talks about.
 */
export function createComputeBudgetInstructions(
  computeUnitLimit: number = COMPUTE_UNIT_LIMIT,
  microLamportsPerUnit: number = 0,
  loadedAccountsDataSizeLimit: number = LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
): TransactionInstruction[] {
  const programId = new PublicKey(COMPUTE_BUDGET_PROGRAM_ID);
  const instructions: TransactionInstruction[] = [];

  // SetComputeUnitLimit (discriminator 0x02, u32 LE).
  const limit = Buffer.alloc(5);
  limit.writeUInt8(0x02, 0);
  limit.writeUInt32LE(computeUnitLimit, 1);
  instructions.push(
    new TransactionInstruction({ programId, keys: [], data: limit }),
  );

  // SetComputeUnitPrice (discriminator 0x03, u64 LE). Omitted at 0 to save bytes.
  if (microLamportsPerUnit > 0) {
    const price = Buffer.alloc(9);
    price.writeUInt8(0x03, 0);
    price.writeBigUInt64LE(BigInt(Math.floor(microLamportsPerUnit)), 1);
    instructions.push(
      new TransactionInstruction({ programId, keys: [], data: price }),
    );
  }

  // SetLoadedAccountsDataSizeLimit (discriminator 0x04, u32 LE).
  //
  // Last, so the compute limit keeps its position: the audit and the fee
  // estimate both read the prologue in order, and moving 0x02 would make an
  // unrelated change look like a changed budget.
  const loaded = Buffer.alloc(5);
  loaded.writeUInt8(0x04, 0);
  loaded.writeUInt32LE(saneLoadedDataLimit(loadedAccountsDataSizeLimit), 1);
  instructions.push(
    new TransactionInstruction({ programId, keys: [], data: loaded }),
  );

  return instructions;
}

/**
 * A loaded-data limit the runtime will accept.
 *
 * Zero is rejected on chain (`InvalidLoadedAccountsDataSizeLimit`) and anything
 * above the runtime's maximum is clamped, so a caller that passes nonsense gets
 * the app's own declared limit rather than a transaction that cannot land.
 */
function saneLoadedDataLimit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return LOADED_ACCOUNTS_DATA_SIZE_LIMIT;
  }
  return Math.min(Math.trunc(value), MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES);
}

/** Map our token-program discriminator onto the on-chain program id. */
export function tokenProgramFor(kind: "legacy" | "token2022"): PublicKey {
  return new PublicKey(
    kind === "token2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
  );
}

/**
 * Build `closeAccount` for an emptied token account.
 *
 * This is the rent-reclaim step: a token account holds a rent-exempt deposit —
 * about 0.002 SOL, read from the account when we price it rather than assumed —
 * that comes back to the owner only when the account is closed. A dust sweep is
 * worth meaningfully more once those accounts are closed.
 *
 * The `tokenProgram` must match the mint's own program — a Token-2022 account
 * cannot be closed by the legacy Token program.
 */
export function createCloseAccountInstruction(
  account: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey,
): TransactionInstruction {
  // CloseAccount is instruction index 9 on both Token and Token-2022.
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      // Rent is refunded here — back to the user, never to us.
      { pubkey: owner, isSigner: false, isWritable: true },
      // Authority must be marked as a signer: the token program checks the
      // `is_signer` flag on this account, and the owner (fee payer) signs.
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([9]),
  });
}

/**
 * The ATA a user holds for a given mint.
 *
 * `allowOwnerOffCurve` is always true. `tokenProgram` must be the mint's own
 * program: a Token-2022 mint derives a *different* ATA (the token program id
 * is part of the derivation seeds), so omitting it would close the wrong
 * address.
 */
export function getOwnerAta(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram?: PublicKey,
): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
}

// ── Message assembly helpers ────────────────────────────────────────────────

/**
 * Compile instructions into a v0 message, or return null when it cannot fit.
 *
 * `compileToV0Message` throws when the message exceeds 1232 bytes or when an
 * account cannot be resolved. Both cases mean exactly one thing to the packer:
 * this batch does not fit, start a new transaction.
 */
export function compileToV0MessageOrNull(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  blockhash: string,
  lookupTables: AddressLookupTableAccount[],
): VersionedMessage | null {
  try {
    return new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(lookupTables);
  } catch {
    return null;
  }
}

/**
 * Serialise an *unsigned* transaction so we can measure its exact size.
 *
 * The 1232-byte cap applies to the whole signed packet, so size must be
 * measured with the signature slots present — measuring the message alone
 * under-reports by 64 bytes per required signer.
 */
export function serializeForSizeCheck(
  message: VersionedMessage,
): { base64: string; sizeBytes: number } | null {
  try {
    const bytes = new VersionedTransaction(message).serialize();
    return {
      base64: Buffer.from(bytes).toString("base64"),
      sizeBytes: bytes.length,
    };
  } catch {
    return null;
  }
}

/** Re-validate a mint that crossed the network before building anything from it. */
export function assertSweepableMint(mint: string): string {
  return assertValidMint(mint);
}

export { AddressLookupTableAccount, VersionedMessage, VersionedTransaction };