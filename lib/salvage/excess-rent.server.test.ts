import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpcCall = vi.fn();
vi.mock("@/lib/token-source/rpc.server", () => ({
  rpcCall: (...args: unknown[]) => rpcCall(...args),
}));

import { readExcessRentAccounts } from "./excess-rent.server";

const OWNER = "G4ucVPdGWwbPxJdox4acDpcN8tFXU2VP35Dg9wbEmG95";
const ACCOUNT = "A2xKwTtehdNF9KzkMbEwwj14yBbKqARf2Rbk8o4ezaK";
const MINT = "9n3YAi3WWGUjQCJrNKSa2vxX5FGjWgBHxD38HoGK2zaf";

function tokenAccount(options: {
  pubkey?: string;
  lamports?: number;
  space?: number | null;
  mint?: string;
  owner?: string;
  state?: string;
  isNative?: boolean;
  amount?: string;
}) {
  const space = options.space === undefined ? 174 : options.space;
  return {
    pubkey: options.pubkey ?? ACCOUNT,
    account: {
      lamports: options.lamports ?? 1_912_566,
      owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      space: space ?? undefined,
      data: {
        space: space ?? undefined,
        parsed: {
          info: {
            mint: options.mint ?? MINT,
            owner: options.owner ?? OWNER,
            state: options.state ?? "initialized",
            isNative: options.isNative ?? false,
            tokenAmount: { amount: options.amount ?? "1" },
          },
        },
      },
    },
  };
}

describe("readExcessRentAccounts", () => {
  beforeEach(() => {
    rpcCall.mockReset();
    rpcCall.mockImplementation(async (method: string) => {
      if (method === "getTokenAccountsByOwner") {
        return { value: [] };
      }
      if (method === "getMinimumBalanceForRentExemption") {
        return 1_534_160;
      }
      throw new Error(`unexpected ${method}`);
    });
  });

  it("finds the live wallet's 378,406-lamport excess", async () => {
    rpcCall.mockImplementation(async (method: string) => {
      if (method === "getTokenAccountsByOwner") {
        return { value: [tokenAccount({})] };
      }
      if (method === "getMinimumBalanceForRentExemption") {
        return 1_534_160;
      }
      throw new Error(`unexpected ${method}`);
    });

    const accounts = await readExcessRentAccounts(OWNER);
    expect(accounts).toEqual([
      {
        address: ACCOUNT,
        mint: MINT,
        lamports: 1_912_566,
        rentLamports: 1_534_160,
        excessLamports: 378_406,
        space: 174,
      },
    ]);
  });

  it("skips accounts at rent, native accounts, foreign owners, uninitialized and empty accounts", async () => {
    rpcCall.mockImplementation(async (method: string) => {
      if (method === "getTokenAccountsByOwner") {
        return {
          value: [
            tokenAccount({ pubkey: ACCOUNT, lamports: 1_534_160 }),
            tokenAccount({
              pubkey: "Aae1LWrT4cN4anZyTvpoguQqpS3RwPeZoJ8vCcDi5tST",
              isNative: true,
              lamports: 9_000_000,
            }),
            tokenAccount({
              pubkey: "5R8np6UDbdrP9JEA6n3YKAD6VL4NJt1vbxjFTdk6buZy",
              owner: "Aae1LWrT4cN4anZyTvpoguQqpS3RwPeZoJ8vCcDi5tST",
            }),
            tokenAccount({
              pubkey: "72K97smKVfVtf1fam4s5w2D2msLTeHwoKsjQn9uqVg17",
              state: "uninitialized",
            }),
            tokenAccount({
              pubkey: "burn68h9dS2tvZwtCFMt79SyaEgvqtcZZWJphizQxgt",
              space: null,
            }),
            tokenAccount({
              pubkey: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
              amount: "0",
            }),
          ],
        };
      }
      if (method === "getMinimumBalanceForRentExemption") {
        return 1_534_160;
      }
      throw new Error(`unexpected ${method}`);
    });

    const accounts = await readExcessRentAccounts(OWNER);
    expect(accounts).toEqual([]);
    expect(
      rpcCall.mock.calls.filter(
        ([method]) => method === "getMinimumBalanceForRentExemption",
      ),
    ).toHaveLength(1);
  });

  it("caches the rent minimum per data size", async () => {
    rpcCall.mockImplementation(async (method: string) => {
      if (method === "getTokenAccountsByOwner") {
        return {
          value: [
            tokenAccount({}),
            tokenAccount({
              pubkey: "Aae1LWrT4cN4anZyTvpoguQqpS3RwPeZoJ8vCcDi5tST",
              mint: "8d3NUb99Ls2jkM7N65NUVmzXEcR7qd619WWoiprtfij9",
              lamports: 1_600_000,
            }),
          ],
        };
      }
      if (method === "getMinimumBalanceForRentExemption") {
        return 1_534_160;
      }
      throw new Error(`unexpected ${method}`);
    });

    const accounts = await readExcessRentAccounts(OWNER);
    expect(accounts).toHaveLength(2);
    expect(
      rpcCall.mock.calls.filter(
        ([method]) => method === "getMinimumBalanceForRentExemption",
      ),
    ).toHaveLength(1);
  });
});
