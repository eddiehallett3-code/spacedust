import type { VersionedTransaction } from "@solana/web3.js";
import type { PackedTransaction } from "@/types/sweep";
import type { SubmitResult } from "./submit";

/**
 * Sign and send a batch one transaction at a time.
 *
 * WHY THIS EXISTS. A blockhash lives about sixty seconds, and for a wallet that
 * prompts per transaction the approval *is* the cost: four cNFT burns meant four
 * approvals, so the batch was signed over a minute and then sent — and every
 * transaction in it was refused with "blockhash expired", because the only
 * moment that had a fresh window was the plan.
 *
 * So the order matters. Sign one, send it while the window is alive, and refresh
 * the window before the next approval rather than after it. Batch-signing
 * wallets keep the single-approval path; this is for the ones that ask once per
 * transaction.
 *
 * Re-packing is not re-planning: the instructions are byte-identical, only the
 * blockhash changes. For a cNFT burn that distinction is deliberate — a proof
 * fetched at plan time is still the proof this instruction carries, and
 * re-planning mid-run would change what the user already approved.
 */

/** The window a packed batch was built against. */
export interface SequentialBatch {
  packed: PackedTransaction[];
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface SequentialInput {
  batch: SequentialBatch;
  /** Re-pack the same instructions against a fresh blockhash. */
  refresh: () => Promise<SequentialBatch>;
  /** Is the current window too thin to start another approval? */
  nearExpiry: (batch: SequentialBatch) => Promise<boolean>;
  signOne: (packed: PackedTransaction) => Promise<VersionedTransaction>;
  submitOne: (
    signed: VersionedTransaction,
    packed: PackedTransaction,
    window: { blockhash: string; lastValidBlockHeight: number },
  ) => Promise<SubmitResult[]>;
  /** Called after each transaction has been sent, for the progress bar. */
  onProgress?: (completed: number, total: number) => void;
}

export interface SequentialResult {
  submits: SubmitResult[];
  /** The last batch used — its window is the one the tail was signed under. */
  batch: SequentialBatch;
}

/** Do two batches group the same assets into the same transactions? */
function sameGrouping(left: PackedTransaction[], right: PackedTransaction[]): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (transaction, index) =>
      (right[index]?.mints ?? []).join(",") === transaction.mints.join(","),
  );
}

export async function signAndSubmitSequentially(
  input: SequentialInput,
): Promise<SequentialResult> {
  let batch = input.batch;
  const total = batch.packed.length;
  const submits: SubmitResult[] = [];

  for (let index = 0; index < total; index += 1) {
    // Before the approval, not after it: the approval is what spends the window.
    if (await input.nearExpiry(batch)) {
      const fresh = await input.refresh();
      if (!sameGrouping(batch.packed, fresh.packed)) {
        // Refusing beats guessing. If the grouping moved, the indices no longer
        // line up with what was sent, and attributing an outcome to the wrong
        // asset is exactly the kind of quiet error this app does not make.
        throw new Error(
          "The batch was rebuilt into a different set of transactions part-way through, so the rest was not signed. Nothing further was sent.",
        );
      }
      batch = fresh;
    }

    const meta = batch.packed[index];
    if (!meta) continue;

    const signed = await input.signOne(meta);
    const settled = await input.submitOne(signed, meta, batch);
    submits.push(...settled);
    input.onProgress?.(index + 1, total);
  }

  return { submits, batch };
}
