import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  MAX_TX_SIZE_BYTES,
  TX_SIZE_HEADROOM_BYTES,
} from "@/lib/utils/constants";
import type { PackedTransaction } from "@/types/sweep";

/**
 * Address lookup tables for cNFT burns whose proofs cannot fit inline.
 *
 * A Bubblegum burn spends one account per proof node. A tree created with no
 * canopy sends every level, and at ~33 bytes per node a 20- or 24-level proof
 * passes 1232 bytes on its own. No arrangement of a legacy message fixes that;
 * the proof has to be referenced through a lookup table, where each address is
 * one byte instead of 32.
 *
 * A lookup table is an on-chain account, not a formatting option. It must be
 * created, extended with the proof nodes, and then left for one slot before the
 * runtime will resolve the newly-added addresses. That is why this module emits
 * setup transactions and a separate wait: the burn cannot be built in the same
 * transaction that creates the table it references.
 *
 * This is deliberately a setup-only module. It never signs or sends; the caller
 * asks the wallet for one approval over the whole setup batch, submits the
 * transactions in order, and only then builds the burns.
 */

/** One table's address list must fit in the program's 256-address account. */
const LOOKUP_TABLE_MAX_ADDRESSES = 256;

/** The address list starts after the table's V1 metadata. */
export const LOOKUP_TABLE_META_SIZE = 56;

const U64_MAX = BigInt("0xffffffffffffffff");

export interface CnftLookupTable {
  /** Base58 address of the table account. */
  address: string;
  /** The addresses this table is expected to contain, in insertion order. */
  addresses: string[];
  /**
   * A local view of the table, suitable for compiling a v0 message before the
   * table has been fetched back from the chain. The caller must still wait for
   * it to be usable before submitting the burn.
   */
  account: AddressLookupTableAccount;
}

export interface CnftLookupTableSetup {
  tables: CnftLookupTable[];
  /** Create/extend transactions, in the order they must be submitted. */
  packed: PackedTransaction[];
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface BuildCnftLookupTableSetupInput {
  connection: Connection;
  payer: PublicKey;
  /** Proof nodes (hashes) to put in the table(s). Duplicates are removed. */
  addresses: string[];
  /**
   * Test seams. In the app these are read from the connection; tests supply
   * them so the builder can be exercised without a validator.
   */
  recentSlot?: number;
  blockhashInfo?: { blockhash: string; lastValidBlockHeight: number };
}

/**
 * Build the create/extend transactions for one or more lookup tables.
 *
 * Tables are capped at 256 addresses, so a very large selection (or a batch
 * with many distinct proof nodes) produces more than one table. All tables are
 * created first, then extended, because an extend can only target an account
 * that already exists.
 */
export async function buildCnftLookupTableSetup(
  input: BuildCnftLookupTableSetupInput,
): Promise<CnftLookupTableSetup> {
  const { connection, payer } = input;
  const addresses = uniqueValidAddresses(input.addresses);

  if (addresses.length === 0) {
    return {
      tables: [],
      packed: [],
      blockhash: "",
      lastValidBlockHeight: 0,
    };
  }

  const blockhashInfo =
    input.blockhashInfo ?? (await connection.getLatestBlockhash("confirmed"));
  // The *current* slot's hash is not in the SlotHashes sysvar yet, so the
  // lookup-table program rejects it with "X is not a recent slot" even though
  // `getSlot` just returned it. The previous confirmed slot is in the sysvar
  // and still comfortably recent. (Measured on a local validator: slot N failed,
  // N-1 worked.)
  const recentSlot =
    input.recentSlot ??
    Math.max(1, (await connection.getSlot("confirmed")) - 1);
  if (!Number.isInteger(recentSlot) || recentSlot <= 0) {
    throw new Error("Could not read a recent slot for the lookup table.");
  }

  const chunks = chunkAddresses(addresses);
  if (chunks.length > recentSlot) {
    throw new Error("Too many lookup tables for the slots available.");
  }

  const packed: PackedTransaction[] = [];
  const tables: CnftLookupTable[] = [];

  // Create first. A table address is a PDA of (authority, recentSlot), so each
  // table in the batch gets a distinct recent slot. Using older slots is safe:
  // the program only requires that the slot is still in recent slot hashes.
  for (let index = 0; index < chunks.length; index += 1) {
    const tableSlot = recentSlot - index;
    const [createInstruction, tableAddress] =
      AddressLookupTableProgram.createLookupTable({
        authority: payer,
        payer,
        recentSlot: tableSlot,
      });

    appendSetupTransaction(
      packed,
      [createInstruction],
      payer,
      blockhashInfo.blockhash,
      `lookup table ${index + 1} creation`,
    );

    const chunk = chunks[index] as string[];
    const account = new AddressLookupTableAccount({
      key: tableAddress,
      state: {
        deactivationSlot: U64_MAX,
        lastExtendedSlot: tableSlot,
        lastExtendedSlotStartIndex: 0,
        authority: payer,
        addresses: chunk.map((address) => new PublicKey(address)),
      },
    });

    tables.push({ address: tableAddress.toBase58(), addresses: chunk, account });
  }

  // Then extend. One extend instruction can carry as many addresses as the
  // remaining bytes allow; a 256-address table needs several transactions, so
  // the loop measures each candidate rather than assuming a fixed chunk size.
  for (const table of tables) {
    const addressesForTable = table.addresses.map(
      (address) => new PublicKey(address),
    );
    let start = 0;

    while (start < addressesForTable.length) {
      const count = largestFittingExtendCount(
        table.account.key,
        payer,
        blockhashInfo.blockhash,
        addressesForTable,
        start,
      );
      if (count === 0) {
        throw new Error(
          `A lookup table address batch could not fit in ${MAX_TX_SIZE_BYTES} bytes.`,
        );
      }

      const extendInstruction = AddressLookupTableProgram.extendLookupTable({
        lookupTable: table.account.key,
        authority: payer,
        payer,
        addresses: addressesForTable.slice(start, start + count),
      });
      appendSetupTransaction(
        packed,
        [extendInstruction],
        payer,
        blockhashInfo.blockhash,
        `lookup table ${table.address.slice(0, 6)}… extension`,
      );
      start += count;
    }
  }

  return {
    tables,
    packed,
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
  };
}

/**
 * Wait until every table is active and all of its addresses are visible.
 *
 * `lastExtendedSlot` is the load-bearing check. The runtime will only resolve
 * addresses that were extended *before* the current slot, so a table that was
 * just extended is not usable yet even though the account exists. Polling for
 * the next slot is what makes the following burn compile and run.
 */
export async function waitForLookupTables(
  connection: Connection,
  tables: CnftLookupTable[],
  timeoutMs = 20_000,
): Promise<AddressLookupTableAccount[]> {
  if (tables.length === 0) return [];

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const slot = await connection.getSlot("confirmed");
      const accounts = await Promise.all(
        tables.map(async (table) => {
          const response = await connection.getAddressLookupTable(
            new PublicKey(table.address),
          );
          return response.value;
        }),
      );

      const ready = accounts.every((account, index) => {
        const expected = tables[index];
        if (!account || !expected) return false;
        return (
          account.isActive() &&
          account.state.addresses.length >= expected.addresses.length &&
          account.state.lastExtendedSlot < slot
        );
      });

      if (ready) {
        return accounts.filter(
          (account): account is AddressLookupTableAccount => account !== null,
        );
      }
    } catch {
      // A failed read is not evidence that the table is unusable; keep polling
      // until the deadline, then report the limit rather than the RPC error.
    }

    await sleep(500);
  }

  throw new Error(
    "The lookup table did not become usable in time. No cNFT was burned; the table and its rent remain on chain. Run the preview again and retry.",
  );
}

function chunkAddresses(addresses: string[]): string[][] {
  const chunks: string[][] = [];
  for (
    let start = 0;
    start < addresses.length;
    start += LOOKUP_TABLE_MAX_ADDRESSES
  ) {
    chunks.push(addresses.slice(start, start + LOOKUP_TABLE_MAX_ADDRESSES));
  }
  return chunks;
}

function uniqueValidAddresses(addresses: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const address of addresses) {
    let key: PublicKey;
    try {
      key = new PublicKey(address);
    } catch {
      continue;
    }
    const value = key.toBase58();
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Largest prefix of `addresses` starting at `start` that still fits.
 *
 * Binary search is enough because the extended data grows monotonically with
 * the count. One address is always tried, so an impossible single extension is
 * reported as zero instead of silently producing no instruction.
 */
function largestFittingExtendCount(
  lookupTable: PublicKey,
  payer: PublicKey,
  blockhash: string,
  addresses: PublicKey[],
  start: number,
): number {
  let low = 1;
  let high = addresses.length - start;
  let best = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const instruction = AddressLookupTableProgram.extendLookupTable({
      lookupTable,
      authority: payer,
      payer,
      addresses: addresses.slice(start, start + middle),
    });

    if (fits(instruction, payer, blockhash)) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return best;
}

function appendSetupTransaction(
  out: PackedTransaction[],
  instructions: TransactionInstruction[],
  payer: PublicKey,
  blockhash: string,
  label: string,
): void {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const bytes = new VersionedTransaction(message).serialize();

  if (bytes.length > MAX_TX_SIZE_BYTES - TX_SIZE_HEADROOM_BYTES) {
    throw new Error(
      `${label} needs ${bytes.length} bytes, over the ${
        MAX_TX_SIZE_BYTES - TX_SIZE_HEADROOM_BYTES
      }-byte budget.`,
    );
  }

  out.push({
    index: out.length,
    base64: Buffer.from(bytes).toString("base64"),
    mints: [],
    sizeBytes: bytes.length,
    instructionCount: instructions.length,
    includesRentReclaim: false,
    rentReclaimMints: [],
  });
}

/** Measure a candidate without throwing; used by the extension search. */
function fits(
  instruction: TransactionInstruction,
  payer: PublicKey,
  blockhash: string,
): boolean {
  try {
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [instruction],
    }).compileToV0Message();
    return (
      new VersionedTransaction(message).serialize().length <=
      MAX_TX_SIZE_BYTES - TX_SIZE_HEADROOM_BYTES
    );
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

