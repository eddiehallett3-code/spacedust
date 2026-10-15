import {
  VersionedTransaction,
  type BlockhashWithExpiryBlockHeight,
  type Connection,
  type VersionedTransaction as VTx,
} from "@solana/web3.js";
import { base64ToBytes } from "@/lib/utils/base64";
import { BLOCKHASH_EXPIRED_MESSAGE, isBlockhashExpired } from "./blockhash";
import {
  describeInstructionFailure,
  describeSimulationError,
} from "./simulate";
import type { PackedTransaction, TokenOutcome } from "@/types/sweep";

/**
 * Signing and submission.
 *
 * SECURITY: the only thing that ever produces a signature is the user's wallet
 * extension, invoked through the standard wallet adapter. Spacedust holds no
 * keys, has no keyring, and cannot sign anything on the user's behalf.
 */

export interface SubmitResult {
  index: number;
  ok: boolean;
  signature: string | null;
  error: string | null;
  mints: string[];
}

/**
 * A wallet capable of signing versioned transactions.
 *
 * Both methods are optional in the adapter contract, so we fail loudly rather
 * than silently doing nothing.
 */
export interface SigningCapableWallet {
  signTransaction?: <T extends VTx>(transaction: T) => Promise<T>;
  signAllTransactions?: <T extends VTx>(transactions: T[]) => Promise<T[]>;
}

/** True when at least one signature slot is still all zeroes. */
function isUnsigned(transaction: VTx): boolean {
  return !transaction.signatures.some((signature) =>
    signature.some((byte) => byte !== 0),
  );
}

/**
 * Ask the wallet to sign every transaction at once.
 *
 * `signAllTransactions` is used whenever there is more than one transaction:
 * it triggers a single approval flow in most wallets rather than N separate
 * prompts, which is the entire point of packing swaps together.
 */
export async function signTransactions(
  wallet: SigningCapableWallet,
  packed: PackedTransaction[],
): Promise<VTx[]> {
  const decoded = packed.map((item) =>
    VersionedTransaction.deserialize(base64ToBytes(item.base64)),
  );

  const single = wallet.signTransaction;
  const batch = wallet.signAllTransactions;

  if (decoded.length === 1 && single) {
    const signed = await single(decoded[0] as VTx);
    if (!signed || isUnsigned(signed)) {
      throw new Error("The wallet did not return a signed transaction.");
    }
    return [signed];
  }

  // Multiple transactions: prefer the batch call so most wallets show a single
  // approval rather than a queue of prompts. Fall back to signing each one.
  if (batch) {
    const signed = await batch(decoded as VTx[]);

    // Some wallets silently return the input unchanged when the user declines.
    // Detect that instead of broadcasting garbage.
    const unsigned = signed.findIndex(isUnsigned);
    if (unsigned !== -1) {
      throw new Error(
        `Transaction ${unsigned + 1} of ${signed.length} was not signed. Nothing was sent.`,
      );
    }
    return signed;
  }

  if (single) {
    const signed: VTx[] = [];
    for (let i = 0; i < decoded.length; i += 1) {
      const transaction = decoded[i];
      if (!transaction) continue;
      const result = await single(transaction);
      if (!result || isUnsigned(result)) {
        throw new Error(
          `Transaction ${i + 1} of ${decoded.length} was not signed. Nothing was sent.`,
        );
      }
      signed.push(result);
    }
    return signed;
  }

  throw new Error("This wallet cannot sign transactions.");
}

/** How long we keep settling once every transaction has been broadcast. */
const FINAL_SETTLE_MS = 20_000;
const POLL_GAP_MS = 1_500;

const NEVER_INCLUDED_MESSAGE =
  "This transaction was accepted by the network but never included before its blockhash expired, so it did not happen. Nothing was lost — run the preview again and sign promptly.";

const STILL_PENDING_MESSAGE =
  "This transaction was sent but has not been included yet, so it has not happened so far. It may still land — check the transaction link before retrying.";

/** Turn a chain status into a per-token result. */
function toResult(
  entry: { signature: string; meta: PackedTransaction },
  err: unknown,
): SubmitResult {
  if (err) {
    return {
      index: entry.meta.index,
      ok: false,
      signature: entry.signature,
      // The *real* on-chain error, not a shrug. A transaction can simulate
      // cleanly and still fail when it lands (a pool moves, a slippage bound
      // trips), and "failed on-chain" alone tells the user nothing about
      // whether it is worth retrying.
      error: describeInstructionFailure(err, entry.meta),
      mints: entry.meta.mints,
    };
  }
  return {
    index: entry.meta.index,
    ok: true,
    signature: entry.signature,
    error: null,
    mints: entry.meta.mints,
  };
}

/**
 * Get a verdict for every broadcast transaction, one batched poll per tick.
 *
 * `getSignatureStatuses` takes an array, so keeping an eye on twenty
 * transactions costs the same as watching one.
 *
 * Deliberately not `connection.confirmTransaction`: its blockhash strategy
 * blocks until the blockhash expires, so watching transaction 1 used to consume
 * the window that 2 and 3 still needed. Here everything is watched together and
 * polling stops early once each has resolved.
 *
 * Waiting is also only meaningful up to one point. Once the blockhash is dead a
 * transaction can never land, so "not found" stops being ambiguous and becomes
 * a real answer — the difference between telling someone "nothing was swapped"
 * and "maybe it was".
 */
async function settleSignatures(
  connection: Connection,
  inFlight: Array<{ signature: string; meta: PackedTransaction; encoded: Uint8Array }>,
  blockhashInfo: BlockhashWithExpiryBlockHeight,
): Promise<SubmitResult[]> {
  if (inFlight.length === 0) return [];

  const pending = new Map(inFlight.map((entry) => [entry.signature, entry]));
  const out: SubmitResult[] = [];
  const deadlineAt = Date.now() + FINAL_SETTLE_MS;

  for (;;) {
    const signatures = [...pending.keys()];

    let statuses: Array<{ err?: unknown } | null> = [];
    try {
      const response = await connection.getSignatureStatuses(signatures, {
        searchTransactionHistory: true,
      });
      statuses = response.value;
    } catch {
      // A failed status lookup is not evidence of anything. Keep asking.
    }

    // The reply is ordered to match the request, but only trust it if it came
    // back complete — otherwise a status could be attributed to the wrong
    // signature, which would be worse than not knowing.
    if (statuses.length === signatures.length) {
      signatures.forEach((signature, index) => {
        const status = statuses[index];
        if (!status) return;
        const entry = pending.get(signature);
        if (!entry) return;
        pending.delete(signature);
        out.push(toResult(entry, status.err ?? null));
      });
    }

    if (pending.size === 0) break;
    // Margin 0: the bare question, "can these still land at all?"
    if (await isBlockhashExpired(connection, blockhashInfo.lastValidBlockHeight, 0)) {
      break;
    }
    if (Date.now() >= deadlineAt) break;

    // Offer them again. Accepted by the network and dropped are the same thing
    // from here: a node takes the transaction, nothing re-propagates it, and a
    // signature that never reached a leader is indistinguishable from one that
    // has not been processed *yet*. This used to end in "sent but has not been
    // included" with an unknown outcome, which is the worst thing to tell
    // someone about a burn. Re-sending the identical bytes is the standard
    // remedy and cannot double-anything: the signature is the transaction's
    // identity, so however many times it is offered it lands at most once.
    //
    // Only a transaction that is actually stuck pays for this. One that lands
    // leaves `pending` on the first poll and never reaches here, so an ordinary
    // burn sends exactly once.
    for (const entry of pending.values()) {
      try {
        await connection.sendRawTransaction(entry.encoded, {
          // Preflight already passed when it was first accepted, and repeating
          // it would only re-verify what we know. The polling above is the
          // thing that decides the outcome.
          skipPreflight: true,
          maxRetries: 0,
        });
      } catch {
        // A rejected re-send proves nothing — the original may still be in
        // flight. The status poll decides, not this.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_GAP_MS));
  }

  const expired = await isBlockhashExpired(
    connection,
    blockhashInfo.lastValidBlockHeight,
    0,
  );
  for (const { signature, meta } of pending.values()) {
    out.push({
      index: meta.index,
      ok: false,
      signature,
      // The signature is kept so the summary can link it on Solscan — a
      // truncated signature in the message would be unverifiable.
      error: expired ? NEVER_INCLUDED_MESSAGE : STILL_PENDING_MESSAGE,
      mints: meta.mints,
    });
  }

  return out;
}

/**
 * What the chain says about one transaction.
 *
 * `not-included` means exactly that: no evidence it landed, and no evidence it
 * failed either. It is deliberately not spelled "failed".
 */
export type SettleVerdict =
  | { kind: "confirmed"; signature: string }
  | { kind: "failed"; signature: string; err: unknown }
  | { kind: "not-included"; signature: string };

/** One status lookup, reduced to the three answers that matter. */
async function readStatus(
  connection: Connection,
  signature: string,
): Promise<SettleVerdict | null> {
  try {
    const response = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = response.value[0];
    if (!status) return null;
    if (status.err) return { kind: "failed", signature, err: status.err };
    // `confirmations === null` means finalized; an explicit status is the same
    // news. "processed" is deliberately *not* enough — it is not in a block yet.
    if (
      status.confirmationStatus === "confirmed" ||
      status.confirmationStatus === "finalized" ||
      status.confirmations === null
    ) {
      return { kind: "confirmed", signature };
    }
    return null;
  } catch {
    // A failed lookup is not evidence of anything.
    return null;
  }
}

/**
 * Wait for one transaction to be included, and never call it failed without
 * asking the chain first.
 *
 * WHY THIS EXISTS, in the form of the failure it fixes: `confirmTransaction`
 * with a blockhash strategy does not return when a transaction *confirms* — it
 * throws `TransactionExpiredBlockheightExceededError` once the blockhash's
 * lifetime passes. On the send it was used for, that surfaced as
 * *"Signature 3Bwp… has expired: block height exceeded"* for a transfer that had
 * already been **finalized**. The lamports had arrived; the app said it failed,
 * and because the failure left the destination unverified, it also disabled the
 * buttons that would have let the user continue.
 *
 * So this encodes one rule: **an expired blockhash ends our wait, not the
 * transaction.** Before anything is reported, the signature is looked up — with
 * `searchTransactionHistory`, because a transaction can be older than the RPC's
 * recent cache — and if that finds nothing, the transaction itself is read back.
 * Only a signature that is genuinely absent from the chain comes back as
 * `not-included`, and the caller is expected to say precisely that rather than
 * "failed".
 *
 * The batch path has always worked this way (`settleSignatures` below); this is
 * the same rule, for one transaction.
 */
export async function settleTransaction(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
  options: { timeoutMs?: number } = {},
): Promise<SettleVerdict> {
  const deadlineAt = Date.now() + (options.timeoutMs ?? FINAL_SETTLE_MS);

  for (;;) {
    const verdict = await readStatus(connection, signature);
    if (verdict) return verdict;

    if (Date.now() >= deadlineAt) break;
    // Margin 0: the bare question, "can this still land at all?" A failure to
    // read the height counts as "no", so an RPC hiccup never cuts the wait short.
    if (await isBlockhashExpired(connection, lastValidBlockHeight, 0)) break;

    await new Promise((resolve) => setTimeout(resolve, POLL_GAP_MS));
  }

  // The status poll can miss a transaction that exists — a node restarted, a
  // replica lagged, the signature aged out of a recent cache. Read the
  // transaction itself before saying anything about it.
  try {
    const transaction = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!transaction) return { kind: "not-included", signature };
    if (transaction.meta?.err) {
      return { kind: "failed", signature, err: transaction.meta.err };
    }
    return { kind: "confirmed", signature };
  } catch {
    return { kind: "not-included", signature };
  }
}

/**
 * Broadcast every signed transaction, then settle them all.
 *
 * Timings matter more than ordering here. The whole batch is signed with ONE
 * blockhash, so the scarce resource is the ~150-slot window — and anything slow
 * before a send is window that send will never get. So sends happen first and
 * back-to-back, and watching happens afterwards, together.
 *
 * This used to send-then-confirm one at a time, which was actively harmful:
 * `confirmTransaction`'s blockhash strategy blocks until the blockhash expires,
 * so waiting on transaction 1 consumed the window transactions 2 and 3 needed.
 * Three swaps, three different outcomes, one batch.
 *
 * Several transactions in flight at once is safe because each is self-contained.
 * Every packed transaction carries its own `CreateIdempotent` for the output ATA
 * in its setup and its own `closeAccount` for it in its cleanup — verified
 * against a taker whose ATA provably did not exist, so Jupiter adds the create
 * unconditionally rather than only when the account is missing. Whichever order
 * they land in, each recreates what it needs before using it and closes only
 * what it created.
 */
export async function submitTransactions(
  connection: Connection,
  signed: VTx[],
  packed: PackedTransaction[],
  blockhashInfo: BlockhashWithExpiryBlockHeight,
  onProgress?: (completed: number, total: number) => void,
): Promise<SubmitResult[]> {
  const results: SubmitResult[] = [];
  /** Broadcast and awaiting a verdict. */
  const inFlight: Array<{
    signature: string;
    meta: PackedTransaction;
    encoded: Uint8Array;
  }> = [];

  // ── Phase 1: get everything on the wire, fast ─────────────────────────────
  onProgress?.(0, signed.length);

  for (let i = 0; i < signed.length; i += 1) {
    const transaction = signed[i];
    const meta = packed[i];
    if (!transaction || !meta) continue;

    // Once the blockhash is within the safety margin, this transaction and
    // every one after it is either rejected or — worse — accepted and then
    // dropped without ever being included. Report the remainder in one pass.
    if (await isBlockhashExpired(connection, blockhashInfo.lastValidBlockHeight)) {
      for (let rest = i; rest < signed.length; rest += 1) {
        const restMeta = packed[rest];
        if (!restMeta) continue;
        results.push({
          index: restMeta.index,
          ok: false,
          signature: null,
          error: BLOCKHASH_EXPIRED_MESSAGE,
          mints: restMeta.mints,
        });
      }
      break;
    }

    try {
      // `sendRawTransaction` rather than the adapter's `sendTransaction`,
      // because we have already signed. It also gives us control over retries
      // and preflight, which matters on a free RPC with variable latency.
      // Serialized once and kept. If this never lands, the same bytes are
      // offered again while we wait — reconstructed from the signed
      // transaction, never re-signed.
      const encoded = transaction.serialize();
      const signature = await connection.sendRawTransaction(encoded, {
        // Preflight catches a doomed transaction before it costs a fee.
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      });
      inFlight.push({ signature, meta, encoded });
    } catch (error) {
      // Preflight is on, so a rejection here means it was never forwarded.
      // This one genuinely did not happen.
      results.push({
        index: meta.index,
        ok: false,
        signature: null,
        error: describeSimulationError(error, meta),
        mints: meta.mints,
      });
    }
  }

  // ── Phase 2: settle them all together ─────────────────────────────────────
  results.push(...(await settleSignatures(connection, inFlight, blockhashInfo)));
  onProgress?.(signed.length, signed.length);

  // Deterministic order for the summary, regardless of which settled first.
  return results.sort((a, b) => a.index - b.index);
}

/** Per-token metadata needed to render the summary rows. */
export interface OutcomeMeta {
  mint: string;
  symbol: string;
  logoUri: string | null;
  valueUsd: number;
  inputAmount: string;
  outAmount: string;
  priceImpactPct: number | null;
  routeLabels: string[];
  /** Mints whose ATA this transaction closes, so rent can be attributed. */
  rentReclaimMints: string[];
}

/**
 * Map submission results onto the per-token outcomes shown in the summary.
 *
 * Because we packed the swaps ourselves we know exactly which mints rode in
 * which transaction, so a batch result can be attributed back to individual
 * tokens rather than reported as one opaque success or failure.
 */
export function buildTokenOutcomes(
  submits: SubmitResult[],
  meta: OutcomeMeta[],
  outputDecimals: number,
): TokenOutcome[] {
  const byMint = new Map<string, SubmitResult>();
  for (const submit of submits) {
    for (const mint of submit.mints) {
      // First writer wins; a mint appears in exactly one transaction anyway.
      if (!byMint.has(mint)) byMint.set(mint, submit);
    }
  }

  return meta.map((token) => {
    const submit = byMint.get(token.mint);
    const succeeded = submit?.ok === true;
    const outputValue = Number(token.outAmount) / 10 ** outputDecimals;

    return {
      mint: token.mint,
      symbol: token.symbol,
      logoUri: token.logoUri,
      status: succeeded ? "success" : "failed",
      signature: submit?.signature ?? null,
      valueUsd: token.valueUsd,
      inputAmount: token.inputAmount,
      outputAmount: succeeded ? token.outAmount : null,
      outputAmountFormatted:
        succeeded && Number.isFinite(outputValue) ? outputValue : null,
      priceImpactPct: token.priceImpactPct,
      routeLabels: token.routeLabels,
      error: succeeded ? null : (submit?.error ?? "Not submitted"),
      // True only when this token's ATA was actually closed in the same flow.
      rentReclaimed: succeeded && token.rentReclaimMints.includes(token.mint),
    };
  });
}

/** Solscan deep-link for a transaction signature. */
export function solscanTxUrl(signature: string): string {
  return `https://solscan.io/tx/${encodeURIComponent(signature)}`;
}

/** Solscan deep-link for a token mint. */
export function solscanMintUrl(mint: string): string {
  return `https://solscan.io/token/${encodeURIComponent(mint)}`;
}

/** Solscan deep-link for an account address — a token account, say. */
export function solscanAccountUrl(address: string): string {
  return `https://solscan.io/account/${encodeURIComponent(address)}`;
}
