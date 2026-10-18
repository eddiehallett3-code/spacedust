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
import { simulateTransaction } from "./simulate";

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
