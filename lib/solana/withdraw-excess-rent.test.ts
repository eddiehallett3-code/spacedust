import { PublicKey, Keypair, VersionedTransaction, type Connection } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_PROGRAM_ID } from "@/lib/utils/constants";
import { base64ToBytes } from "@/lib/utils/base64";
import { SPONSOR_MARGIN_LAMPORTS } from "@/lib/sponsor/policy";

const mocks = vi.hoisted(() => ({
  fetchRentMinimums: vi.fn(),
  simulateAll: vi.fn(),
}));

vi.mock("@/lib/solana/rent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/solana/rent")>();
  return { ...actual, fetchRentMinimums: mocks.fetchRentMinimums };
});
vi.mock("@/lib/solana/simulate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/solana/simulate")>();
  return { ...actual, simulateAll: mocks.simulateAll };
});
vi.mock("@/lib/config/public-env", () => ({
  getPublicFeeWallet: () => null,
}));

import { planExcessRentTx } from "./withdraw-excess-rent";
import { TOKEN_2022_PROGRAM_ID } from "@/lib/salvage/excess-rent";

const OWNER = "G4ucVPdGWwbPxJdox4acDpcN8tFXU2VP35Dg9wbEmG95";
const ACCOUNT = "A2xKwTtehdNF9KzkMbEwwj14yBbKqARf2Rbk8o4ezaK";
const MINT = "9n3YAi3WWGUjQCJrNKSa2vxX5FGjWgBHxD38HoGK2zaf";

function fakeConnection(lamports = 1_912_566): Connection {
  return {
    getParsedTokenAccountsByOwner: vi.fn(async () => ({
      context: { slot: 1 },
      value: [
        {
          pubkey: new PublicKey(ACCOUNT),
          account: {
            lamports,
            owner: new PublicKey(TOKEN_2022_PROGRAM_ID),
            executable: false,
            rentEpoch: 0,
            data: {
              program: "spl-token-2022",
              space: 174,
              parsed: {
                type: "account",
                info: {
                  mint: MINT,
                  owner: OWNER,
                  state: "initialized",
                  isNative: false,
                  tokenAmount: { amount: "1" },
                },
              },
            },
          },
        },
      ],
    })),
    getMinimumBalanceForRentExemption: vi.fn(async () => 1_534_160),
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 999,
    })),
  } as unknown as Connection;
}

const selected = {
  address: ACCOUNT,
  mint: MINT,
  lamports: 1_912_566,
  rentLamports: 1_534_160,
  excessLamports: 378_406,
  space: 174,
};

describe("planExcessRentTx", () => {
  beforeEach(() => {
    mocks.fetchRentMinimums.mockReset();
    mocks.simulateAll.mockReset();
    mocks.fetchRentMinimums.mockResolvedValue({
      tokenAccount: 2_039_280,
      emptyAccount: 890_880,
    });
    mocks.simulateAll.mockResolvedValue([
      {
        index: 0,
        ok: true,
        unitsConsumed: 5_000,
        error: null,
        feeLamports: 5_000,
        dryRun: false,
      },
    ]);
  });

  it("re-reads the account, plans one withdraw and charges no fee without a wallet", async () => {
    const connection = fakeConnection();
    const result = await planExcessRentTx({
      connection,
      owner: new PublicKey(OWNER),
      accounts: [selected],
    });

    expect(result.excessLamports).toBe(378_406);
    expect(result.reclaimFeeLamports).toBe(0);
    expect(result.netRentLamports).toBe(378_406);
    expect(result.accountCount).toBe(1);
    expect(result.packed).toHaveLength(1);
    expect(result.packed[0]?.mints).toEqual([ACCOUNT]);
    expect(result.packed[0]?.includesRentReclaim).toBe(false);

    const transaction = VersionedTransaction.deserialize(
      Buffer.from(result.packed[0]!.base64, "base64"),
    );
    const withdraw = transaction.message.compiledInstructions.find(
      (instruction) =>
        transaction.message.staticAccountKeys[
          instruction.programIdIndex
        ]?.toBase58() === TOKEN_2022_PROGRAM_ID,
    );

    expect(withdraw).toBeDefined();
    expect([...(withdraw!.data ?? [])]).toEqual([38]);
    expect(
      withdraw!.accountKeyIndexes.map((index) =>
        transaction.message.staticAccountKeys[index]?.toBase58(),
      ),
    ).toEqual([ACCOUNT, OWNER, OWNER]);
  });

  it("refuses when the account is already back at rent", async () => {
    const connection = fakeConnection(1_534_160);
    await expect(
      planExcessRentTx({
        connection,
        owner: new PublicKey(OWNER),
        accounts: [selected],
      }),
    ).rejects.toThrow(/none of these accounts.*surplus rent/i);
  });
});

/**
 * The fee sponsor, end to end through a real planner.
 *
 * The policy tests prove the server refuses the wrong things; this proves the
 * plans it is asked about are the right shape — the sponsor is the fee payer, the
 * last instruction of the transaction is a repayment from the wallet to it, and
 * the repayment and the two-signature fee agree with each other.
 */
describe("planExcessRentTx — with a fee sponsor", () => {
  const SPONSOR = Keypair.generate().publicKey.toBase58();

  beforeEach(() => {
    mocks.fetchRentMinimums.mockReset();
    mocks.simulateAll.mockReset();
    mocks.fetchRentMinimums.mockResolvedValue({
      tokenAccount: 2_039_280,
      emptyAccount: 890_880,
    });
    mocks.simulateAll.mockResolvedValue([
      {
        index: 0,
        ok: true,
        unitsConsumed: 5_000,
        error: null,
        feeLamports: 10_050,
        dryRun: false,
      },
    ]);
  });

  it("makes the sponsor the fee payer and repays it at the end of the transaction", async () => {
    const result = await planExcessRentTx({
      connection: fakeConnection(),
      owner: new PublicKey(OWNER),
      accounts: [selected],
      feeSponsor: SPONSOR,
    });

    expect(result.sponsor?.address).toBe(SPONSOR);

    const transaction = VersionedTransaction.deserialize(
      base64ToBytes(result.packed[0]!.base64),
    );
    const message = transaction.message;
    if (!("compiledInstructions" in message)) throw new Error("not a v0 message");

    // The fee payer is the sponsor, so the sponsor pays the network fee.
    expect(message.staticAccountKeys[0]!.toBase58()).toBe(SPONSOR);

    // The repayment is last, so every close has already credited the wallet.
    const last = message.compiledInstructions.at(-1)!;
    expect(message.staticAccountKeys[last.programIdIndex]!.toBase58()).toBe(
      SYSTEM_PROGRAM_ID,
    );

    const data = last.data as Uint8Array;
    expect(data[0]).toBe(2); // SystemInstruction.Transfer
    const repaid = Number(
      new DataView(data.buffer, data.byteOffset + 4, 8).getBigUint64(0, true),
    );
    expect(repaid).toBe(result.sponsor!.repaymentLamports);

    expect(
      message.staticAccountKeys[last.accountKeyIndexes[0]!]!.toBase58(),
    ).toBe(OWNER);
    expect(
      message.staticAccountKeys[last.accountKeyIndexes[1]!]!.toBase58(),
    ).toBe(SPONSOR);

    // Two signatures cost twice the base fee, and the margin is on top.
    expect(result.estimatedFeeLamports).toBe(
      result.sponsor!.repaymentLamports - SPONSOR_MARGIN_LAMPORTS,
    );
  });

  it("declines the sponsor when the refund cannot cover the advance", async () => {
    const result = await planExcessRentTx({
      connection: fakeConnection(1_535_000), // 840 lamports of surplus
      owner: new PublicKey(OWNER),
      accounts: [selected],
      feeSponsor: SPONSOR,
    });

    expect(result.sponsor).toBeNull();
    expect(result.warnings.join(" ")).toMatch(/needs SOL in the wallet/i);
  });
});

