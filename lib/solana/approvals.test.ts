import { describe, expect, it } from "vitest";
import {
  approvalFromParsedAccount,
  isUnlimitedApproval,
  revocableApprovals,
  revokeSelectionKey,
  type TokenApproval,
} from "@/lib/solana/approvals";

/**
 * An approval is a standing permission, so the two mistakes that matter are
 * opposite in direction and both bad:
 *
 *  - Reporting one that is not there. A false alarm in a security list sends
 *    people to revoke things that were never granting anyone anything.
 *  - Missing one that is. An all-clear that is wrong is worse than no report.
 *
 * These tests are therefore mostly about the boundary: what counts as a
 * delegate, what counts as unlimited, and what to do with data we cannot parse.
 */

const U64_MAX = "18446744073709551615";

/** The jsonParsed shape the RPC returns, with only the fields we read. */
function parsed(info: Record<string, unknown>) {
  return { program: "spl-token", space: 165, parsed: { type: "account", info } };
}

function accountInfo(overrides: Record<string, unknown> = {}) {
  return {
    mint: "So11111111111111111111111111111111111111112",
    owner: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    state: "initialized",
    delegate: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
    delegatedAmount: { amount: U64_MAX, decimals: 6 },
    tokenAmount: { amount: "4200000", decimals: 6 },
    ...overrides,
  };
}

const TOKEN_ACCOUNT = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

describe("isUnlimitedApproval", () => {
  it("treats u64::MAX as unlimited", () => {
    expect(isUnlimitedApproval(U64_MAX)).toBe(true);
  });

  it("treats a bounded allowance as bounded", () => {
    expect(isUnlimitedApproval("1000000")).toBe(false);
    // One below the maximum is still bounded, and saying otherwise would be a
    // false alarm on the single row where precision matters most.
    expect(isUnlimitedApproval("18446744073709551614")).toBe(false);
    expect(isUnlimitedApproval("0")).toBe(false);
  });

  it("refuses to call unparseable data unlimited", () => {
    // "I do not know" must not read as "unlimited": that is the alarm.
    expect(isUnlimitedApproval("")).toBe(false);
    expect(isUnlimitedApproval("nonsense")).toBe(false);
    expect(isUnlimitedApproval("1.5")).toBe(false);
  });
});

describe("approvalFromParsedAccount", () => {
  it("reports a standing delegate with everything needed to revoke it", () => {
    const approval = approvalFromParsedAccount(
      TOKEN_ACCOUNT,
      parsed(accountInfo()),
      "legacy",
    );

    expect(approval).not.toBeNull();
    expect(approval?.tokenAccount).toBe(TOKEN_ACCOUNT);
    expect(approval?.delegate).toBe("5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1");
    expect(approval?.mint).toBe("So11111111111111111111111111111111111111112");
    expect(approval?.unlimited).toBe(true);
    // The authority is the wallet, the delegate is someone else.
    expect(approval?.balance).toBeCloseTo(4.2, 10);
    expect(approval?.decimals).toBe(6);
    // The program travels with the row: the revoke has to name the same one.
    expect(approval?.program).toBe("legacy");
  });

  it("carries a bounded allowance through as bounded", () => {
    const approval = approvalFromParsedAccount(
      TOKEN_ACCOUNT,
      parsed(accountInfo({ delegatedAmount: { amount: "1" } })),
      "token2022",
    );

    expect(approval?.unlimited).toBe(false);
    expect(approval?.program).toBe("token2022");
  });

  it("returns nothing when there is no delegate", () => {
    // The overwhelmingly common case, and the one that must never be reported.
    const info = accountInfo();
    delete (info as Record<string, unknown>).delegate;

    expect(
      approvalFromParsedAccount(TOKEN_ACCOUNT, parsed(info), "legacy"),
    ).toBeNull();
  });

  it("ignores a delegate that is the account's own owner", () => {
    // Some wallets "approve" themselves. The owner could already move the
    // balance, so there is nothing to revoke and nothing to warn about.
    const approval = approvalFromParsedAccount(
      TOKEN_ACCOUNT,
      parsed(accountInfo({ delegate: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" })),
      "legacy",
    );

    expect(approval).toBeNull();
  });

  it("survives data it cannot parse instead of guessing", () => {
    for (const bad of [null, undefined, {}, "not-an-object", { parsed: null }]) {
      expect(
        approvalFromParsedAccount(TOKEN_ACCOUNT, bad, "legacy"),
      ).toBeNull();
    }
  });

  it("keeps a row whose balance will not parse, with a zero balance", () => {
    // The permission is real whether or not we can read the amount, and this is
    // a row the user may well want revoked.
    const approval = approvalFromParsedAccount(
      TOKEN_ACCOUNT,
      parsed(accountInfo({ tokenAmount: { amount: "not-a-number", decimals: 6 } })),
      "legacy",
    );

    expect(approval).not.toBeNull();
    expect(approval?.balance).toBe(0);
  });

  it("records a frozen account as frozen rather than dropping it", () => {
    // A frozen account still has a delegate, and the delegate is still live for
    // whenever the mint thaws it.
    const approval = approvalFromParsedAccount(
      TOKEN_ACCOUNT,
      parsed(accountInfo({ state: "frozen" })),
      "legacy",
    );

    expect(approval?.frozen).toBe(true);
  });
});

/**
 * The split that keeps an impossible transaction out of the preview.
 *
 * A `Revoke` on a frozen account is rejected by the token program with
 * `Custom: 17`, "Account is frozen" — confirmed by simulating a real revoke
 * against a real mainnet account, not read from a spec. So these rows are kept
 * (the permission *is* live) but never offered for signing.
 */
describe("revocableApprovals", () => {
  function approval(overrides: Partial<TokenApproval> = {}): TokenApproval {
    return {
      tokenAccount: TOKEN_ACCOUNT,
      mint: "So11111111111111111111111111111111111111112",
      delegate: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
      delegatedAmountRaw: "1000",
      delegatedAmount: 0.001,
      unlimited: false,
      balanceRaw: "1000",
      balance: 0.001,
      decimals: 6,
      program: "legacy",
      frozen: false,
      ...overrides,
    };
  }

  it("separates frozen rows from the ones that can be cleared", () => {
    const result = revocableApprovals([
      approval({ tokenAccount: "A" }),
      approval({ tokenAccount: "B", frozen: true }),
      approval({ tokenAccount: "C" }),
    ]);

    expect(result.revocable.map((a) => a.tokenAccount)).toEqual(["A", "C"]);
    expect(result.frozen.map((a) => a.tokenAccount)).toEqual(["B"]);
  });

  it("loses nothing: every approval comes out in one of the two lists", () => {
    // The delegate on a frozen account is real, and hiding it would be a false
    // all-clear on the screen that exists to avoid exactly that.
    const approvals = [
      approval({ tokenAccount: "A" }),
      approval({ tokenAccount: "B", frozen: true }),
    ];
    const { revocable, frozen } = revocableApprovals(approvals);

    expect(revocable.length + frozen.length).toBe(approvals.length);
  });

  it("handles an empty list", () => {
    expect(revocableApprovals([])).toEqual({ revocable: [], frozen: [] });
  });
});

/**
 * The key that lets a revoke preview be discarded when the selection moves.
 *
 * Order-independent (a rescan can return the same accounts differently), and
 * sensitive to every add or remove (preview revokes A and B, untick B, and B was
 * revoked anyway).
 */
describe("revokeSelectionKey", () => {
  const A = "7ZY8izSSAn7VFo5dyVxpf6xwXWemxMGJNbxthQiXVxeK";
  const B = "FUTLE3UD1rjyJo4mYxtgJCSiK1AE4umsGuenMFayqNMY";

  it("is stable when the same accounts come back in another order", () => {
    expect(revokeSelectionKey([B, A])).toBe(revokeSelectionKey([A, B]));
  });

  it("changes when a row is added or removed", () => {
    expect(revokeSelectionKey([A])).not.toBe(revokeSelectionKey([A, B]));
  });

  it("distinguishes the empty selection", () => {
    expect(revokeSelectionKey([])).toBe("");
    expect(revokeSelectionKey([A])).not.toBe("");
  });
});
