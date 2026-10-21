import type {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  MAX_INSTRUCTIONS_PER_TX,
  MAX_LOCKED_ACCOUNTS_PER_TX,
  MAX_TX_SIZE_BYTES,
  TX_SIZE_HEADROOM_BYTES,
} from "@/lib/utils/constants";
import type { PackedTransaction } from "@/types/sweep";
import { compileToV0MessageOrNull, serializeForSizeCheck } from "./instructions";

/**
 * Transaction packer.
 *
 * Solana's hard limit is 1232 bytes per transaction, and every signature is a
 * click the user has to make. The entire value proposition of this app is: fit
 * as many independent dust swaps as possible into as few transactions as
 * possible.
 *
 * Strategy is greedy first-fit, which is optimal for the common case (most dust
 * swaps cost a similar number of bytes) and can never stall. An exact bin-packing
 * solver would be more code for a difference no user could observe.
 *
 * Size is measured by **actually serialising** the candidate message with real
 * signature slots, because the 1232-byte cap includes signatures and
 * message-only measurement under-reports by 64 bytes per required signer.
 */

/** One token's complete instruction run, already in Jupiter's required order. */
export interface PackUnit {
  mint: string;
  /**
   * Ordered instructions for this swap:
   *   setup → swap → closeAccount (rent reclaim) → cleanup → other
   *
   * `closeAccount` deliberately sits between swap and cleanup: the swap empties
   * the source token account, and cleanup tears down Jupiter's temporary routing
   * accounts. Reclaiming rent has to happen in between, while the account still
   * exists and still holds a zero balance.
   */
  instructions: TransactionInstruction[];
  /** Whether this unit contains a closeAccount instruction. */
  rentReclaim: boolean;
}

export interface PackOptions {
  units: PackUnit[];
  /** Instructions placed at the start of every transaction (compute budget). */
  prologue: TransactionInstruction[];
  payer: PublicKey;
  blockhash: string;
  lookupTables: AddressLookupTableAccount[];
}

export interface PackResult {
  transactions: PackedTransaction[];
  /** Units that could not fit even in an otherwise-empty transaction. */
  dropped: Array<{ mint: string; reason: string }>;
}

/** A candidate transaction: one or more swaps packed together. */
interface Group {
  units: PackUnit[];
}

/**
 * How many distinct accounts a transaction would lock.
 *
 * Lookup tables reduce the *message size*, not the number of accounts the
 * runtime must lock. Proof nodes are still accounts even when their keys are
 * resolved from a table, so this counts the instruction keys themselves rather
 * than only the static message keys.
 */
export function lockedAccountCount(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  lookupTables: AddressLookupTableAccount[],
): number {
  const keys = new Set<string>();
  keys.add(payer.toBase58());

  for (const instruction of instructions) {
    keys.add(instruction.programId.toBase58());
    for (const key of instruction.keys) keys.add(key.pubkey.toBase58());
  }

  // The table account itself is read to resolve the lookups. Counting it is
  // conservative; being one account early is preferable to a failed simulation.
  for (const table of lookupTables) keys.add(table.key.toBase58());

  return keys.size;
}

export function packTransactions(options: PackOptions): PackResult {
  const {
    units,
    prologue,
    payer,
    blockhash,
    lookupTables,
  } = options;

  // Leave headroom so we are never the reason a transaction is rejected for
  // being a byte too large.
  const sizeLimit = MAX_TX_SIZE_BYTES - TX_SIZE_HEADROOM_BYTES;

  const dropped: Array<{ mint: string; reason: string }> = [];
  const groups: Group[] = [];
  let current: Group = { units: [] };

  /**
   * Measure a full instruction list exactly as the network will see it.
   *
   * The compute-budget prologue is prepended at emit time, so it must be part
   * of the measurement. Measuring the body alone under-counts by ~20 bytes and
   * could pack a transaction that fits here but overshoots 1232 bytes on the
   * wire — that used to be masked only by the headroom constant.
   */
  const measure = (body: TransactionInstruction[]): number | null => {
    if (body.length + prologue.length > MAX_INSTRUCTIONS_PER_TX) {
      return null;
    }
    const instructions = [...prologue, ...body];
    if (
      lockedAccountCount(instructions, payer, lookupTables) >
      MAX_LOCKED_ACCOUNTS_PER_TX
    ) {
      return null;
    }
    const message = compileToV0MessageOrNull(
      instructions,
      payer,
      blockhash,
      lookupTables,
    );
    if (!message) return null;
    return serializeForSizeCheck(message)?.sizeBytes ?? null;
  };

  const flatten = (group: Group): TransactionInstruction[] => {
    const out: TransactionInstruction[] = [];
    for (const unit of group.units) out.push(...unit.instructions);
    return out;
  };

  for (const unit of units) {
    const candidateSize = measure([...flatten(current), ...unit.instructions]);

    if (candidateSize !== null && candidateSize <= sizeLimit) {
      current.units.push(unit);
      continue;
    }

    // It does not fit next to the current batch. Close the batch and retry the
    // unit alone — this is what keeps the transaction count minimal.
    if (current.units.length > 0) {
      groups.push(current);
      current = { units: [] };
    }

    const aloneSize = measure(unit.instructions);
    if (aloneSize !== null && aloneSize <= sizeLimit) {
      current.units.push(unit);
    } else {
      dropped.push({
        mint: unit.mint,
        reason:
          aloneSize === null
            ? "Route needs more accounts than a single transaction allows"
            : `Needs ${aloneSize} bytes, over the ${sizeLimit}-byte budget`,
      });
    }
  }

  if (current.units.length > 0) groups.push(current);

  // ── Emit transactions ────────────────────────────────────────────────────
  const transactions: PackedTransaction[] = [];

  const emit = (
    body: TransactionInstruction[],
    mints: string[],
    rentReclaimMints: string[],
  ): boolean => {
    const instructions = [...prologue, ...body];
    if (
      lockedAccountCount(instructions, payer, lookupTables) >
      MAX_LOCKED_ACCOUNTS_PER_TX
    ) {
      return false;
    }
    const message = compileToV0MessageOrNull(
      instructions,
      payer,
      blockhash,
      lookupTables,
    );
    if (!message) return false;
    const serialised = serializeForSizeCheck(message);
    if (!serialised) return false;

    transactions.push({
      index: transactions.length,
      base64: serialised.base64,
      mints: [...mints],
      sizeBytes: serialised.sizeBytes,
      instructionCount: instructions.length,
      includesRentReclaim: rentReclaimMints.length > 0,
      rentReclaimMints: [...rentReclaimMints],
    });
    return true;
  };

  groups.forEach((group) => {
    const rentMints = group.units
      .filter((unit) => unit.rentReclaim)
      .map((unit) => unit.mint);

    if (
      !emit(
        flatten(group),
        group.units.map((unit) => unit.mint),
        rentMints,
      )
    ) {
      for (const unit of group.units) {
        dropped.push({ mint: unit.mint, reason: "Could not be serialised" });
      }
    }
  });

  return { transactions, dropped };
}