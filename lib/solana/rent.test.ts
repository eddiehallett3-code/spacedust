import { describe, expect, it, vi } from "vitest";
import type { Connection } from "@solana/web3.js";
import {
  fetchRentMinimums,
  voidFeeFromRentLamports,
} from "@/lib/solana/rent";
import {
  EMPTY_ACCOUNT_RENT_LAMPORTS,
  HUSK_ACCOUNT_RENT_LAMPORTS,
  TOKEN_ACCOUNT_RENT_LAMPORTS,
} from "@/lib/utils/constants";

/**
 * The rent figures are the app's money path: The Void's fee is a percentage of
 * this number. Getting it wrong once charged 2.06% of reclaimed rent where the
 * UI promised 1.5%, because the fee was computed from a constant that had gone
 * stale instead of from what the chain actually charges.
 */

describe("voidFeeFromRentLamports", () => {
  it("is a rate applied to the rent it is given, not a constant", () => {
    // If this ever starts returning the same fee for different rents, a
    // constant has crept back in — which is exactly the original bug.
    expect(voidFeeFromRentLamports(1_000_000)).toBe(15_000);
    expect(voidFeeFromRentLamports(4_000_000)).toBe(60_000);
    expect(voidFeeFromRentLamports(1_000_000)).not.toBe(
      voidFeeFromRentLamports(2_000_000),
    );
  });

  it("floors, so a user is never charged a lamport over the stated rate", () => {
    // 1.5% of 1,488,441 is 22,326.615 — must not round up.
    expect(voidFeeFromRentLamports(1_488_441)).toBe(22_326);
    expect(voidFeeFromRentLamports(1_488_440)).toBe(22_326);
  });

  it("prices at today's real mainnet rent, not the stale constant", () => {
    // 1,488,440 is what a 165-byte token account actually holds, measured on
    // chain. The code used to assume 2,039,280 and derived 30,589 from it.
    expect(voidFeeFromRentLamports(1_488_440)).toBe(22_326);
    expect(voidFeeFromRentLamports(2_039_280)).not.toBe(22_326);
  });

  it("charges nothing when there is no rent to take it from", () => {
    expect(voidFeeFromRentLamports(0)).toBe(0);
    expect(voidFeeFromRentLamports(-1)).toBe(0);
  });
});

describe("fetchRentMinimums", () => {
  it("returns what the chain reports, husk included", async () => {
    const connection = {
      getMinimumBalanceForRentExemption: vi.fn(async (size: number) =>
        size === 165 ? 1_488_440 : size === 1 ? 655_320 : 650_240,
      ),
    } as unknown as Connection;

    await expect(fetchRentMinimums(connection)).resolves.toEqual({
      tokenAccount: 1_488_440,
      emptyAccount: 650_240,
      // The one-byte husk a burned Core asset is left as. Without it, every
      // Core burn promises ~0.00065 SOL more rent than it returns.
      huskAccount: 655_320,
    });
  });

  it("falls back to the constants instead of failing a burn", async () => {
    const connection = {
      getMinimumBalanceForRentExemption: vi.fn(async () => {
        throw new Error("RPC unreachable");
      }),
    } as unknown as Connection;

    await expect(fetchRentMinimums(connection)).resolves.toEqual({
      tokenAccount: TOKEN_ACCOUNT_RENT_LAMPORTS,
      emptyAccount: EMPTY_ACCOUNT_RENT_LAMPORTS,
      huskAccount: HUSK_ACCOUNT_RENT_LAMPORTS,
    });
  });

  it("treats a zero answer as no answer", async () => {
    const connection = {
      getMinimumBalanceForRentExemption: vi.fn(async () => 0),
    } as unknown as Connection;

    await expect(fetchRentMinimums(connection)).resolves.toEqual({
      tokenAccount: TOKEN_ACCOUNT_RENT_LAMPORTS,
      emptyAccount: EMPTY_ACCOUNT_RENT_LAMPORTS,
      huskAccount: HUSK_ACCOUNT_RENT_LAMPORTS,
    });
  });
});

/**
 * A burned Core asset is not a missing account — it is a one-byte husk, because
 * Core shrinks the account instead of closing it. `isCoreHusk` and the rule that
 * uses it live in `lib/solana/liveness.ts`, with their own tests.
 */
