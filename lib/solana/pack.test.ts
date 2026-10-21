import { describe, expect, it } from "vitest";
import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { packTransactions, lockedAccountCount } from "@/lib/solana/pack";
import {
  MAX_LOCKED_ACCOUNTS_PER_TX,
  TOKEN_PROGRAM_ID,
} from "@/lib/utils/constants";

const payer = new PublicKey("Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi");
const programId = new PublicKey(TOKEN_PROGRAM_ID);

function key(seed: number): PublicKey {
  return new PublicKey(Buffer.alloc(32, seed));
}

function unit(mint: string, accountCount: number, offset = 0) {
  const keys = Array.from({ length: accountCount }, (_, index) => ({
    pubkey: key(offset + index + 1),
    isSigner: false,
    isWritable: false,
  }));
  return {
    mint,
    rentReclaim: false,
    instructions: [
      new TransactionInstruction({
        programId,
        keys,
        data: Buffer.alloc(0),
      }),
    ],
  };
}

function tableFor(addresses: PublicKey[]): AddressLookupTableAccount {
  return new AddressLookupTableAccount({
    key: key(250),
    state: {
      deactivationSlot: BigInt("0xffffffffffffffff"),
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: payer,
      addresses,
    },
  });
}

describe("packTransactions account locks", () => {
  it("counts instruction accounts, program ids, the payer and tables", () => {
    const instruction = unit("a", 3).instructions[0] as TransactionInstruction;
    expect(lockedAccountCount([instruction], payer, [])).toBe(5);
    expect(
      lockedAccountCount([instruction], payer, [tableFor([key(1)])]),
    ).toBe(6);
  });

  it("splits units that would exceed the 64-account lock budget", () => {
    const first = unit("a", 40, 0);
    const second = unit("b", 40, 100);
    const addresses = [
      ...Array.from({ length: 40 }, (_, index) => key(index + 1)),
      ...Array.from({ length: 40 }, (_, index) => key(index + 101)),
    ];
    const result = packTransactions({
      units: [first, second],
      prologue: [],
      payer,
      blockhash: "11111111111111111111111111111111",
      lookupTables: [tableFor(addresses)],
    });

    expect(result.dropped).toHaveLength(0);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.map((transaction) => transaction.mints)).toEqual([
      ["a"],
      ["b"],
    ]);
  });

  it("does not produce a transaction for a single over-locked unit", () => {
    const addresses = Array.from(
      { length: MAX_LOCKED_ACCOUNTS_PER_TX },
      (_, index) => key(index + 1),
    );
    const result = packTransactions({
      units: [unit("a", MAX_LOCKED_ACCOUNTS_PER_TX)],
      prologue: [],
      payer,
      blockhash: "11111111111111111111111111111111",
      lookupTables: [tableFor(addresses)],
    });

    expect(result.transactions).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
  });
});
