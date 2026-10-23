import { PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    ).rejects.toThrow(/none of these accounts.*excess rent/i);
  });
});
