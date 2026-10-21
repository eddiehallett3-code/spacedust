import { describe, expect, it } from "vitest";
import {
  planWrappedSolUnwraps,
  wrappedSolFeeLamports,
} from "@/lib/salvage/plan-unwrap";
import { feeFromRentLamports } from "@/lib/solana/rent";
import { RECLAIM_FEE_BPS } from "@/lib/utils/constants";
import type { WrappedSolAccount } from "@/types/salvage";

/**
 * Wrapped SOL is principal, not rent.
 *
 * The dangerous mistake in an unwrap is charging the rent fee on the whole
 * lamport balance: the user's own SOL would be taxed as if it were recovered
 * rent. These tests lock the separation, and the refusal rules that keep a
 * foreign close authority from being offered as if it could be closed.
 */

const OWNER = "YNvAM4wiyvkgoExvz2ZH2AdhxaRF8ggi15BVSdvb6uA";
const OTHER = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function account(overrides: Partial<WrappedSolAccount> = {}): WrappedSolAccount {
  return {
    address: "11111111111111111111111111111111",
    amountLamports: 1_000_000_000,
    lamports: 1_002_039_280,
    rentLamports: 2_039_280,
    closeAuthority: null,
    ...overrides,
  };
}

describe("planWrappedSolUnwraps", () => {
  it("counts the wrapped balance and the rent separately", () => {
    const plan = planWrappedSolUnwraps([account()], OWNER);

    expect(plan.closeable).toHaveLength(1);
    expect(plan.wrappedLamports).toBe(1_000_000_000);
    expect(plan.rentLamports).toBe(2_039_280);
  });

  it("never charges the fee on the wrapped principal", () => {
    const wrapped = account();
    const fee = wrappedSolFeeLamports(wrapped);

    expect(fee).toBe(feeFromRentLamports(2_039_280, RECLAIM_FEE_BPS));
    // The fee on a 1 SOL position is lamports, not the 0.015 SOL a fee on the
    // whole balance would have taken. If this ever fails, the principal is being
    // taxed and the panel's "rent only" promise is false.
    expect(fee).toBeLessThan(1_000_000);
  });

  it("refuses a foreign close authority rather than offering an unwrap that fails", () => {
    const plan = planWrappedSolUnwraps(
      [account({ closeAuthority: OTHER })],
      OWNER,
    );

    expect(plan.closeable).toHaveLength(0);
    expect(plan.wrappedLamports).toBe(0);
    expect(plan.rentLamports).toBe(0);
    expect(plan.skipped[0]?.reason).toContain("close authority");
  });

  it("allows a close authority that is the owner", () => {
    const plan = planWrappedSolUnwraps(
      [account({ closeAuthority: OWNER })],
      OWNER,
    );

    expect(plan.closeable).toHaveLength(1);
  });

  it("counts one account once, so no close is built twice", () => {
    const plan = planWrappedSolUnwraps([account(), account()], OWNER);

    expect(plan.closeable).toHaveLength(1);
    expect(plan.wrappedLamports).toBe(1_000_000_000);
    expect(plan.rentLamports).toBe(2_039_280);
  });

  it("refuses a zero balance and an unreadable amount", () => {
    const plan = planWrappedSolUnwraps(
      [
        account({ amountLamports: 0 }),
        account({ address: OTHER, lamports: Number.NaN }),
      ],
      OWNER,
    );

    expect(plan.closeable).toHaveLength(0);
    expect(plan.skipped).toHaveLength(2);
    for (const entry of plan.skipped) {
      expect(entry.reason).toBeTruthy();
    }
  });
});
