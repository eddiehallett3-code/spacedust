import { describe, expect, it } from "vitest";
import type { PackedTransaction } from "@/types/sweep";
import type { SubmitResult } from "./submit";
import { signAndSubmitSequentially, type SequentialBatch } from "./sequential-submit";

/**
 * The bug this proves fixed: four cNFT burns were signed in a row and *then*
 * sent, which took longer than a blockhash lives, so all four came back
 * "blockhash expired".
 *
 * The properties worth pinning are ordering (a send happens before the next
 * signature), the refresh happening before an approval rather than after, and
 * the refusal when a refresh regroups the batch.
 */

function tx(index: number, mints = `mint-${index}`): PackedTransaction {
  return {
    index,
    base64: "",
    mints: [mints],
    sizeBytes: 0,
    instructionCount: 0,
    includesRentReclaim: false,
    rentReclaimMints: [],
  };
}

function batch(transactions: PackedTransaction[], blockhash = "bh-1"): SequentialBatch {
  return { packed: transactions, blockhash, lastValidBlockHeight: 100 };
}

const ok = (index: number): SubmitResult => ({
  index,
  ok: true,
  signature: `sig-${index}`,
  error: null,
  mints: [`mint-${index}`],
});

describe("signAndSubmitSequentially", () => {
  it("sends each transaction before asking for the next signature", async () => {
    const order: string[] = [];

    const result = await signAndSubmitSequentially({
      batch: batch([tx(0), tx(1), tx(2)]),
      refresh: async () => batch([tx(0), tx(1), tx(2)], "bh-2"),
      nearExpiry: async () => false,
      signOne: async (meta) => {
        order.push(`sign ${meta.index}`);
        return {} as never;
      },
      submitOne: async (_signed, meta) => {
        order.push(`send ${meta.index}`);
        return [ok(meta.index)];
      },
    });

    expect(order).toEqual([
      "sign 0",
      "send 0",
      "sign 1",
      "send 1",
      "sign 2",
      "send 2",
    ]);
    expect(result.submits.map((submit) => submit.index)).toEqual([0, 1, 2]);
  });

  it("refreshes the window before an approval, and signs the refreshed bytes", async () => {
    const signedBlockhashes: string[] = [];
    let window = "bh-1";

    await signAndSubmitSequentially({
      batch: batch([tx(0), tx(1)]),
      refresh: async () => {
        window = "bh-2";
        return batch([tx(0), tx(1)], window);
      },
      // The second approval is where the old window would have died.
      nearExpiry: async () => signedBlockhashes.length === 1,
      signOne: async () => {
        signedBlockhashes.push(window);
        return {} as never;
      },
      submitOne: async () => [ok(0)],
    });

    expect(signedBlockhashes).toEqual(["bh-1", "bh-2"]);
  });

  it("refuses to continue when a refresh regroups the batch", async () => {
    let sent = 0;

    await expect(
      signAndSubmitSequentially({
        batch: batch([tx(0), tx(1)]),
        // Same two assets, grouped into one transaction this time.
        refresh: async () => batch([{ ...tx(0), mints: ["mint-0", "mint-1"] }], "bh-2"),
        nearExpiry: async () => true,
        signOne: async () => ({}) as never,
        submitOne: async () => {
          sent += 1;
          return [ok(0)];
        },
      }),
    ).rejects.toThrow(/different set of transactions/i);

    // Nothing was sent under the regrouped batch.
    expect(sent).toBe(0);
  });

  it("keeps going after a failed send, so one bad burn does not strand the rest", async () => {
    const result = await signAndSubmitSequentially({
      batch: batch([tx(0), tx(1)]),
      refresh: async () => batch([tx(0), tx(1)]),
      nearExpiry: async () => false,
      signOne: async () => ({}) as never,
      submitOne: async (_signed, meta) =>
        meta.index === 0
          ? [{ index: 0, ok: false, signature: null, error: "nope", mints: ["mint-0"] }]
          : [ok(1)],
    });

    expect(result.submits.map((submit) => submit.ok)).toEqual([false, true]);
  });
});
