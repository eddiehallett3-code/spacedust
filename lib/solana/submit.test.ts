import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";
import type { PackedTransaction } from "@/types/sweep";
import {
  SIGNING_TIMEOUT_MS,
  SigningTimeoutError,
  settleTransaction,
  signTransactions,
  submitTransactions,
  type SettleVerdict,
  type SigningCapableWallet,
} from "./submit";

/**
 * The settle path that a test transfer uses.
 *
 * These exist because of a specific, expensive failure: `confirmTransaction`'s
 * blockhash strategy throws once the blockhash's lifetime passes, *even when the
 * transaction confirmed*, and the app reported that as the transfer failing. The
 * transfer had been finalized. The whole point of `settleTransaction` is the rule
 * these tests pin down: **an expired blockhash ends the wait, not the
 * transaction**, and nothing is called failed until the chain has been asked.
 */

interface FakeOptions {
  /** Answers for successive status polls; the last one repeats. */
  statuses?: Array<{ err?: unknown; confirmationStatus?: string; confirmations?: number | null } | null>;
  blockHeight?: number;
  /** What `getTransaction` finds, or null for "never seen". */
  transaction?: { meta?: { err?: unknown } } | null;
}

function fakeConnection(options: FakeOptions) {
  const calls: { statusArgs: unknown; statusPolls: number } = {
    statusArgs: null,
    statusPolls: 0,
  };
  const statuses = options.statuses ?? [null];
  const connection = {
    getSignatureStatuses: async (signatures: string[], config: unknown) => {
      calls.statusArgs = { signatures, config };
      const index = calls.statusPolls;
      calls.statusPolls += 1;
      const status = statuses[Math.min(index, statuses.length - 1)];
      return { value: [status] };
    },
    getBlockHeight: async () => options.blockHeight ?? 1,
    getTransaction: async () => options.transaction ?? null,
  };
  return { connection: connection as never, calls };
}

const SIGNATURE = "3Bwppb9v3PxCZfgeiU3pKDUUxB2KzPHjMEtDMU9P3ydG9XTuKkJHyhNmtM9yZRRkjQcW2HHRtij3kAEScB2jCdcL";

/** The blockhash's window has closed. */
const EXPIRED = { blockHeight: 1_000_000 };

describe("settling one transaction", () => {
  it("reports confirmed as soon as the chain says so", async () => {
    const { connection } = fakeConnection({
      statuses: [{ err: null, confirmationStatus: "confirmed" }],
      ...EXPIRED,
    });

    const verdict = await settleTransaction(connection, SIGNATURE, 999_999);

    expect(verdict.kind).toBe("confirmed");
  });

  it("accepts a finalized transaction, where confirmations is null", async () => {
    const { connection } = fakeConnection({
      statuses: [{ err: null, confirmationStatus: "finalized", confirmations: null }],
      ...EXPIRED,
    });

    expect((await settleTransaction(connection, SIGNATURE, 999_999)).kind).toBe(
      "confirmed",
    );
  });

  it("does NOT report failure when the blockhash expired but the transfer landed", async () => {
    // The reported bug, exactly: no status came back, the blockhash window
    // closed, and the transfer had in fact been finalized. Reporting "expired"
    // told the user it had not happened, and left the destination unverified so
    // the whole flow dead-ended.
    const { connection } = fakeConnection({
      statuses: [null],
      blockHeight: 1_000_000,
      transaction: { meta: { err: null } },
    });

    const verdict = await settleTransaction(connection, SIGNATURE, 999_999);

    expect(verdict.kind).toBe("confirmed");
  });

  it("says not-included only when the chain has never seen it", async () => {
    const { connection } = fakeConnection({
      statuses: [null],
      blockHeight: 1_000_000,
      transaction: null,
    });

    const verdict = await settleTransaction(connection, SIGNATURE, 999_999);

    expect(verdict.kind).toBe("not-included");
    // Deliberately not "failed": nothing is known either way.
    expect(verdict.kind).not.toBe("failed");
  });

  it("reports a failure that the chain itself reports", async () => {
    const { connection } = fakeConnection({
      statuses: [{ err: { InstructionError: [0, "Custom"] } }],
      ...EXPIRED,
    });

    const verdict = await settleTransaction(connection, SIGNATURE, 999_999);

    expect(verdict.kind).toBe("failed");
  });

  it("finds an error the status poll missed by reading the transaction back", async () => {
    const { connection } = fakeConnection({
      statuses: [null],
      blockHeight: 1_000_000,
      transaction: { meta: { err: { InstructionError: [1, "Custom"] } } },
    });

    const verdict = await settleTransaction(connection, SIGNATURE, 999_999);

    expect(verdict.kind).toBe("failed");
  });

  it("keeps waiting while the blockhash still has life in it", async () => {
    const { connection, calls } = fakeConnection({
      statuses: [null, { err: null, confirmationStatus: "confirmed" }],
      blockHeight: 100,
    });

    const verdict: SettleVerdict = await settleTransaction(
      connection,
      SIGNATURE,
      999_999,
    );

    expect(verdict.kind).toBe("confirmed");
    expect(calls.statusPolls).toBeGreaterThan(1);
  });

  it("asks for the transaction history, not just the recent cache", async () => {
    // Without this the lookup misses any transaction older than the RPC's recent
    // window, which is how a landed transfer gets called missing.
    const { connection, calls } = fakeConnection({
      statuses: [{ err: null, confirmationStatus: "confirmed" }],
      ...EXPIRED,
    });

    await settleTransaction(connection, SIGNATURE, 999_999);

    expect(calls.statusArgs).toMatchObject({
      signatures: [SIGNATURE],
      config: { searchTransactionHistory: true },
    });
  });
});

/**
 * The stuck detector.
 *
 * A mobile wallet answers through a channel that can go quiet mid-request: the
 * SDK's own timeout covers only the *association* — opening the wallet and
 * letting it attach — so a wallet that attaches and then never answers leaves
 * the promise pending forever. That is how a real sweep ended up sitting on
 * "waiting for you" with nothing to report, because the app could not tell
 * "no answer yet" from "no answer, ever". These tests pin that distinction.
 *
 * The window is generous by design (three minutes), so these use fake timers
 * rather than waiting.
 */

/** A real serialised v0 transaction, unsigned — what `signTransactions` decodes. */
function packed(index: number): PackedTransaction {
  const message = new TransactionMessage({
    payerKey: PublicKey.default,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [],
  }).compileToV0Message();

  return {
    index,
    base64: bytesToBase64(new VersionedTransaction(message).serialize()),
    mints: [],
    sizeBytes: 0,
    instructionCount: 0,
    includesRentReclaim: false,
    rentReclaimMints: [],
  };
}

/** The same transaction with a signature filled in, so `isUnsigned` is false. */
function signed(transaction: VersionedTransaction): VersionedTransaction {
  const copy = VersionedTransaction.deserialize(transaction.serialize());
  copy.signatures = copy.signatures.map(() => new Uint8Array(64).fill(7));
  return copy;
}

/** A wallet that accepts a request and never settles it. */
const muteWallet = (): SigningCapableWallet =>
  ({ signTransaction: () => new Promise<never>(() => {}) }) as unknown as SigningCapableWallet;

describe("signTransactions — a wallet that never answers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up instead of waiting forever", async () => {
    vi.useFakeTimers();
    const call = signTransactions(muteWallet(), [packed(0)]);
    // Attach the expectation before advancing, so the rejection is never
    // momentarily unhandled.
    const rejects = expect(call).rejects.toThrow(SigningTimeoutError);

    await vi.advanceTimersByTimeAsync(SIGNING_TIMEOUT_MS);
    await rejects;
  });

  it("says nothing was sent, because nothing was", async () => {
    vi.useFakeTimers();
    const call = signTransactions(muteWallet(), [packed(0)]);
    const rejects = expect(call).rejects.toThrow(/Nothing was sent/);

    await vi.advanceTimersByTimeAsync(SIGNING_TIMEOUT_MS);
    await rejects;
  });

  it("covers a batch request that never answers", async () => {
    vi.useFakeTimers();
    const wallet = {
      signAllTransactions: () => new Promise<never>(() => {}),
    } as unknown as SigningCapableWallet;

    const call = signTransactions(wallet, [packed(0), packed(1)]);
    const rejects = expect(call).rejects.toThrow(SigningTimeoutError);

    await vi.advanceTimersByTimeAsync(SIGNING_TIMEOUT_MS);
    await rejects;
  });

  it("covers a wallet that answers the first transaction and then goes quiet", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const wallet = {
      signTransaction: async (transaction: VersionedTransaction) => {
        calls += 1;
        if (calls === 2) return new Promise<never>(() => {});
        return signed(transaction);
      },
    } as unknown as SigningCapableWallet;

    const call = signTransactions(wallet, [packed(0), packed(1)]);
    const rejects = expect(call).rejects.toThrow(SigningTimeoutError);

    await vi.advanceTimersByTimeAsync(SIGNING_TIMEOUT_MS);
    await rejects;
    expect(calls).toBe(2);
  });

  it("does not interfere with a wallet that answers", async () => {
    const wallet = {
      signTransaction: async (transaction: VersionedTransaction) => signed(transaction),
    } as unknown as SigningCapableWallet;

    const [result] = await signTransactions(wallet, [packed(0)]);
    expect(result?.signatures[0]?.some((byte) => byte !== 0)).toBe(true);
  });

  it("signs Phantom one transaction at a time, because a batch is what it blocks", async () => {
    // Observed against a production build: Phantom's scanner refuses a batched
    // approval ("request blocked", flagged as malicious) even when the batch is
    // nothing but routine Jupiter swaps — while the same transactions signed one
    // at a time raise no warning, and a single-transaction sweep was never
    // flagged. Extra prompts are the price of a sweep that works at all.
    let singles = 0;
    let batches = 0;
    const wallet = {
      walletName: "Phantom",
      signTransaction: async (transaction: VersionedTransaction) => {
        singles += 1;
        return signed(transaction);
      },
      signAllTransactions: async (transactions: VersionedTransaction[]) => {
        batches += 1;
        return transactions.map(signed);
      },
    } as unknown as SigningCapableWallet;

    const result = await signTransactions(wallet, [packed(0), packed(1)]);

    expect(result).toHaveLength(2);
    expect(singles).toBe(2);
    expect(batches).toBe(0);
  });

  it("still gives every other wallet the single-prompt batch", async () => {
    let singles = 0;
    let batches = 0;
    const wallet = {
      walletName: "Solflare",
      signTransaction: async (transaction: VersionedTransaction) => {
        singles += 1;
        return signed(transaction);
      },
      signAllTransactions: async (transactions: VersionedTransaction[]) => {
        batches += 1;
        return transactions.map(signed);
      },
    } as unknown as SigningCapableWallet;

    const result = await signTransactions(wallet, [packed(0), packed(1)]);

    expect(result).toHaveLength(2);
    expect(singles).toBe(0);
    expect(batches).toBe(1);
  });

  it("passes a wallet's own refusal through untouched, not the timeout", async () => {
    const wallet = {
      signTransaction: async () => {
        throw new Error("User rejected the request");
      },
    } as unknown as SigningCapableWallet;

    await expect(signTransactions(wallet, [packed(0)])).rejects.toThrow(
      "User rejected the request",
    );
  });

  it("refuses a batch the wallet answers with fewer transactions than requested", async () => {
    // `submitTransactions` pairs signed[i] with packed[i], so a short answer
    // would silently shift the rest onto the wrong tokens.
    const wallet = {
      signAllTransactions: async (transactions: VersionedTransaction[]) => [
        signed(transactions[0]!),
      ],
    } as unknown as SigningCapableWallet;

    await expect(
      signTransactions(wallet, [packed(0), packed(1)]),
    ).rejects.toThrow(/returned 1 signed transaction for 2/);
  });
});

/**
 * The batch settle path.
 *
 * It used to treat **any** non-null status as a result, so a transaction seen
 * only as `processed` was removed from the watchlist and reported as landed.
 * `readStatus` (the one-transaction path) has always known better: processed is a
 * fork's working set, not a result. These pin the same rule for a batch, and the
 * final `getTransaction` read that keeps a lagging status poll from turning a
 * landed batch into "never included".
 */
describe("settling a batch", () => {
  const lastValidBlockHeight = 1_000_000;

  function signedPacked(index = 0): { meta: PackedTransaction; transaction: VersionedTransaction } {
    const meta = packed(index);
    const transaction = signed(
      VersionedTransaction.deserialize(base64ToBytes(meta.base64)),
    );
    return { meta, transaction };
  }

  it("keeps watching a processed-only transaction, then reads it back when the blockhash dies", async () => {
    const { meta, transaction } = signedPacked();
    let blockHeight = 1;
    let transactionReads = 0;
    const connection = {
      getBlockHeight: async () => blockHeight,
      sendRawTransaction: async () => {
        // The send consumed the window, so the settle loop must fall back to
        // reading the transaction itself.
        blockHeight = 2_000_000;
        return "sig";
      },
      getSignatureStatuses: async () => ({
        value: [{ err: null, confirmationStatus: "processed", confirmations: 0 }],
      }),
      getTransaction: async () => {
        transactionReads += 1;
        return { meta: { err: null } };
      },
    } as never;

    const results = await submitTransactions(
      connection,
      [transaction],
      [meta],
      {
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight,
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    // The processed status alone was not accepted; the chain was asked.
    expect(transactionReads).toBe(1);
  });

  it("accepts a confirmed status without asking for the transaction again", async () => {
    const { meta, transaction } = signedPacked();
    let transactionReads = 0;
    const connection = {
      getBlockHeight: async () => 1,
      sendRawTransaction: async () => "sig",
      getSignatureStatuses: async () => ({
        value: [{ err: null, confirmationStatus: "confirmed", confirmations: 1 }],
      }),
      getTransaction: async () => {
        transactionReads += 1;
        return null;
      },
    } as never;

    const results = await submitTransactions(
      connection,
      [transaction],
      [meta],
      {
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight,
      },
    );

    expect(results[0]?.ok).toBe(true);
    expect(transactionReads).toBe(0);
  });

  it("advances the progress bar as each transaction settles", async () => {
    const first = signedPacked(0);
    const second = signedPacked(1);
    let send = 0;
    const progress: Array<[number, number]> = [];

    const connection = {
      getBlockHeight: async () => 1,
      sendRawTransaction: async () => `sig-${(send += 1)}`,
      getSignatureStatuses: async (signatures: string[]) => ({
        value: signatures.map(() => ({
          err: null,
          confirmationStatus: "confirmed",
          confirmations: 1,
        })),
      }),
    } as never;

    const results = await submitTransactions(
      connection,
      [first.transaction, second.transaction],
      [first.meta, second.meta],
      {
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight,
      },
      (completed, total) => progress.push([completed, total]),
    );

    expect(results).toHaveLength(2);
    expect(progress).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });
});

describe("signTransactions — a wallet that returns different bytes", () => {
  // The last thing between a plan and the chain is the wallet's answer. A signed
  // transaction is not automatically the transaction that was requested, so the
  // message is compared before it is sent.
  const STRANGER = "9qDz4uC7M7oJdhCErKEtLzm4pkdjdc7uQAFggy5jYrmt";
  const GUARD_PROGRAM = "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV";

  const walletReturning = (
    mutate: (requested: VersionedTransaction) => VersionedTransaction,
  ): SigningCapableWallet =>
    ({
      signTransaction: async (transaction: VersionedTransaction) =>
        mutate(transaction),
    }) as unknown as SigningCapableWallet;

  function messageWith(instructions: TransactionInstruction[]): VersionedTransaction {
    return new VersionedTransaction(
      new TransactionMessage({
        payerKey: PublicKey.default,
        recentBlockhash: "11111111111111111111111111111111",
        instructions,
      }).compileToV0Message(),
    );
  }

  function packedWith(
    instructions: TransactionInstruction[],
  ): PackedTransaction {
    return {
      index: 0,
      base64: bytesToBase64(messageWith(instructions).serialize()),
      mints: [],
      sizeBytes: 0,
      instructionCount: instructions.length,
      includesRentReclaim: false,
      rentReclaimMints: [],
    };
  }

  const transferTo = (address: string): TransactionInstruction[] => [
    SystemProgram.transfer({
      fromPubkey: PublicKey.default,
      toPubkey: new PublicKey(address),
      lamports: 1,
    }),
  ];

  it("accepts a transaction the wallet stripped an account create out of", async () => {
    // Phantom drops the idempotent ATA create on a route whose account it treats
    // as existing. That cannot misdirect anything — the swap instruction is
    // byte-identical and still names the same destination — so refusing it only
    // blocks the user. A *new* ATA create is still refused below.
    const ata = new TransactionInstruction({
      programId: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
      keys: [
        { pubkey: PublicKey.default, isSigner: true, isWritable: true },
        { pubkey: PublicKey.default, isSigner: false, isWritable: true },
      ],
      data: Buffer.from([1]),
    });
    const transfer = transferTo(PublicKey.default.toBase58())[0]!;

    const call = signTransactions(
      walletReturning(() => signed(messageWith([transfer]))),
      [packedWith([ata, transfer])],
    );

    await expect(call).resolves.toHaveLength(1);
  });

  it("still refuses a transaction with an instruction the wallet added", async () => {
    const call = signTransactions(
      walletReturning(() => signed(messageWith(transferTo(STRANGER)))),
      [packed(0)],
    );

    await expect(call).rejects.toThrow(/not the one this app built/);
    await expect(call).rejects.toThrow(/System/);
  });

  it("refuses a transaction whose instruction was rewritten", async () => {
    // The theft this check exists for: the same instruction, the same length,
    // a different destination. Nothing else in the pipeline would notice.
    const call = signTransactions(
      walletReturning(() => signed(messageWith(transferTo(STRANGER)))),
      [packedWith(transferTo(PublicKey.default.toBase58()))],
    );

    await expect(call).rejects.toThrow(/instruction 1 \(System\) was changed or removed/);
  });

  it("accepts a compute-budget instruction the wallet put in front", async () => {
    // Phantom adds its priority-fee instruction ahead of the plan's own, which
    // shifts every index by one. A positional comparison called that "instruction
    // 1 was changed" and refused the signature; the instructions are unchanged.
    const wallet = new PublicKey(GUARD_PROGRAM);
    const added = new TransactionInstruction({
      programId: new PublicKey("ComputeBudget111111111111111111111111111111"),
      keys: [],
      data: Buffer.from([3, 0, 0, 0, 0, 0, 0, 0, 0]),
    });

    const call = signTransactions(
      walletReturning(() =>
        signed(
          messageWith([
            added,
            SystemProgram.transfer({
              fromPubkey: PublicKey.default,
              toPubkey: wallet,
              lamports: 1,
            }),
          ]),
        ),
      ),
      [
        packedWith([
          SystemProgram.transfer({
            fromPubkey: PublicKey.default,
            toPubkey: wallet,
            lamports: 1,
          }),
        ]),
      ],
    );

    await expect(call).resolves.toHaveLength(1);
  });

  it("still refuses a value program the wallet put in front", async () => {
    const call = signTransactions(
      walletReturning(() =>
        signed(
          messageWith([
            ...transferTo(STRANGER),
            ...transferTo(PublicKey.default.toBase58()),
          ]),
        ),
      ),
      [packedWith(transferTo(PublicKey.default.toBase58()))],
    );

    await expect(call).rejects.toThrow(/an added instruction calls System/);
  });

  it("accepts a read-only guard inserted between our instructions", async () => {
    const guard = new TransactionInstruction({
      programId: new PublicKey(GUARD_PROGRAM),
      keys: [],
      data: Buffer.from([9]),
    });
    const first = transferTo(PublicKey.default.toBase58())[0]!;
    const second = {
      ...transferTo(STRANGER)[0]!,
    };

    const call = signTransactions(
      walletReturning(() =>
        signed(messageWith([first, guard, second])),
      ),
      [packedWith([first, second])],
    );

    await expect(call).resolves.toHaveLength(1);
  });

  it("accepts a read-only guard instruction the wallet appended", async () => {
    const call = signTransactions(
      walletReturning(() =>
        signed(
          messageWith([
            new TransactionInstruction({
              programId: new PublicKey(GUARD_PROGRAM),
              // No accounts at all: it cannot read, write or sign for anything.
              keys: [],
              data: Buffer.from([1]),
            }),
          ]),
        ),
      ),
      [packed(0)],
    );

    await expect(call).resolves.toHaveLength(1);
  });

  it("accepts the transaction it was given, signed", async () => {
    const call = signTransactions(
      walletReturning((requested) => signed(requested)),
      [packed(0)],
    );

    await expect(call).resolves.toHaveLength(1);
  });
});
