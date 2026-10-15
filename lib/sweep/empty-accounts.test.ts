import { describe, expect, it } from "vitest";
import {
  EMPTY_ACCOUNT_SKIP_TEXT,
  planEmptyAccountCloses,
} from "@/lib/sweep/empty-accounts";
import type { EmptyTokenAccount } from "@/types/token";

/**
 * "Closing an empty account is nearly free, and failing one costs the whole
 * transaction."
 *
 * An empty account's rent is a small, certain win — roughly 0.002 SOL — and the
 * closes are packed many-to-a-transaction. That combination is what makes these
 * rules dangerous to get wrong: one account that cannot be closed does not fail
 * by itself, it fails every account it was packed with, and the user pays a fee
 * to move nothing.
 *
 * So the tests are about refusal and attribution: every account that will not
 * close is refused *by reason*, and the ones that are refused never reach the
 * total. The reasons themselves were settled by simulation against mainnet —
 * see the header of `lib/sweep/empty-accounts.ts`.
 */

const OWNER = "YNvAM4wiyvkgoExvz2ZH2AdhxaRF8ggi15BVSdvb6uA";
const OTHER = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function account(overrides: Partial<EmptyTokenAccount> = {}): EmptyTokenAccount {
  return {
    address: "11111111111111111111111111111111",
    mint: "So11111111111111111111111111111111111111112",
    program: "legacy",
    lamports: 2_039_280,
    frozen: false,
    closeAuthority: null,
    withheldFees: 0,
    ...overrides,
  };
}

describe("planEmptyAccountCloses", () => {
  it("closes an ordinary empty account and returns its own lamports", () => {
    const plan = planEmptyAccountCloses([account()], OWNER);

    expect(plan.closeable).toHaveLength(1);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.lamports).toBe(2_039_280);
  });

  it("closes a frozen empty account", () => {
    // The rule that is the opposite of every other flow: the token program
    // will not move, burn or revoke a frozen balance, but it will close one.
    const plan = planEmptyAccountCloses([account({ frozen: true })], OWNER);

    expect(plan.closeable).toHaveLength(1);
    expect(plan.lamports).toBe(2_039_280);
  });

  it("refuses an account with a foreign close authority, by reason", () => {
    const plan = planEmptyAccountCloses(
      [account({ closeAuthority: OTHER })],
      OWNER,
    );

    expect(plan.closeable).toHaveLength(0);
    expect(plan.lamports).toBe(0);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]?.reason).toBe("foreign-close-authority");
  });

  it("allows a close authority that is the owner", () => {
    const plan = planEmptyAccountCloses([account({ closeAuthority: OWNER })], OWNER);

    expect(plan.closeable).toHaveLength(1);
    expect(plan.skipped).toHaveLength(0);
  });

  it("refuses an account holding withheld fees, by reason", () => {
    const plan = planEmptyAccountCloses(
      [account({ withheldFees: 173_279 })],
      OWNER,
    );

    expect(plan.closeable).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe("withheld-fees");
  });

  it("refuses an unreadable amount rather than closing on a guess", () => {
    // `withheldFees: 1` is what the read reports when the extension is present
    // but its amount will not parse. Failing to read zero must not read as zero.
    const plan = planEmptyAccountCloses([account({ withheldFees: 1 })], OWNER);

    expect(plan.closeable).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe("withheld-fees");
  });

  it("counts an account once, so no close is built twice", () => {
    // Two closes of one address in the same transaction: the first succeeds and
    // the second fails the whole packet.
    const plan = planEmptyAccountCloses(
      [account(), account(), account()],
      OWNER,
    );

    expect(plan.closeable).toHaveLength(1);
    expect(plan.lamports).toBe(2_039_280);
  });

  it("refuses an unusable address and an account with nothing in it", () => {
    const plan = planEmptyAccountCloses(
      [
        account({ address: "not-an-address" }),
        account({ address: OTHER, lamports: 0 }),
        account({ address: "So11111111111111111111111111111111111111112", lamports: Number.NaN }),
      ],
      OWNER,
    );

    expect(plan.closeable).toHaveLength(0);
    expect(plan.skipped.map((entry) => entry.reason)).toEqual([
      "invalid-address",
      "nothing-to-reclaim",
      "nothing-to-reclaim",
    ]);
  });

  it("never skips an account without a reason, and explains each one", () => {
    const plan = planEmptyAccountCloses(
      [
        account({ closeAuthority: OTHER }),
        account({ address: OTHER, withheldFees: 5 }),
        account({ address: "broken" }),
      ],
      OWNER,
    );

    expect(plan.skipped).toHaveLength(3);
    for (const entry of plan.skipped) {
      expect(EMPTY_ACCOUNT_SKIP_TEXT[entry.reason]).toBeTruthy();
    }
  });

  it("sums only the accounts it will actually close", () => {
    const plan = planEmptyAccountCloses(
      [
        account(),
        account({ address: OTHER, lamports: 2_074_080 }),
        account({ address: "So11111111111111111111111111111111111111112", withheldFees: 9 }),
      ],
      OWNER,
    );

    expect(plan.closeable).toHaveLength(2);
    // The Token-2022 account keeps its own, larger balance: extensions cost rent.
    expect(plan.lamports).toBe(2_039_280 + 2_074_080);
    expect(plan.skipped).toHaveLength(1);
  });
});
