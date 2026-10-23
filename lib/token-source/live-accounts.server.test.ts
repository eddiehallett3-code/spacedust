import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { reconcileDustTokenAccounts } from "./live-accounts.server";
import type { DustToken } from "@/types/token";

const ACCOUNT_A = "11111111111111111111111111111111";
const ACCOUNT_B = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ACCOUNT_C = "So11111111111111111111111111111111111111112";

function token(tokenAccount: string | null, overrides: Partial<DustToken> = {}): DustToken {
  return {
    mint: `mint-${tokenAccount ?? "none"}`,
    name: "Token",
    symbol: "TKN",
    logoUri: null,
    rawAmount: "1000",
    balance: 1000,
    decimals: 6,
    priceUsd: 1,
    priceChange24h: null,
    valueUsd: 1,
    program: "legacy",
    tokenAccount,
    hasNoPrice: false,
    hasTransferHook: false,
    hasTransferFee: false,
    frozen: false,
    poolLike: false,
    staked: null,
    ...overrides,
  };
}

function parsed(state: string) {
  return {
    data: {
      program: "spl-token",
      space: 165,
      parsed: { type: "account", info: { state } },
    },
  };
}

describe("reconcileDustTokenAccounts", () => {
  const getMultipleParsedAccounts = vi.fn();

  beforeEach(() => {
    getMultipleParsedAccounts.mockReset();
  });

  it("drops a token whose account is closed and marks a frozen one", async () => {
    getMultipleParsedAccounts.mockResolvedValue({
      context: { slot: 1 },
      value: [parsed("initialized"), parsed("frozen"), null],
    });

    const a = token(ACCOUNT_A);
    const b = token(ACCOUNT_B);
    const closed = token(ACCOUNT_C);
    const unknown = token(null);

    const result = await reconcileDustTokenAccounts(
      { getMultipleParsedAccounts } as never,
      [a, b, closed, unknown],
    );

    expect(result).toHaveLength(3);
    expect(result.map((item) => item.tokenAccount)).toEqual([
      ACCOUNT_A,
      ACCOUNT_B,
      null,
    ]);
    expect(result.find((item) => item.tokenAccount === ACCOUNT_B)?.frozen).toBe(
      true,
    );
    expect(result.some((item) => item.tokenAccount === ACCOUNT_C)).toBe(false);
  });

  it("changes nothing when the account check itself fails", async () => {
    getMultipleParsedAccounts.mockRejectedValue(new Error("rpc down"));
    const tokens = [token(ACCOUNT_A), token(ACCOUNT_C)];

    const result = await reconcileDustTokenAccounts(
      { getMultipleParsedAccounts } as never,
      tokens,
    );

    expect(result).toEqual(tokens);
  });
});
