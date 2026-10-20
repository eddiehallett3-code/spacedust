import { describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import {
  buildCnftLookupTableClose,
  buildCnftLookupTableDeactivation,
  buildCnftLookupTableSetup,
  LOOKUP_TABLE_DEACTIVATION_SLOTS,
  readCnftLookupTableBalances,
  waitForLookupTables,
  waitForLookupTablesClosable,
  type CnftLookupTable,
} from "@/lib/solana/cnft-lookup-table";
import { MAX_TX_SIZE_BYTES, TX_SIZE_HEADROOM_BYTES } from "@/lib/utils/constants";

/**
 * A canopy-0 burn cannot fit its proof inline. These tests pin the two facts
 * that make the rescue work: every setup transaction is under the wire limit,
 * and a freshly-extended table is not considered usable until the next slot.
 */

const PAYER = new PublicKey(bs58.encode(Buffer.alloc(32, 9)));
const RECIPIENT = new PublicKey(bs58.encode(Buffer.alloc(32, 8)));
const TABLE = new PublicKey(bs58.encode(Buffer.alloc(32, 6)));
const BLOCKHASH = bs58.encode(Buffer.alloc(32, 7));
const RECENT_SLOT = 500;

function address(index: number): string {
  const bytes = Buffer.alloc(32, 0);
  bytes.writeUInt32LE(index + 1, 0);
  return bs58.encode(bytes);
}

function fakeConnection(): Connection {
  return {
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: BLOCKHASH,
      lastValidBlockHeight: 99_999,
    })),
    getSlot: vi.fn(async () => RECENT_SLOT),
  } as unknown as Connection;
}

function cleanupTable(
  key: PublicKey = TABLE,
  addresses: string[] = [address(1)],
): CnftLookupTable {
  return {
    address: key.toBase58(),
    addresses,
    account: new AddressLookupTableAccount({
      key,
      state: {
        deactivationSlot: BigInt("0xffffffffffffffff"),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: PAYER,
        addresses: addresses.map((item) => new PublicKey(item)),
      },
    }),
  };
}

function decode(base64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
}

describe("buildCnftLookupTableSetup", () => {
  it("builds a create and an extension for a 24-node proof", async () => {
    const proofs = Array.from({ length: 24 }, (_, index) => address(index));

    const setup = await buildCnftLookupTableSetup({
      connection: fakeConnection(),
      payer: PAYER,
      addresses: proofs,
      recentSlot: RECENT_SLOT,
      blockhashInfo: { blockhash: BLOCKHASH, lastValidBlockHeight: 99_999 },
    });

    expect(setup.tables).toHaveLength(1);
    expect(setup.tables[0]?.addresses).toEqual(proofs);
    // One create transaction, then one extend transaction.
    expect(setup.packed).toHaveLength(2);
    expect(setup.packed.map((item) => item.index)).toEqual([0, 1]);

    for (const item of setup.packed) {
      expect(item.sizeBytes).toBeLessThanOrEqual(
        MAX_TX_SIZE_BYTES - TX_SIZE_HEADROOM_BYTES,
      );
      const transaction = decode(item.base64);
      expect(transaction.message.staticAccountKeys[0]).toEqual(PAYER);
      // Every setup instruction belongs to the lookup-table program.
      expect(
        transaction.message.compiledInstructions.every((ix) => {
          const program = transaction.message.staticAccountKeys[ix.programIdIndex];
          return program?.equals(AddressLookupTableProgram.programId) === true;
        }),
      ).toBe(true);
    }
  });

  it("derives a table from the previous confirmed slot, not the current one", async () => {
    // The current slot's hash is not yet in SlotHashes; the program rejects it
    // with "is not a recent slot". The previous slot is the one that works.
    const connection = fakeConnection();
    vi.mocked(connection.getSlot).mockResolvedValueOnce(500);

    const setup = await buildCnftLookupTableSetup({
      connection,
      payer: PAYER,
      addresses: [address(1)],
      blockhashInfo: { blockhash: BLOCKHASH, lastValidBlockHeight: 99_999 },
    });

    const create = decode(setup.packed[0]!.base64).message.compiledInstructions[0];
    const data = Buffer.from(create!.data);
    // CreateLookupTable: u32 instruction tag, u64 recent slot, u8 bump seed.
    expect(data.readBigUInt64LE(4)).toBe(499n);
  });

  it("removes duplicate proof nodes before spending table space", async () => {
    const setup = await buildCnftLookupTableSetup({
      connection: fakeConnection(),
      payer: PAYER,
      addresses: [address(1), address(1), address(2)],
      recentSlot: RECENT_SLOT,
      blockhashInfo: { blockhash: BLOCKHASH, lastValidBlockHeight: 99_999 },
    });

    expect(setup.tables[0]?.addresses).toEqual([address(1), address(2)]);
  });

  it("splits more than 256 nodes across tables", async () => {
    const proofs = Array.from({ length: 300 }, (_, index) => address(index));

    const setup = await buildCnftLookupTableSetup({
      connection: fakeConnection(),
      payer: PAYER,
      addresses: proofs,
      recentSlot: RECENT_SLOT,
      blockhashInfo: { blockhash: BLOCKHASH, lastValidBlockHeight: 99_999 },
    });

    expect(setup.tables).toHaveLength(2);
    expect(setup.tables[0]?.addresses).toHaveLength(256);
    expect(setup.tables[1]?.addresses).toHaveLength(44);
    expect(setup.packed.length).toBeGreaterThan(4);
  });
});

describe("lookup-table cleanup", () => {
  it("builds a deactivation instruction for each table", async () => {
    const setup = await buildCnftLookupTableDeactivation({
      connection: fakeConnection(),
      authority: PAYER,
      tables: [cleanupTable()],
      blockhashInfo: { blockhash: BLOCKHASH, lastValidBlockHeight: 99_999 },
    });

    expect(setup.packed).toHaveLength(1);
    const transaction = decode(setup.packed[0]!.base64);
    const instruction = transaction.message.compiledInstructions[0]!;
    expect(Buffer.from(instruction.data).readUInt32LE(0)).toBe(3);
    expect(transaction.message.staticAccountKeys[0]).toEqual(PAYER);
    expect(
      transaction.message.staticAccountKeys[instruction.programIdIndex],
    ).toEqual(AddressLookupTableProgram.programId);
  });

  it("builds a close instruction that names the wallet as recipient", async () => {
    const setup = await buildCnftLookupTableClose({
      connection: fakeConnection(),
      authority: PAYER,
      recipient: RECIPIENT,
      tables: [cleanupTable()],
      blockhashInfo: { blockhash: BLOCKHASH, lastValidBlockHeight: 99_999 },
    });

    expect(setup.packed).toHaveLength(1);
    const transaction = decode(setup.packed[0]!.base64);
    const instruction = transaction.message.compiledInstructions[0]!;
    const keys = instruction.accountKeyIndexes.map(
      (index) => transaction.message.staticAccountKeys[index],
    );

    expect(Buffer.from(instruction.data).readUInt32LE(0)).toBe(4);
    expect(keys[0]).toEqual(TABLE);
    expect(keys[1]).toEqual(PAYER);
    expect(keys[2]).toEqual(RECIPIENT);
  });

  it("builds a close when the wallet is also the recipient", async () => {
    const setup = await buildCnftLookupTableClose({
      connection: fakeConnection(),
      authority: PAYER,
      recipient: PAYER,
      tables: [cleanupTable()],
      blockhashInfo: { blockhash: BLOCKHASH, lastValidBlockHeight: 99_999 },
    });

    expect(setup.packed).toHaveLength(1);
    const transaction = decode(setup.packed[0]!.base64);
    expect(transaction.message.staticAccountKeys[0]).toEqual(PAYER);
  });

  it("reads rent balances and skips tables that are already closed", async () => {
    const second = cleanupTable(new PublicKey(address(700)));
    const connection = {
      getAccountInfo: vi.fn(async (key: PublicKey) =>
        key.equals(TABLE) ? { lamports: 12_345 } : null,
      ),
    } as unknown as Connection;

    const balances = await readCnftLookupTableBalances(connection, [
      cleanupTable(),
      second,
    ]);

    expect(balances.get(TABLE.toBase58())).toBe(12_345);
    expect(balances.has(second.address)).toBe(false);
  });
});

describe("waitForLookupTablesClosable", () => {
  function deactivatedTable(
    deactivationSlot: number,
    key: PublicKey = TABLE,
  ): CnftLookupTable {
    const base = cleanupTable(key);
    return {
      ...base,
      account: new AddressLookupTableAccount({
        key,
        state: {
          ...base.account.state,
          deactivationSlot: BigInt(deactivationSlot),
        },
      }),
    };
  }

  it("waits 512 slots after deactivation and reports progress", async () => {
    const expected = deactivatedTable(1_000);
    let slot = 1_000;
    const progress: Array<{ slotsRemaining: number }> = [];

    const connection = {
      getSlot: vi.fn(async () => slot),
      getAddressLookupTable: vi.fn(async () => ({
        value: expected.account,
      })),
    } as unknown as Connection;

    await waitForLookupTablesClosable(connection, [expected], {
      pollMs: 1,
      timeoutMs: 5_000,
      onProgress: (update) => {
        progress.push(update);
        // Jump past the cooldown so the next poll succeeds immediately.
        slot = 1_000 + LOOKUP_TABLE_DEACTIVATION_SLOTS + 1;
      },
    });

    expect(progress[0]?.slotsRemaining).toBe(
      LOOKUP_TABLE_DEACTIVATION_SLOTS + 1,
    );
    expect(progress.length).toBeGreaterThan(1);
  });

  it("returns immediately when the table was already closed", async () => {
    const connection = {
      getSlot: vi.fn(async () => 1_000),
      getAddressLookupTable: vi.fn(async () => ({ value: null })),
    } as unknown as Connection;

    await expect(
      waitForLookupTablesClosable(connection, [cleanupTable()], {
        pollMs: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses to wait on a table that is still active", async () => {
    const connection = {
      getSlot: vi.fn(async () => 1_000),
      getAddressLookupTable: vi.fn(async () => ({
        value: cleanupTable().account,
      })),
    } as unknown as Connection;

    await expect(
      waitForLookupTablesClosable(connection, [cleanupTable()], {
        pollMs: 1,
      }),
    ).rejects.toThrow(/still active/i);
  });
});

describe("waitForLookupTables", () => {
  function table(addresses: string[]): CnftLookupTable {
    const key = new PublicKey(address(900));
    return {
      address: key.toBase58(),
      addresses,
      account: new AddressLookupTableAccount({
        key,
        state: {
          deactivationSlot: BigInt("0xffffffffffffffff"),
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
          authority: PAYER,
          addresses: addresses.map((item) => new PublicKey(item)),
        },
      }),
    };
  }

  it("waits for the slot after the extension before reporting ready", async () => {
    const expected = table([address(1)]);
    let slot = 10;
    let reads = 0;

    const connection = {
      // Advance one slot per poll so the test does not wait 500ms per attempt.
      getSlot: vi.fn(async () => {
        slot += 1;
        return slot;
      }),
      getAddressLookupTable: vi.fn(async () => {
        reads += 1;
        return {
          value: new AddressLookupTableAccount({
            key: expected.account.key,
            state: {
              deactivationSlot: BigInt("0xffffffffffffffff"),
              // The first read reports the extension in the current slot; the
              // second reports the previous slot, when it becomes usable.
              lastExtendedSlot: reads === 1 ? slot : slot - 1,
              lastExtendedSlotStartIndex: 0,
              authority: PAYER,
              addresses: [new PublicKey(address(1))],
            },
          }),
        };
      }),
    } as unknown as Connection;

    const ready = await waitForLookupTables(connection, [expected], 5_000);

    expect(ready).toHaveLength(1);
    expect(ready[0]?.key.toBase58()).toBe(expected.address);
    expect(reads).toBeGreaterThan(1);
  });
});
