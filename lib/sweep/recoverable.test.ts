import { describe, expect, it } from "vitest";
import {
  summariseRecoverable,
  totalLimitations,
  type RecoverableBreakdown,
} from "@/lib/sweep/recoverable";
import { OUTPUT_ASSETS } from "@/lib/utils/constants";
import type { DustToken, EmptyTokenAccount } from "@/types/token";
import type { ExcessRentAccount } from "@/types/salvage";

/**
 * "The number has to survive being checked later with a wallet connected."
 *
 * The read-only scan quotes recoverable SOL to someone who has not signed
 * anything. So these tests are mostly about what is *excluded*: a frozen
 * account, a transfer hook, a fee-charging mint whose ATA cannot be closed, and
 * an account we could not name are all rent we must not promise. That is the
 * same failure mode as the stale rent constant that once inflated every figure
 * in this app — a plausible number that the chain then refuses.
 */

const RENT = 1_488_440;
const SOL_PRICE = 200;

function token(overrides: Partial<DustToken> = {}): DustToken {
  return {
    mint: "So11111111111111111111111111111111111111112",
    name: "Dust",
    symbol: "DUST",
    logoUri: null,
    rawAmount: "1000",
    balance: 1000,
    decimals: 6,
    priceUsd: 1,
    priceChange24h: null,
    valueUsd: 1,
    program: "legacy",
    tokenAccount: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    hasNoPrice: false,
    hasTransferHook: false,
    hasTransferFee: false,
    frozen: false,
    // The default is an ordinary token. If a position were the default, every
    // test in this file would quietly be about positions instead of dust.
    poolLike: false,
    staked: null,
    ...overrides,
  };
}

/** A valid base58 owner: the wallet that signs and receives any rent. */
const OWNER = "YNvAM4wiyvkgoExvz2ZH2AdhxaRF8ggi15BVSdvb6uA";

/**
 * A second valid account address.
 *
 * It has to be *valid*, not plausible-looking: an invalid one is refused by the
 * planner as `invalid-address`, which is a different outcome from the one these
 * tests are about — and "A" silently took that path until this comment existed.
 */
const SECOND_ACCOUNT = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function emptyAccount(
  overrides: Partial<EmptyTokenAccount> = {},
): EmptyTokenAccount {
  return {
    address: "11111111111111111111111111111111",
    mint: "So11111111111111111111111111111111111111112",
    program: "legacy",
    // A real legacy account's balance, not the live minimum — that difference
    // (2,039,280 against 1,488,440) is the whole reason this is per account.
    lamports: 2_039_280,
    frozen: false,
    closeAuthority: null,
    withheldFees: 0,
    ...overrides,
  };
}

/** The two NFT accounts from the live report, before Sol Incinerator drained them. */
function excessAccount(
  overrides: Partial<ExcessRentAccount> = {},
): ExcessRentAccount {
  return {
    address: "A2xKwTtehdNF9KzkMbEwwj14yBbKqARf2Rbk8o4ezaK",
    mint: "9n3YAi3WWGUjQCJrNKSa2vxX5FGjWgBHxD38HoGK2zaf",
    lamports: 1_912_566,
    rentLamports: 1_534_160,
    excessLamports: 378_406,
    space: 174,
    label: "NFT",
    ...overrides,
  };
}

function scan(
  tokens: DustToken[],
  solPrice: number | null = SOL_PRICE,
  emptyAccounts: EmptyTokenAccount[] = [],
  excessRentAccounts: ExcessRentAccount[] = [],
): Parameters<typeof summariseRecoverable>[0] {
  return {
    owner: OWNER,
    tokens,
    emptyAccounts,
    excessRentAccounts,
    native: { lamports: 5_000_000, sol: 0.005, valueUsd: 1 },
    outputPrices:
      solPrice == null ? {} : { [OUTPUT_ASSETS.SOL.mint]: solPrice },
  };
}

describe("summariseRecoverable", () => {
  it("claims no rent for accounts that still hold a balance", () => {
    // Their rent is real but unreachable until the balance is sold or burned.
    // This page promises what can be collected *now*, so those accounts count as
    // closable — a fact about the future — and contribute no lamports today.
    const result = summariseRecoverable(
      scan([token(), token({ mint: "A" }), token({ mint: "B" })]),
    );

    expect(result.closableAccounts).toBe(3);
    expect(result.rentLamports).toBe(0);
    expect(result.rentUsd).toBe(0);
    // The dust value is the whole total.
    expect(result.totalUsd).toBeCloseTo(3, 10);
    expect(totalLimitations(result.limitations)).toBe(0);
  });

  it("promises nothing for a frozen holding — not its rent, not its value", () => {
    const result = summariseRecoverable(
      scan([token({ frozen: true, valueUsd: 500 })]),
    );

    expect(result.closableAccounts).toBe(0);
    expect(result.rentLamports).toBe(0);
    // Value is still *reported* — the wallet does hold it — but never promised.
    expect(result.heldValueUsd).toBe(500);
    expect(result.sweepableValueUsd).toBe(0);
    expect(result.totalUsd).toBe(0);
    expect(result.limitations.frozen).toBe(1);
  });

  it("does not count a transfer hook as recoverable in any form", () => {
    const result = summariseRecoverable(
      scan([token({ hasTransferHook: true, valueUsd: 42 })]),
    );

    expect(result.closableAccounts).toBe(0);
    expect(result.sweepableValueUsd).toBe(0);
    expect(result.heldValueUsd).toBe(42);
    expect(result.limitations.transferHook).toBe(1);
  });

  it("counts the value of a transfer-fee mint but never its rent", () => {
    // The swap works; the ATA keeps a residue, so `closeAccount` would fail.
    const result = summariseRecoverable(
      scan([token({ hasTransferFee: true, valueUsd: 7 })]),
    );

    expect(result.closableAccounts).toBe(0);
    expect(result.rentLamports).toBe(0);
    expect(result.sweepableValueUsd).toBe(7);
    expect(result.limitations.transferFee).toBe(1);
  });

  it("never closes an account it could not name", () => {
    // No address means no close — and we must not substitute a derived ATA.
    const result = summariseRecoverable(
      scan([token({ tokenAccount: null, valueUsd: 3 })]),
    );

    expect(result.closableAccounts).toBe(0);
    expect(result.sweepableValueUsd).toBe(3);
    expect(result.limitations.unknownAccount).toBe(1);
  });

  it("still reports lamports when there is no price to convert at", () => {
    const result = summariseRecoverable(
      scan([token()], null, [emptyAccount()]),
    );

    // The rent is real whether or not anything can price it.
    expect(result.rentLamports).toBe(2_039_280);
    expect(result.rentUsd).toBeNull();
    expect(result.totalUsd).toBeNull();
    expect(result.solPriceUsd).toBeNull();
    expect(result.sweepableValueUsd).toBe(1);
  });

  it("treats an unusable price as no price at all", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = summariseRecoverable(scan([token()], bad));
      expect(result.solPriceUsd).toBeNull();
      expect(result.totalUsd).toBeNull();
    }
  });

  it("keeps the native balance out of the recoverable total", () => {
    const result = summariseRecoverable(scan([token()]));

    // 0.005 SOL in the wallet must not appear as recoverable: a sweep cannot
    // touch the balance that pays for it.
    expect(result.nativeLamports).toBe(5_000_000);
    expect(result.totalUsd).toBeCloseTo(1, 10);

    // It is part of the *wallet* total, which answers a different question.
    expect(result.walletValueUsd).toBe(2); // 1 of tokens + 1 of native
  });

  it("keeps wSOL principal in the wallet total, not the recoverable total", () => {
    const result = summariseRecoverable({
      ...scan([token()]),
      wrappedSol: [
        {
          address: SECOND_ACCOUNT,
          amountLamports: 1_000_000_000,
          lamports: 1_002_039_280,
          rentLamports: 2_039_280,
          closeAuthority: null,
        },
      ],
    });

    // A wrapped balance is SOL the wallet already owns. It belongs in "what is
    // in here", never in "what a sweep can bring back".
    expect(result.wrappedSolLamports).toBe(1_002_039_280);
    expect(result.wrappedSolUsd).toBeCloseTo(200.407856, 5);
    expect(result.walletValueUsd).toBeCloseTo(202.407856, 5);
    expect(result.totalUsd).toBeCloseTo(1, 10);
  });

  it("has no wallet total when native SOL could not be priced", () => {
    const result = summariseRecoverable({
      ...scan([token()]),
      native: { lamports: 5_000_000, sol: 0.005, valueUsd: null },
    });

    expect(result.walletValueUsd).toBeNull();
    // The token side is still known; only the total is withheld.
    expect(result.heldValueUsd).toBe(1);
  });

  it("prices an empty account from its own balance, not a constant", () => {
    // Token-2022 accounts with extensions hold more than legacy ones, so one
    // number cannot describe both. This is the only rent the page still claims.
    const result = summariseRecoverable(
      scan([token()], SOL_PRICE, [
        emptyAccount(),
        emptyAccount({ address: SECOND_ACCOUNT, lamports: 2_074_080 }),
      ]),
    );

    expect(result.rentLamports).toBe(2_039_280 + 2_074_080);
  });

  it("counts each holding once, under the reason that actually blocks it", () => {
    const result: RecoverableBreakdown = summariseRecoverable(
      scan([
        token({ frozen: true, hasTransferFee: true }),
        token({ hasTransferHook: true, tokenAccount: null }),
        token({ tokenAccount: null }),
        token(),
      ]),
    );

    expect(result.limitations).toEqual({
      staked: 0,
      poolLike: 0,
      frozen: 1,
      transferHook: 1,
      transferFee: 0,
      unknownAccount: 1,
      emptyAuthority: 0,
      emptyWithheldFees: 0,
    });
    // Three of the four are blocked; exactly one account is closable — and a
    // funded account's rent is not counted, only the fact that it could be freed.
    expect(result.closableAccounts).toBe(1);
    expect(result.rentLamports).toBe(0);
    expect(totalLimitations(result.limitations)).toBe(3);
  });
});

/**
 * Already-empty accounts.
 *
 * A sweep can only close an account *its own swap* emptied, so an account that
 * was already empty when the wallet arrived was invisible: both scanners drop a
 * zero balance, and nothing else went looking. Its rent is real, though, and a
 * `closeAccount` returns it.
 *
 * The rules here were settled against mainnet rather than inferred, and two of
 * them are the opposite of what the rest of the app assumes — so they are
 * asserted rather than commented.
 */
describe("already-empty token accounts", () => {
  it("prices one from its own lamports, not from the rent constant", () => {
    // The live minimum measured 1,488,440 while real funded accounts hold
    // 2,039,280. Pricing these from the constant would understate every row.
    const result = summariseRecoverable(
      scan([], SOL_PRICE, [emptyAccount()]),
    );

    expect(result.emptyAccounts).toBe(1);
    expect(result.emptyRentLamports).toBe(2_039_280);
    expect(result.rentLamports).toBe(2_039_280);
    expect(result.emptyRentLamports).not.toBe(RENT);
  });

  it("counts a frozen empty account, because freezing does not block a close", () => {
    // The opposite of a burn or a revoke: the token program refuses to move a
    // frozen balance, but it closes one. Verified by simulation on mainnet.
    const result = summariseRecoverable(
      scan([], SOL_PRICE, [emptyAccount({ frozen: true })]),
    );

    expect(result.emptyAccounts).toBe(1);
    expect(result.emptyRentLamports).toBe(2_039_280);
    // It is not a dust holding, so it must not be reported as a frozen one.
    expect(result.limitations.frozen).toBe(0);
  });

  it("refuses an account a foreign close authority controls, and says so", () => {
    // Verified: `Custom: 4`, "owner does not match" — the owner's signature is
    // not accepted once someone else is the close authority.
    const result = summariseRecoverable(
      scan([], SOL_PRICE, [
        emptyAccount({ closeAuthority: SECOND_ACCOUNT }),
      ]),
    );

    expect(result.emptyAccounts).toBe(0);
    expect(result.emptyRentLamports).toBe(0);
    expect(result.limitations.emptyAuthority).toBe(1);
    expect(totalLimitations(result.limitations)).toBe(1);
  });

  it("accepts a close authority that is the owner itself", () => {
    const result = summariseRecoverable(
      scan([], SOL_PRICE, [emptyAccount({ closeAuthority: OWNER })]),
    );

    expect(result.emptyAccounts).toBe(1);
    expect(result.limitations.emptyAuthority).toBe(0);
  });

  it("refuses an account holding withheld transfer fees, and says so", () => {
    // Verified: `Custom: 35` — the mint must harvest them first, and harvesting
    // needs an authority the holder does not have.
    const result = summariseRecoverable(
      scan([], SOL_PRICE, [emptyAccount({ withheldFees: 173_279 })]),
    );

    expect(result.emptyAccounts).toBe(0);
    expect(result.limitations.emptyWithheldFees).toBe(1);
    expect(totalLimitations(result.limitations)).toBe(1);
  });

  it("counts only the empty accounts, and counts both of them", () => {
    const result = summariseRecoverable(
      scan([token()], SOL_PRICE, [
        emptyAccount(),
        emptyAccount({ address: SECOND_ACCOUNT }),
      ]),
    );

    expect(result.closableAccounts).toBe(1);
    expect(result.emptyAccounts).toBe(2);
    // The funded account contributes nothing; the two empty ones contribute
    // their own deposits.
    expect(result.rentLamports).toBe(2 * 2_039_280);
    expect(result.emptyRentLamports).toBe(2 * 2_039_280);
  });

  it("keeps an excluded empty account out of the total but in the count", () => {
    const result = summariseRecoverable(
      scan([], SOL_PRICE, [
        emptyAccount(),
        emptyAccount({ address: SECOND_ACCOUNT, withheldFees: 1 }),
      ]),
    );

    expect(result.emptyAccounts).toBe(1);
    expect(result.rentLamports).toBe(2_039_280);
    expect(result.limitations.emptyWithheldFees).toBe(1);
  });
});

/**
 * Token-2022 excess rent.
 *
 * The other rent that is reachable *today*. It is not under an empty account and
 * it does not require a sale or a burn: `WithdrawExcessLamports` returns the
 * lamports above the account's own rent-exempt minimum and leaves the token in
 * place. Counting it is therefore the same kind of promise as an empty-account
 * close, not the "someday, after a swap" rent this file deliberately excludes.
 */
describe("Token-2022 excess rent", () => {
  it("adds excess to the amount available today", () => {
    const result = summariseRecoverable(
      scan([], SOL_PRICE, [], [excessAccount()]),
    );

    expect(result.excessRentAccounts).toBe(1);
    expect(result.excessRentLamports).toBe(378_406);
    expect(result.rentLamports).toBe(378_406);
    expect(result.excessRentUsd).toBeCloseTo((378_406 / 1e9) * SOL_PRICE, 10);
    expect(result.rentUsd).toBeCloseTo((378_406 / 1e9) * SOL_PRICE, 10);
    expect(result.totalUsd).toBeCloseTo((378_406 / 1e9) * SOL_PRICE, 10);
  });

  it("keeps the empty-account and excess parts separate in one total", () => {
    const result = summariseRecoverable(
      scan([], SOL_PRICE, [emptyAccount()], [excessAccount()]),
    );

    expect(result.emptyRentLamports).toBe(2_039_280);
    expect(result.excessRentLamports).toBe(378_406);
    expect(result.rentLamports).toBe(2_417_686);
    expect(result.excessRentAccounts).toBe(1);
    expect(result.rentUsd).toBeCloseTo((2_417_686 / 1e9) * SOL_PRICE, 10);
  });

  it("reports the SOL amount without inventing a USD total when SOL has no price", () => {
    const result = summariseRecoverable(
      scan([], null, [], [excessAccount()]),
    );

    expect(result.excessRentLamports).toBe(378_406);
    expect(result.rentLamports).toBe(378_406);
    expect(result.excessRentUsd).toBeNull();
    expect(result.rentUsd).toBeNull();
    expect(result.totalUsd).toBeNull();
  });

  it("counts only accounts with a positive excess", () => {
    const result = summariseRecoverable(
      scan([], SOL_PRICE, [], [
        excessAccount(),
        excessAccount({
          address: SECOND_ACCOUNT,
          excessLamports: 0,
        }),
      ]),
    );

    expect(result.excessRentAccounts).toBe(1);
    expect(result.excessRentLamports).toBe(378_406);
  });
});

/**
 * Program-controlled mints: a pool share, or a program-issued receipt.
 *
 * This is the one holding that is not a dust token however it looks: there is no
 * market to sell it in, and a token account holding a balance cannot be closed,
 * so neither its value nor its rent is reachable. It has to leave the promise for
 * the same reason a frozen account does — and it is the easier of the two to
 * miss, because the balance is real and the price is often non-zero.
 *
 * The signal itself — a mint authority off the ed25519 curve — lives in
 * `lib/sweep/pool-positions.ts`, with its own tests.
 */
describe("holdings in a pool", () => {
  it("promises neither the value nor the rent of a pool share", () => {
    const result = summariseRecoverable(scan([token({ poolLike: true })]));

    expect(result.closableAccounts).toBe(0);
    expect(result.rentLamports).toBe(0);
    expect(result.sweepableValueUsd).toBe(0);
    expect(result.limitations.poolLike).toBe(1);
  });

  it("still lists it as held, because it is the user's", () => {
    // Shown and never promised — the same treatment frozen and hook-held value
    // gets. Hiding it would be the opposite mistake: the wallet does hold it.
    const result = summariseRecoverable(scan([token({ poolLike: true })]));

    expect(result.heldValueUsd).toBe(1);
    expect(result.totalUsd).toBe(0);
  });

  it("counts it as the reason that blocks it, not as something else", () => {
    // A pool share can also be frozen or hooked. "It is a pool share" is the
    // reason a sweep cannot act on it, so it is the one reported.
    const result = summariseRecoverable(
      scan([
        token({ poolLike: true, frozen: true }),
        token({ poolLike: true, hasTransferHook: true }),
        token({ poolLike: true, tokenAccount: null }),
        token(),
      ]),
    );

    expect(result.limitations.poolLike).toBe(3);
    expect(result.limitations.frozen).toBe(0);
    expect(result.limitations.transferHook).toBe(0);
    expect(result.limitations.unknownAccount).toBe(0);
    // Exactly one of the four remains sweepable.
    expect(result.closableAccounts).toBe(1);
    expect(totalLimitations(result.limitations)).toBe(3);
  });

  it("treats an unpriceable pool share the same way, and it is the tempting case", () => {
    // Most pool shares have no Jupiter price at all, which makes the *rent* the
    // tempting mistake: an unpriced holding looks exactly like a dust account
    // that could be closed.
    const result = summariseRecoverable(
      scan([token({ poolLike: true, priceUsd: null, hasNoPrice: true, valueUsd: 0 })]),
    );

    expect(result.closableAccounts).toBe(0);
    expect(result.rentLamports).toBe(0);
    expect(result.limitations.poolLike).toBe(1);
  });
});

/**
 * Staking tokens we can name — mSOL, JitoSOL and the rest.
 *
 * The consequence matches a pool share (a sweep will not sell one), but the
 * answer is better, and the difference is the whole feature: these have a
 * protocol we can name. Two rules follow, and both are asserted rather than
 * commented:
 *
 *  - The two signals **overlap**. Nearly every LST is also a program-controlled
 *    mint, so counting a holding as both would double it. `staked` is the
 *    stronger reading and leads — see `lib/staking/staked-tokens.ts`.
 *  - A staking token is excluded **on its own name**, not because `poolLike`
 *    happened to agree. If a registry mint were ever not program-controlled, it
 *    must still stay out of the sweep.
 */
describe("holdings staked in a protocol", () => {
  const MSOL = { protocol: "Marinade", underlying: "SOL", symbol: "mSOL" };
  const JITOSOL = { protocol: "Jito", underlying: "SOL", symbol: "JitoSOL" };

  it("reports a staking token as staked, and never also as a pool share", () => {
    const result = summariseRecoverable(
      scan([token({ staked: MSOL, poolLike: true, valueUsd: 500 })]),
    );

    expect(result.limitations.staked).toBe(1);
    expect(result.limitations.poolLike).toBe(0);
    // The position is intact and still the user's — just not part of this total.
    expect(result.heldValueUsd).toBe(500);
    expect(result.sweepableValueUsd).toBe(0);
    expect(result.closableAccounts).toBe(0);
    expect(result.rentLamports).toBe(0);
    expect(result.totalUsd).toBe(0);
  });

  it("keeps it out of the sweep even when poolLike is false", () => {
    // The registry is the stronger signal, so it must not depend on the mint
    // happening to look program-controlled.
    const result = summariseRecoverable(
      scan([token({ staked: JITOSOL, poolLike: false, valueUsd: 42 })]),
    );

    expect(result.limitations.staked).toBe(1);
    expect(result.sweepableValueUsd).toBe(0);
    expect(result.closableAccounts).toBe(0);
  });

  it("counts it once in the limitations total", () => {
    const result = summariseRecoverable(
      scan([token({ staked: MSOL, poolLike: true })]),
    );

    expect(totalLimitations(result.limitations)).toBe(1);
  });
});


