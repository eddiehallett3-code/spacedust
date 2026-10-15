import { describe, expect, it } from "vitest";
import { settleTransaction, type SettleVerdict } from "./submit";

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
