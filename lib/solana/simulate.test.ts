import { describe, expect, it } from "vitest";
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { createComputeBudgetInstructions } from "@/lib/solana/instructions";
import { bytesToBase64 } from "@/lib/utils/base64";
import type { PackedTransaction } from "@/types/sweep";
import { simulateAll, simulateTransaction } from "./simulate";
import { EmptyWalletError, FeeShortfallError } from "./fee-shortfall";
import { createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { TOKEN_ACCOUNT_RENT_LAMPORTS } from "@/lib/utils/constants";

/**
 * `MaxLoadedAccountsDataSizeExceeded` is the one simulation error whose cause is
 * a number in the transaction, not a fact about the wallet.
 *
 * The app shipped with a 1 MiB declaration, which is below Jupiter's own 2.89 MB
 * program binary, so every Slingshot swap and every Token-2022 Void burn failed
 * here. When it happens again, the error must say which limit the transaction
 * carried: 1,048,576 means a stale bundle; 67,108,864 means a genuinely
 * oversized transaction. Without that, the message is a dead end.
 */

function packedWithLimit(loadedLimit?: number): PackedTransaction {
  const message = new TransactionMessage({
    payerKey: PublicKey.default,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: createComputeBudgetInstructions(800_000, 0, loadedLimit),
  }).compileToV0Message();

  return {
    index: 0,
    base64: bytesToBase64(new VersionedTransaction(message).serialize()),
    mints: [],
    sizeBytes: 0,
    instructionCount: 3,
    includesRentReclaim: false,
    rentReclaimMints: [],
  };
}

function connectionReturning(err: unknown): Connection {
  return {
    simulateTransaction: async () => ({
      context: { slot: 1 },
      value: { err, logs: [], unitsConsumed: 0 },
    }),
  } as unknown as Connection;
}

describe("simulateTransaction explains the loaded-data limit", () => {
  it("names the 64 MiB declaration when the data is genuinely over it", async () => {
    const result = await simulateTransaction(
      connectionReturning("MaxLoadedAccountsDataSizeExceeded"),
      packedWithLimit(),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("67,108,864 bytes (64 MiB)");
  });

  it("names a 1 MiB declaration, which is the signature of a stale bundle", async () => {
    const result = await simulateTransaction(
      connectionReturning("MaxLoadedAccountsDataSizeExceeded"),
      packedWithLimit(1_048_576),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("1,048,576 bytes (1 MiB)");
  });

  it("leaves every other simulation failure alone", async () => {
    const result = await simulateTransaction(
      connectionReturning({ InstructionError: [1, { Custom: 11 }] }),
      packedWithLimit(),
    );

    expect(result.error).not.toContain("loaded-account-data limit");
  });
});

/**
 * The fee the wallet cannot pay.
 *
 * Solana takes the fee before any instruction runs, so a close in the same
 * transaction cannot fund it — which is exactly why the app advances nothing and
 * says what to send instead. `simulateAll` is the choke point every money path
 * goes through, so this is where the exact numbers are produced.
 */
function connectionWith(err: unknown, balanceLamports: number): Connection {
  return {
    simulateTransaction: async () => ({
      context: { slot: 1 },
      value: { err, logs: [], unitsConsumed: 0 },
    }),
    getBalance: async () => balanceLamports,
  } as unknown as Connection;
}

describe("simulateAll — a wallet that cannot pay the fee", () => {
  it("throws the exact shortfall instead of the generic simulation failure", async () => {
    // A wallet that exists but cannot cover the fee. (Zero lamports is a
    // different answer — see the empty-wallet test below.)
    await expect(
      simulateAll(connectionWith("InsufficientFundsForFee", 1_000), [
        packedWithLimit(),
      ]),
    ).rejects.toBeInstanceOf(FeeShortfallError);
  });

  it("names the payer, the fee, and an amount that can actually be sent", async () => {
    try {
      await simulateAll(connectionWith("InsufficientFundsForFee", 1_000), [
        packedWithLimit(),
      ]);
      expect.unreachable("a 1,000 lamport balance cannot pay a 7,000 fee");
    } catch (caught) {
      expect(caught).toBeInstanceOf(FeeShortfallError);
      const { shortfall } = caught as FeeShortfallError;

      expect(shortfall.payer).toBe(PublicKey.default.toBase58());
      // Base fee for one signature, plus the priority fee the compute-budget
      // instruction implies: 5,000 + ceil(800,000 CU × 2,500 µL / 1,000,000).
      expect(shortfall.firstFeeLamports).toBe(7_000);
      expect(shortfall.suggestedLamports).toBe(1_000_000);
    }
  });

  it("stays out of the way when the balance could pay, despite the failed simulation", async () => {
    const outcomes = await simulateAll(
      connectionWith("InsufficientFundsForFee", 1_000_000),
      [packedWithLimit()],
    );

    // The failure is still reported as a failure — it is just not turned into a
    // claim about the wallet's balance, which was not the problem.
    expect(outcomes[0]?.ok).toBe(false);
  });

  it("leaves a non-fee failure alone when the wallet can pay", async () => {
    const outcomes = await simulateAll(
      connectionWith("MaxLoadedAccountsDataSizeExceeded", 1_000_000),
      [packedWithLimit()],
    );

    expect(outcomes[0]?.ok).toBe(false);
    expect(outcomes[0]?.error).toContain("loaded-account-data limit");
  });

  it("also recognises the raw fee error the RPC returns", async () => {
    await expect(
      simulateAll(connectionWith({ InstructionError: [1, "InsufficientFundsForFee"] }, 1_000), [
        packedWithLimit(),
      ]),
    ).rejects.toBeInstanceOf(FeeShortfallError);
  });

  it("treats a rent shortfall as the balance problem it is", async () => {
    // A wallet holding 87,348 lamports can "afford" a 7,000 fee and still not be
    // allowed to pay it: the account would end below the rent-exempt floor. The
    // cluster calls that `InsufficientFundsForRent`, which the old gate ignored,
    // so the raw cluster sentence reached the phone instead of an amount.
    await expect(
      simulateAll(
        connectionWith("Transaction results in an account with insufficient funds for rent", 87_348),
        [packedWithLimit()],
      ),
    ).rejects.toBeInstanceOf(FeeShortfallError);
  });


  it("names a wallet with no lamports as empty, not as a missing token account", async () => {
    // The real report: a wallet with 0 SOL swapping 20¢ of USDC was told "a token
    // account no longer exists, rescan". `AccountNotFound` was the *wallet*, and a
    // zero-lamport account does not exist on chain at all.
    try {
      await simulateAll(connectionWith("AccountNotFound", 0), [packedWithLimit()]);
      expect.unreachable("an account with no lamports cannot pay anything");
    } catch (caught) {
      expect(caught).toBeInstanceOf(EmptyWalletError);
      expect((caught as EmptyWalletError).payer).toBe(
        PublicKey.default.toBase58(),
      );
      expect((caught as Error).message).toMatch(/no lamports at all/i);
    }
  });

  it("quotes the output account's rent as well as the fee when the swap opens one", async () => {
    // A packed transaction that creates an associated token account, as a sweep
    // into an empty wallet does. The deposit is not a fee, but it has to be there
    // before the transaction runs.
    const message = new TransactionMessage({
      payerKey: PublicKey.default,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [
        ...createComputeBudgetInstructions(800_000, 0),
        createAssociatedTokenAccountInstruction(
          PublicKey.default,
          PublicKey.default,
          PublicKey.default,
          PublicKey.default,
        ),
      ],
    }).compileToV0Message();
    const packed: PackedTransaction = {
      index: 0,
      base64: bytesToBase64(new VersionedTransaction(message).serialize()),
      mints: [],
      sizeBytes: 0,
      instructionCount: 2,
      includesRentReclaim: false,
      rentReclaimMints: [],
    };

    try {
      await simulateAll(connectionWith("InsufficientFundsForFee", 1_000), [packed]);
      expect.unreachable("1,000 lamports cannot cover a fee plus an account");
    } catch (caught) {
      expect(caught).toBeInstanceOf(FeeShortfallError);
      const { shortfall } = caught as FeeShortfallError;
      expect(shortfall.rentLamports).toBe(TOKEN_ACCOUNT_RENT_LAMPORTS);
      expect(shortfall.shortfallLamports).toBeGreaterThan(
        shortfall.firstFeeLamports,
      );
    }
  });
});
