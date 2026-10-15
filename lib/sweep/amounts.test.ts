import { describe, expect, it } from "vitest";
import {
  mintsWithoutRentReclaim,
  percentOfBalance,
  rawToDecimalString,
  resolveAmount,
} from "@/lib/sweep/amounts";
import { toBaseAmount } from "@/lib/utils/sanitize";

/**
 * "How much" and "can we close the account" are the same question.
 *
 * Closing a token account is only legal once it is empty, so a partial swap must
 * not carry a `closeAccount` — and because the packer batches many swaps into one
 * transaction, one bad close fails the whole sweep. `emptiesAccount` is that
 * answer, and the tests below are mostly about it being right at the edges: the
 * whole balance, an explicit equal amount, and one base unit short.
 */

const BALANCE = "1000000"; // 1.0 at 6 decimals

describe("resolveAmount", () => {
  it("takes the whole balance when nothing was chosen", () => {
    // The pre-existing behaviour, and it has to stay the default: a sweep with
    // no per-token amounts must behave exactly as it did before they existed.
    expect(resolveAmount(BALANCE)).toEqual({
      ok: true,
      raw: BALANCE,
      emptiesAccount: true,
      fraction: 1,
    });
  });

  it("empties the account when the chosen amount equals the balance", () => {
    // Chosen explicitly, not by omission — the rent reclaim must still happen.
    const resolved = resolveAmount(BALANCE, "1000000");
    expect(resolved.ok && resolved.emptiesAccount).toBe(true);
    expect(resolved.ok && resolved.fraction).toBe(1);
  });

  it("does not empty the account when the amount is short by one base unit", () => {
    // The whole feature in one assertion: 999999 of 1000000 leaves a residue, so
    // there is no rent to reclaim and a close would fail the transaction.
    const resolved = resolveAmount(BALANCE, "999999");
    expect(resolved.ok && resolved.emptiesAccount).toBe(false);
    expect(resolved.ok && resolved.raw).toBe("999999");
  });

  it("reports the fraction for scaling a USD figure", () => {
    expect(resolveAmount(BALANCE, "500000")).toMatchObject({ fraction: 0.5 });
    expect(resolveAmount(BALANCE, "250000")).toMatchObject({ fraction: 0.25 });
  });

  it("refuses an amount above the balance instead of clamping it", () => {
    // Clamping would quietly swap everything when the user asked for something
    // that cannot exist. The app refuses rather than reinterpret.
    expect(resolveAmount(BALANCE, "1000001")).toEqual({
      ok: false,
      problem: "exceeds-balance",
    });
  });

  it("refuses zero and nonsense amounts", () => {
    expect(resolveAmount(BALANCE, "0")).toEqual({ ok: false, problem: "zero" });
    expect(resolveAmount(BALANCE, "-5")).toEqual({
      ok: false,
      problem: "not-a-number",
    });
    expect(resolveAmount(BALANCE, "1e18")).toEqual({
      ok: false,
      problem: "not-a-number",
    });
    expect(resolveAmount(BALANCE, "not a number")).toEqual({
      ok: false,
      problem: "not-a-number",
    });
  });

  it("refuses a zero balance, because there is nothing to swap", () => {
    expect(resolveAmount("0")).toEqual({ ok: false, problem: "zero" });
  });

  it("handles a balance past Number.MAX_SAFE_INTEGER without rounding it", () => {
    // A u64 balance. Through a float, 9007199254740993 would come back as
    // 9007199254740992 — one base unit short, which is a residue.
    const huge = "9007199254740993";
    const resolved = resolveAmount(huge, huge);
    expect(resolved.ok && resolved.raw).toBe(huge);
    expect(resolved.ok && resolved.emptiesAccount).toBe(true);
  });
});

describe("percentOfBalance", () => {
  it("returns the exact balance for 100%, never 99.99% of it", () => {
    // A float route to 100% can land one base unit short, and one base unit
    // short is the difference between a reclaimable account and a stuck one.
    expect(percentOfBalance("999999", 100)).toBe("999999");
    expect(percentOfBalance("1000001", 100)).toBe("1000001");
  });

  it("floors, so it never asks to swap more than was selected", () => {
    // 50% of an odd balance is not representable; rounding up would request
    // more than the user chose, which is the direction that fails on chain.
    expect(percentOfBalance("999999", 50)).toBe("499999");
    expect(percentOfBalance("7", 25)).toBe("1");
  });

  it("is zero for a zero or nonsense percentage", () => {
    expect(percentOfBalance(BALANCE, 0)).toBe("0");
    expect(percentOfBalance(BALANCE, -10)).toBe("0");
    expect(percentOfBalance(BALANCE, Number.NaN)).toBe("0");
    expect(percentOfBalance("0", 50)).toBe("0");
  });
});

describe("mintsWithoutRentReclaim", () => {
  const token = (overrides = {}) => ({
    mint: "So11111111111111111111111111111111111111112",
    rawAmount: "1000000",
    hasTransferFee: false,
    ...overrides,
  });

  it("closes an account a full swap empties", () => {
    expect(mintsWithoutRentReclaim([token()], new Map()).size).toBe(0);
  });

  it("closes it when the chosen amount is explicitly the whole balance", () => {
    // The user picking "100%" must still get the rent back.
    const amounts = new Map([["So11111111111111111111111111111111111111112", "1000000"]]);
    expect(mintsWithoutRentReclaim([token()], amounts).size).toBe(0);
  });

  it("skips the close for a partial amount", () => {
    // The whole reason the rule exists: the account still holds a balance, so
    // `closeAccount` would fail and take the entire packed transaction with it.
    const amounts = new Map([["So11111111111111111111111111111111111111112", "999999"]]);
    expect(
      mintsWithoutRentReclaim([token()], amounts).has(
        "So11111111111111111111111111111111111111112",
      ),
    ).toBe(true);
  });

  it("still skips a transfer-fee mint, which predates partial amounts", () => {
    expect(
      mintsWithoutRentReclaim([token({ hasTransferFee: true })], new Map()).has(
        "So11111111111111111111111111111111111111112",
      ),
    ).toBe(true);
  });

  it("treats an amount it cannot resolve as unsafe to close", () => {
    // Conservative on purpose: if the resolver will not vouch for the amount,
    // the swap is not going to empty the account, so the close must not run.
    const amounts = new Map([["So11111111111111111111111111111111111111112", "2000000"]]);
    expect(
      mintsWithoutRentReclaim([token()], amounts).has(
        "So11111111111111111111111111111111111111112",
      ),
    ).toBe(true);
  });
});
describe("rawToDecimalString", () => {
  it("round-trips through the parser the amount field uses", () => {
    // The property that matters: text put into the input must parse back to the
    // same base amount, or editing a partial amount would drift it.
    for (const raw of ["1000000", "1", "999999", "123456789"]) {
      const text = rawToDecimalString(raw, 6);
      expect(toBaseAmount(text, 6)?.toString()).toBe(raw);
    }
  });

  it("drops trailing zeros and never renders a bare decimal point", () => {
    expect(rawToDecimalString("1500000", 6)).toBe("1.5");
    expect(rawToDecimalString("2000000", 6)).toBe("2");
    expect(rawToDecimalString("0", 6)).toBe("0");
  });

  it("treats a zero-decimals mint as whole units", () => {
    expect(rawToDecimalString("42", 0)).toBe("42");
  });
});
