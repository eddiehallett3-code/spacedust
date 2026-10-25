import { describe, expect, it } from "vitest";
import {
  assessFeeShortfall,
  describeEmptyWallet,
  describeFeeShortfall,
  EmptyWalletError,
  FeeShortfallError,
  suggestedTopUpLamports,
} from "./fee-shortfall";
import { TOKEN_ACCOUNT_RENT_LAMPORTS } from "@/lib/utils/constants";

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

/**
 * A swap needs more than a fee: it opens the account it sends into, and the fee
 * payer deposits that account's rent before anything runs. Quoting the fee alone
 * sent a real user away with a quarter of what they needed.
 */
describe("a transaction that opens an account", () => {
  it("counts the deposit, and says in the copy what it is", () => {
    const shortfall = assessFeeShortfall(
      input({
        availableLamports: 0,
        rentLamports: TOKEN_ACCOUNT_RENT_LAMPORTS,
      }),
    )!;

    expect(shortfall.rentLamports).toBe(TOKEN_ACCOUNT_RENT_LAMPORTS);
    expect(shortfall.shortfallLamports).toBe(
      FIRST_FEE + TOKEN_ACCOUNT_RENT_LAMPORTS,
    );

    const copy = describeFeeShortfall(shortfall);
    expect(copy.title).toBe("Not enough SOL to send this");
    expect(copy.message).toMatch(/for the account it opens/i);
    expect(copy.hint).toMatch(/deposit/i);
  });

  it("is no shortfall once the balance covers fee and deposit", () => {
    expect(
      assessFeeShortfall(
        input({
          availableLamports: FIRST_FEE + TOKEN_ACCOUNT_RENT_LAMPORTS,
          rentLamports: TOKEN_ACCOUNT_RENT_LAMPORTS,
        }),
      ),
    ).toBeNull();
  });
});

describe("a wallet below the rent-exempt floor", () => {
  // Found on a phone: 87,348 lamports cannot pay a 7,000 fee, because the account
  // would be left at 80,348 — non-zero and below the 650,240 minimum, which the
  // cluster refuses as `InsufficientFundsForRent`. The old gate only matched fee
  // wording, so the raw sentence reached the user instead of an amount to send.
  const shortfall = assessFeeShortfall({
    payer: "G4ucVPdGWwbPxJdox4acDpcN8tFXU2VP35Dg9emG95",
    availableLamports: 87_348,
    firstFeeLamports: 7_000,
    reserveLamports: 650_240,
    totalFeeLamports: 7_000,
    transactionCount: 1,
  });

  it("counts the floor as part of what the wallet must hold", () => {
    expect(shortfall).not.toBeNull();
    expect(shortfall?.reserveLamports).toBe(650_240);
    expect(shortfall?.shortfallLamports).toBe(7_000 + 650_240 - 87_348);
  });

  it("says the balance is below the minimum rather than short of the fee", () => {
    const copy = describeFeeShortfall(shortfall!);

    expect(copy.title).toBe("This wallet is below the minimum balance");
    expect(copy.message).toContain("rent-exempt minimum");
    expect(copy.hint).toContain("either empty or above it");
  });
});


/**
 * The wallet that does not exist.
 *
 * Zero lamports is not "a bit short": the cluster has no account to charge, so
 * the RPC answers `AccountNotFound` and the app used to blame a token account.
 * The copy has to say the true thing, and point at the one path that costs
 * nothing — a sponsored close in Salvage.
 */
describe("a wallet with no lamports", () => {
  it("names the wallet, not a token account, and points at Salvage", () => {
    const copy = describeEmptyWallet(PAYER);

    expect(copy.title).toBe("This wallet has no SOL");
    expect(copy.message).toMatch(/no lamports at all/i);
    expect(copy.message).not.toMatch(/token account/i);
    expect(copy.hint).toContain(PAYER);
    expect(copy.hint).toMatch(/Salvage/i);
  });

  it("carries the payer on the error", () => {
    const error = new EmptyWalletError(PAYER);
    expect(error.payer).toBe(PAYER);
    expect(error.message).toBe(describeEmptyWallet(PAYER).message);
  });
});

