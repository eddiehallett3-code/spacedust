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
import { FeeShortfallError } from "./fee-shortfall";

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
    await expect(
      simulateAll(connectionWith("InsufficientFundsForFee", 0), [
        packedWithLimit(),
      ]),
    ).rejects.toBeInstanceOf(FeeShortfallError);
  });

  it("names the payer, the fee, and an amount that can actually be sent", async () => {
    try {
      await simulateAll(connectionWith("InsufficientFundsForFee", 0), [
        packedWithLimit(),
      ]);
      expect.unreachable("a zero balance cannot pay a 5,000 lamport fee");
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

  it("stays out of the way for every other failure, even with an empty wallet", async () => {
    const outcomes = await simulateAll(
      connectionWith("MaxLoadedAccountsDataSizeExceeded", 0),
      [packedWithLimit()],
    );

    expect(outcomes[0]?.ok).toBe(false);
    expect(outcomes[0]?.error).toContain("loaded-account-data limit");
  });

  it("also recognises the raw fee error the RPC returns", async () => {
    await expect(
      simulateAll(connectionWith({ InstructionError: [1, "InsufficientFundsForFee"] }, 0), [
        packedWithLimit(),
      ]),
    ).rejects.toBeInstanceOf(FeeShortfallError);
  });
});
