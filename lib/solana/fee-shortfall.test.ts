import { describe, expect, it } from "vitest";
import {
  assessFeeShortfall,
  describeFeeShortfall,
  FeeShortfallError,
  suggestedTopUpLamports,
} from "./fee-shortfall";

/**
 * A wallet that cannot pay the fee is the one failure the user can fix, so the
 * app has to say exactly what is missing.
 *
 * Two things are pinned here, and they pull in opposite directions:
 *
 *  - The quoted amount must be *enough*. Understating it sends someone round a
 *    loop: top up, fail again, top up again.
 *  - The report must never be invented. A balance read that failed, or a wallet
 *    with plenty of SOL and a different problem, must not produce a shortfall —
 *    a diagnostic that blocks a working flow is worse than no diagnostic.
 */

const PAYER = "YNvAM4wiyvkgoExvz2ZH2AdhxaRF8ggi15BVSdvb6uA";
const FIRST_FEE = 5_323;

function input(overrides: Partial<Parameters<typeof assessFeeShortfall>[0]> = {}) {
  return {
    payer: PAYER,
    availableLamports: 0,
    firstFeeLamports: FIRST_FEE,
    totalFeeLamports: FIRST_FEE,
    transactionCount: 1,
    ...overrides,
  };
}

describe("assessFeeShortfall", () => {
  it("says nothing when the balance covers the first transaction", () => {
    expect(assessFeeShortfall(input({ availableLamports: FIRST_FEE }))).toBeNull();
    expect(assessFeeShortfall(input({ availableLamports: FIRST_FEE + 1 }))).toBeNull();
  });

  it("states the shortfall in the lamports the fee was priced in", () => {
    const shortfall = assessFeeShortfall(input({ availableLamports: 1_000 }));

    expect(shortfall?.shortfallLamports).toBe(FIRST_FEE - 1_000);
    expect(shortfall?.firstFeeLamports).toBe(FIRST_FEE);
    expect(shortfall?.payer).toBe(PAYER);
  });

  it("counts an empty wallet as a shortfall rather than zero", () => {
    const shortfall = assessFeeShortfall(
      input({ availableLamports: 0, firstFeeLamports: 5_000 }),
    );

    expect(shortfall?.shortfallLamports).toBe(5_000);
    expect(shortfall?.suggestedLamports).toBeGreaterThan(5_000);
  });

  it("ignores a plan with no fee at all", () => {
    expect(
      assessFeeShortfall(input({ firstFeeLamports: 0, totalFeeLamports: 0 })),
    ).toBeNull();
  });
});

describe("suggestedTopUpLamports", () => {
  it("never quotes less than one sendable step", () => {
    // 0.001 SOL: an amount that can be typed, or withdrawn from an exchange.
    expect(suggestedTopUpLamports(1)).toBe(1_000_000);
    expect(suggestedTopUpLamports(0)).toBe(1_000_000);
  });

  it("rounds up past a step when the shortfall needs it", () => {
    expect(suggestedTopUpLamports(2_000_000)).toBe(3_000_000);
  });

  it("always covers the shortfall it was given", () => {
    for (const lamports of [1, 5_323, 999_999, 1_000_000, 1_234_567]) {
      expect(suggestedTopUpLamports(lamports)).toBeGreaterThan(lamports);
    }
  });
});

describe("describeFeeShortfall", () => {
  it("names the amount, the address, and that it has to come from elsewhere", () => {
    const copy = describeFeeShortfall(
      assessFeeShortfall(input({ availableLamports: 0 }))!,
    );

    expect(copy.title).toBe("Not enough SOL for the fee");
    expect(copy.message).toMatch(/holds 0 SOL/i);
    expect(copy.message).toMatch(/short/i);
    expect(copy.hint).toContain(PAYER);
    expect(copy.hint).toMatch(/another wallet or exchange/i);
    expect(copy.hint).toMatch(/before a close releases/i);
  });

  it("mentions the rest of the batch only when there is a rest", () => {
    const single = describeFeeShortfall(
      assessFeeShortfall(input({ availableLamports: 0 }))!,
    );
    const batch = describeFeeShortfall(
      assessFeeShortfall(
        input({
          availableLamports: 0,
          totalFeeLamports: FIRST_FEE * 3,
          transactionCount: 3,
        }),
      )!,
    );

    expect(single.hint).not.toMatch(/The other/);
    expect(batch.hint).toMatch(/The other 2 transactions/);
  });
});

describe("FeeShortfallError", () => {
  it("carries the numbers, so nothing downstream recomputes them", () => {
    const shortfall = assessFeeShortfall(input({ availableLamports: 0 }))!;
    const error = new FeeShortfallError(shortfall);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("FeeShortfallError");
    expect(error.shortfall).toBe(shortfall);
    expect(error.message).toBe(describeFeeShortfall(shortfall).message);
  });
});
