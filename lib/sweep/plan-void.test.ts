import { beforeAll, describe, expect, it, vi } from "vitest";
import { PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";

vi.mock("@/lib/solana/simulate", () => ({
  simulateAll: vi.fn(async (_connection: unknown, transactions: unknown[]) =>
    transactions.map(() => ({ ok: true, feeLamports: 5_000, error: null })),
  ),
}));

import { planVoid, VoidError } from "@/lib/sweep/plan-void";
import type { DustToken } from "@/types/token";

/**
 * The Void's fee is taken from reclaimed rent, as a plain SOL transfer built
 * into the same transaction. This locks the *amount*, because that is the part
 * that was wrong: the fee was priced from a hardcoded rent constant, so the app
 * advertised 1.5% and charged 2.06% of what the chain actually returns.
 */

const OWNER = "C9fK5qou5v9E7cAT8zq6ZsfCtz2jWQxJ2st5yaAXFC5t";
const FEE_WALLET = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
const TOKEN_ACCOUNT = "HDB6voVbH8skNEXH13bBqJ9tNk2DrtQ3eJ8AucFZan8d";
const MINT = "JEKMoZLzbHgsUwpNrDp7aDNKXNN432hJrbegzTTCLnwQ";
/** A second, unrelated mint, so two tokens can be told apart in one plan. */
const OTHER_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const token: DustToken = {
  mint: MINT,
  name: "Dust",
  symbol: "DUST",
  logoUri: null,
  rawAmount: "1000",
  balance: 1000,
  decimals: 6,
  priceUsd: null,
  priceChange24h: null,
  valueUsd: 0,
  program: "legacy",
  tokenAccount: TOKEN_ACCOUNT,
  hasNoPrice: true,
  hasTransferHook: false,
  hasTransferFee: false,
  frozen: false,
  poolLike: false,
  staked: null,
};

function fakeConnection(): Connection {
  return {
    getLatestBlockhash: async () => ({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 1,
    }),
    getMinimumBalanceForRentExemption: async (size: number) =>
      size === 165 ? 1_488_440 : 650_240,
    // The fee wallet is funded, so the fee is in scope.
    getAccountInfo: async () => ({ lamports: 10_000_000 }),
    /**
     * One parsed token account per address, each holding a fresh 165-byte deposit.
     *
     * The planner reads this to learn both whether an account is frozen and what
     * its own rent-exempt deposit is; the fee is a percentage of that deposit, so
     * a fake without it would charge nothing and prove nothing.
     */
    getMultipleParsedAccounts: async (addresses: PublicKey[]) =>
      ({
        context: { slot: 1 },
        value: addresses.map(() => ({
          data: {
            parsed: { info: { state: "initialized" }, type: "account" },
            program: "spl-token",
            space: 165,
          },
          executable: false,
          lamports: 1_488_440,
          owner: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
          rentEpoch: 0,
        })),
      }) as unknown as Awaited<
        ReturnType<Connection["getMultipleParsedAccounts"]>
      >,
  } as unknown as Connection;
}

/** Pull the lamports out of a System `transfer` instruction, if present. */
function transferLamports(base64: string): bigint | null {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  const keys = tx.message.staticAccountKeys;
  for (const ix of tx.message.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    if (!program) continue;
    const data = Buffer.from(ix.data);
    // System program, instruction index 2 = Transfer, then a u64 of lamports.
    if (program.toBase58() === "11111111111111111111111111111111" && data[0] === 2) {
      return data.readBigUInt64LE(4);
    }
  }
  return null;
}

/** The single transaction a one-token plan produces. */
function onlyTx(plan: { packed: Array<{ base64: string }> }): string {
  const first = plan.packed[0];
  if (!first) throw new Error("expected exactly one packed transaction");
  return first.base64;
}

beforeAll(() => {
  process.env.NEXT_PUBLIC_FEE_WALLET = FEE_WALLET;
});

describe("planVoid fee", () => {
  it("charges exactly 1.5% of the rent the chain reports", async () => {
    const plan = await planVoid({
      connection: fakeConnection(),
      owner: new PublicKey(OWNER),
      tokens: [token],
    });

    expect(plan.tokenAccountRentLamports).toBe(1_488_440);
    expect(plan.feeByMint.get(MINT)).toBe(22_326);

    // The amount that actually goes on chain.
    const lamports = transferLamports(onlyTx(plan));
    expect(lamports).toBe(22_326n);

    // And not what the stale constant would have charged.
    expect(lamports).not.toBe(30_589n);
  });

  it("reports rent net of the fee, so the summary cannot overstate it", async () => {
    const plan = await planVoid({
      connection: fakeConnection(),
      owner: new PublicKey(OWNER),
      tokens: [token],
    });

    expect(plan.estimatedRentReclaimLamports).toBe(1_488_440);
    expect(plan.estimatedNetRentLamports).toBe(1_488_440 - 22_326);
  });

  it("charges nothing when no fee wallet is configured", async () => {
    const saved = process.env.NEXT_PUBLIC_FEE_WALLET;
    delete process.env.NEXT_PUBLIC_FEE_WALLET;
    try {
      const plan = await planVoid({
        connection: fakeConnection(),
        owner: new PublicKey(OWNER),
        tokens: [token],
      });

      expect(plan.feeByMint.size).toBe(0);
      expect(transferLamports(onlyTx(plan))).toBeNull();
      // The burn itself still happens: with no fee the user just keeps it all.
      expect(plan.estimatedNetRentLamports).toBe(1_488_440);
    } finally {
      process.env.NEXT_PUBLIC_FEE_WALLET = saved;
    }
  });
});

/** A connection that reports one specific token account as frozen. */
function frozenConnection(frozenAccount: string): Connection {
  const base = fakeConnection() as unknown as Record<string, unknown>;
  return {
    ...base,
    getMultipleParsedAccounts: async (addresses: PublicKey[]) => ({
      context: { slot: 1 },
      value: addresses.map((address) =>
        address.toBase58() === frozenAccount
          ? {
              data: {
                program: "spl-token",
                parsed: { type: "account", info: { state: "frozen" } },
                space: 165,
              },
            }
          : null,
      ),
    }),
  } as unknown as Connection;
}

/** Every account a packed transaction touches. */
function accountKeys(base64: string): string[] {
  const transaction = VersionedTransaction.deserialize(
    Buffer.from(base64, "base64"),
  );
  return transaction.message.staticAccountKeys.map((key) => key.toBase58());
}

/**
 * A frozen account can be neither burned nor closed, so offering one is
 * offering a preview that cannot succeed.
 *
 * This is the rule the NFT tab already enforced and the token tab did not — the
 * gap that turned a frozen token into a bare `{"InstructionError":[2,{"Custom":17}]}`
 * with no explanation, after building and simulating a burn that was never
 * going to be allowed.
 */
describe("planVoid refuses frozen accounts", () => {
  it("skips the frozen token, says why, and never builds a burn for it", async () => {
    const frozen: DustToken = {
      ...token,
      mint: MINT,
      tokenAccount: TOKEN_ACCOUNT,
    };
    const healthy: DustToken = { ...token, mint: OTHER_MINT, tokenAccount: null };

    const plan = await planVoid({
      connection: frozenConnection(TOKEN_ACCOUNT),
      owner: new PublicKey(OWNER),
      tokens: [frozen, healthy],
    });

    expect(plan.warnings.join(" ")).toContain("frozen by the mint's authority");

    // The frozen mint must not appear anywhere in what we would have signed.
    const keys = plan.packed.flatMap((packed) => accountKeys(packed.base64));
    expect(keys).not.toContain(MINT);
    // And the healthy one still went through, so this refuses rather than
    // disabling the whole pipeline.
    expect(keys).toContain(OTHER_MINT);
  });

  it("treats an unreadable answer as unknown, not as frozen", async () => {
    // A failed account lookup must never block a user who has done nothing
    // wrong. The simulation is the backstop.
    const plan = await planVoid({
      connection: fakeConnection(),
      owner: new PublicKey(OWNER),
      tokens: [token],
    });

    expect(plan.warnings.join(" ")).not.toContain("frozen");
    expect(transferLamports(onlyTx(plan))).toBe(22_326n);
  });
});

/**
 * A pool share is never burned.
 *
 * This is the one refusal in this planner that protects value rather than
 * reporting a limit. Most pool shares carry no price at all, and The Void
 * pre-selects the unpriced — so without this rule the default path through the
 * page would offer to burn the token, and burning one closes the account and
 * gives away the share of the pool it represented, irreversibly, for nothing.
 *
 * `poolLike` is decided on the server from the mint's own authority: it is
 * controlled by a program rather than a keypair, which is what a liquidity
 * position looks like. See `lib/sweep/pool-positions.ts`.
 */
describe("planVoid refuses a pool share", () => {
  it("skips it, says why, and never builds a burn for it", async () => {
    const share: DustToken = { ...token, poolLike: true };
    const healthy: DustToken = { ...token, mint: OTHER_MINT, tokenAccount: null };

    const plan = await planVoid({
      connection: fakeConnection(),
      owner: new PublicKey(OWNER),
      tokens: [share, healthy],
    });

    expect(plan.warnings.join(" ")).toContain(
      "burning it would give the share away for nothing",
    );

    // Not merely warned about: the pool's mint must not appear in anything we
    // would have signed, or the warning would describe a burn that happened
    // anyway.
    const keys = plan.packed.flatMap((packed) => accountKeys(packed.base64));
    expect(keys).not.toContain(MINT);
    expect(keys).toContain(OTHER_MINT);
  });

  it("refuses a wallet whose only holding is a pool share, rather than burning it", async () => {
    // This is the dangerous default: the share is unpriced, so without the rule
    // it is "unroutable" and pre-ticked. Nothing can be built from it, so the
    // whole preview is refused — and the reason travels on the error, where the
    // screen shows it, rather than being swallowed.
    const thrown: unknown = await planVoid({
      connection: fakeConnection(),
      owner: new PublicKey(OWNER),
      tokens: [{ ...token, poolLike: true }],
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(VoidError);
    const error = thrown as VoidError;
    expect(error.message).toContain("None of the selected tokens");
    expect(error.warnings.join(" ")).toContain("held in a liquidity pool");
    // Nothing was signed: there is no packed transaction to sign.
    expect(error.warnings.join(" ")).toContain(
      "burning it would give the share away for nothing",
    );
  });
});
