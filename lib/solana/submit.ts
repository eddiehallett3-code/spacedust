import {
  VersionedTransaction,
  type BlockhashWithExpiryBlockHeight,
  type Connection,
  type VersionedTransaction as VTx,
} from "@solana/web3.js";
import { base64ToBytes } from "@/lib/utils/base64";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@/lib/utils/constants";
import { programLabel } from "@/lib/security/program-ids";
import { BLOCKHASH_EXPIRED_MESSAGE, isBlockhashExpired } from "./blockhash";
import {
  describeInstructionFailure,
  describeSimulationError,
  instructionBytes,
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
  /**
   * The adapter's display name.
   *
   * Kept as context for diagnostics, and it decides one thing: a wallet whose
   * name contains "Phantom" is signed one transaction at a time. Phantom's
   * scanner refuses a batched approval outright — see `signTransactions` — so the
   * batch path is withheld from it even though the adapter offers it. Every
   * other wallet with `signAllTransactions` keeps the single-prompt batch.
   */
  walletName?: string;
}

/** True when at least one signature slot is still all zeroes. */
function isUnsigned(transaction: VTx): boolean {
  return !transaction.signatures.some((signature) =>
    signature.some((byte) => byte !== 0),
  );
}

/**
 * Does Phantom get a batched approval?
 *
 * `true` while we re-test after Phantom's domain review. Their support confirmed
 * the warning should no longer appear, which may also have changed how a
 * `signAllTransactions` request is treated. That request is what was refused
 * before ("request blocked", flagged as malicious) while the same transactions
 * signed individually were accepted — so this is the one question the review may
 * have answered, and it is worth one prompt instead of three if it has.
 *
 * Flip to `false` the moment a batched approval is refused again: with it on and
 * the block still in place, Phantom users cannot sign anything at all. The test
 * below covers whichever value is set, so neither state ships unexamined.
 */
export const PHANTOM_USES_BATCH = true;

/** Programs a wallet may not *add* to a transaction it returns.
 *
 * A wallet is entitled to add its own guard instructions — Phantom appends
 * Lighthouse assertions, which read account state and abort on a mismatch — and
 * to add a compute-budget instruction of its own. It is not entitled to add
 * anything that moves value, which on Solana means System, the token programs, or
 * an account create.
 *
 * Note what is *not* checked: writability. Solana marks an account writable for
 * the whole message, not per instruction, so a read-only Lighthouse assertion on
 * an account the swap writes to reports as writable by construction. Using that
 * as a rule refused Phantom's guards every time; the only reliable statement about
 * an added instruction is which program it calls.
 */
const UNINVITED_PROGRAMS = new Set<string>([
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
]);

/** One compiled instruction, as this comparison reads it. */
interface CompiledInstructionView {
  programIdIndex: number;
  accountKeyIndexes: ReadonlyArray<number>;
  data: unknown;
}

/** The parts of a compiled message this comparison reads, across versions. */
interface CompiledMessageView {
  recentBlockhash: string;
  staticAccountKeys: ReadonlyArray<{ toBase58(): string }>;
  compiledInstructions: ReadonlyArray<CompiledInstructionView>;
  addressTableLookups?: ReadonlyArray<unknown>;
}

function bytesEqual(a: unknown, b: unknown): boolean {
  const left = instructionBytes(a);
  const right = instructionBytes(b);
  if (!left || !right || left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}

/**
 * Why a signed transaction is not the one that was built, or null when it is.
 *
 * The wallet is the last thing between a plan and the chain, and a returned
 * transaction is not automatically the transaction that was asked for: an
 * adapter — or a remote WalletConnect peer — can hand back different bytes with a
 * signature attached, and `sendRawTransaction` would broadcast them.
 *
 * Instructions are matched by **meaning**, not by position: same program, same
 * data bytes, same accounts by public key. A wallet rebuilds the message to insert
 * its own compute-budget instruction or to prune an account create, and rebuilding
 * renumbers the account keys — so a byte-identical swap arrives with different
 * indices. Positional comparison produced three false refusals; resolved-key
 * comparison cannot.
 *
 * Instructions a wallet *adds* are allowed only if they cannot do anything: they
 * must name no writable account and no signer, and must not call a program that
 * moves value.
 */
function modificationReason(requested: VTx, returned: VTx): string | null {
  try {
    const built = requested.message as unknown as CompiledMessageView;
    const signed = returned.message as unknown as CompiledMessageView;

    if (returned.signatures.length !== requested.signatures.length) {
      return "it carries a different number of signatures";
    }
    if (signed.recentBlockhash !== built.recentBlockhash) {
      return "it references a different blockhash";
    }
    if (
      signed.staticAccountKeys[0]?.toBase58() !==
      built.staticAccountKeys[0]?.toBase58()
    ) {
      return "it is paid for by a different account";
    }
    if (
      (signed.addressTableLookups?.length ?? 0) !==
      (built.addressTableLookups?.length ?? 0)
    ) {
      return "it uses a different set of address lookup tables";
    }

    const builtInstructions = built.compiledInstructions;
    const signedInstructions = signed.compiledInstructions;

    // Compute-budget instructions are excluded from the comparison entirely, on
    // both sides. They have no accounts, so they cannot move anything, and the
    // fee they set is disclosed by the wallet's own approval sheet. Meanwhile
    // Phantom both adds one ahead of the plan's and can rewrite the plan's own
    // when its priority-fee setting changes — either of which would otherwise be
    // reported as a tampered transaction and block the signature. What this guard
    // exists to protect is value and authority, and no compute-budget instruction
    // can touch either.
    const isComputeBudget = (
      message: CompiledMessageView,
      instruction: { programIdIndex: number },
    ): boolean =>
      message.staticAccountKeys[instruction.programIdIndex]?.toBase58() ===
      COMPUTE_BUDGET_PROGRAM_ID;

    // Every instruction we built must appear, unchanged, in order — matched by the
    // accounts it names and the data it carries, *not* by its compiled indices.
    //
    // Indices cannot be trusted across a wallet's edit. Phantom rebuilds the
    // message when it inserts a compute-budget instruction or prunes an account
    // create it thinks is redundant, and rebuilding renumbers the account keys —
    // so a byte-identical Jupiter swap can arrive with every index shifted. Three
    // separate false refusals came from comparing positions rather than meaning.
    const resolveKey = (
      message: CompiledMessageView,
      index: number,
    ): string | null => message.staticAccountKeys[index]?.toBase58() ?? null;

    const sameInstruction = (
      a: CompiledInstructionView,
      b: CompiledInstructionView,
    ): boolean => {
      const builtProgram = resolveKey(built, a.programIdIndex);
      const signedProgram = resolveKey(signed, b.programIdIndex);
      if (!builtProgram || builtProgram !== signedProgram) return false;
      if (a.accountKeyIndexes.length !== b.accountKeyIndexes.length) return false;
      if (!bytesEqual(a.data, b.data)) return false;
      for (let position = 0; position < a.accountKeyIndexes.length; position += 1) {
        const left = resolveKey(built, a.accountKeyIndexes[position]!);
        const right = resolveKey(signed, b.accountKeyIndexes[position]!);
        // An account held in an address lookup table cannot be resolved from the
        // message alone. The count and the data still match, and every account the
        // message *can* name must — which covers the ones that matter: the wallet's
        // own token account, the mint, and the destination.
        if (left && right && left !== right) return false;
      }
      return true;
    };

    let cursor = 0;
    const matched = new Set<number>();
    for (let index = 0; index < builtInstructions.length; index += 1) {
      const before = builtInstructions[index];
      if (!before) return "an instruction could not be read";
      if (isComputeBudget(built, before)) continue;

      let found = -1;
      for (let candidate = cursor; candidate < signedInstructions.length; candidate += 1) {
        const after = signedInstructions[candidate];
        if (!after) continue;
        if (sameInstruction(before, after)) {
          found = candidate;
          break;
        }
      }

      if (found === -1) {
        const programId = built.staticAccountKeys[before.programIdIndex]?.toBase58();
        // An Associated Token *create* may be dropped by the wallet, and that is
        // tolerated rather than treated as tampering. It creates an account whose
        // owner and payer the pre-signing audit already pinned to the wallet, so
        // removing it cannot move value or redirect anything: the swap's own
        // instruction is byte-identical and still names the same destination, so
        // the worst case is a transaction that fails on chain and costs a fee.
        //
        // Added ones are still refused below — a wallet inventing an account for
        // the user to pay for is either a bug or a charge they never approved.
        if (programId === ASSOCIATED_TOKEN_PROGRAM_ID) continue;
        return `instruction ${index + 1}${programId ? ` (${programLabel(programId)})` : ""} was changed or removed`;
      }
      cursor = found + 1;
      matched.add(found);
    }

    // Anything in the returned list that we did not build has to be inert: it may
    // read accounts and abort, but it may not name a writable or signer account,
    // and it may not call a program that moves value.
    for (
      let index = 0;
      index < signedInstructions.length;
      index += 1
    ) {
      if (matched.has(index)) continue;
      const added = signedInstructions[index];
      if (!added) return "an added instruction could not be read";
      if (isComputeBudget(signed, added)) continue;
      const programId =
        signed.staticAccountKeys[added.programIdIndex]?.toBase58();
      if (!programId) {
        return "an added instruction calls a program that is not a static account key";
      }
      if (UNINVITED_PROGRAMS.has(programId)) {
        return `an added instruction calls ${programLabel(programId)}`;
      }
    }
  } catch {
    return "its message could not be read";
  }

  return null;
}

/**
 * Refuse a signature over anything but the transaction that was built.
 *
 * Runs on every path — one transaction or a batch — before a single byte is sent.
 */
function assertUnmodified(requested: readonly VTx[], signed: readonly VTx[]): void {
  signed.forEach((transaction, index) => {
    const built = requested[index];
    if (!built) return;
    const reason = modificationReason(built, transaction);
    if (reason) {
      throw new Error(
        `The wallet returned a transaction that is not the one this app built: ${reason}. Nothing was sent, and no funds left your wallet.`,
      );
    }
  });
}

/**
 * How long to wait for a wallet to answer a signing request.
 *
 * The mobile wallet SDK has a timeout of its own, but it only covers the
 * *association* — opening the wallet and letting it attach. Once a wallet has
 * attached, a request it never answers waits **forever**: the promise never
 * rejects and never resolves, so the app has nothing to report and no state to
 * leave. That is the exact shape of a wallet that opens and shows no approval
 * prompt, and it left the sweep sitting on "waiting for you" indefinitely with
 * no way to tell whether a transaction existed at all.
 *
 * Generous on purpose. A real approval includes unlocking a phone and reading
 * what is being signed, so this is a stuck detector, not a hurry — the only
 * thing it must not do is mistake a slow human for a broken channel.
 */
export const SIGNING_TIMEOUT_MS = 180_000;

/**
 * A wallet accepted a request and never answered it.
 *
 * Distinct from a rejection: nothing was declined, nothing was sent, and the
 * wallet may still be holding the request. Recognised by name in
 * `lib/utils/errors.ts`, which turns it into advice.
 */
export class SigningTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(
      `The wallet did not answer the signing request within ${Math.round(timeoutMs / 1000)} seconds. Nothing was sent.`,
    );
    this.name = "SigningTimeoutError";
  }
}

/**
 * Reject if `call` has not settled inside the signing window.
 *
 * Only the *wait* is abandoned: the wallet call itself is not cancelled, because
 * nothing here can cancel it. That is safe — a signature produced after we stop
 * waiting is never broadcast, so an abandoned request cannot move funds.
 */
async function withSigningTimeout<T>(call: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new SigningTimeoutError(SIGNING_TIMEOUT_MS)),
          SIGNING_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the wallet to sign the packed transactions.
 *
 * Phantom gets **one transaction at a time**; other wallets with
 * `signAllTransactions` still get their single-prompt batch.
 *
 * That exception is not a preference, it is the difference between a sweep
 * working and not. Observed on Phantom against a production build: a batch
 * approval is refused by its transaction scanner ("request blocked", flagged as
 * malicious) even when the batch contains nothing but routine Jupiter swaps —
 * while the same wallet signs the *same* transactions one at a time without a
 * warning, and a single-transaction sweep was never flagged at all. Phantom's
 * guidance is to hand it one transaction so it can simulate exactly what is being
 * approved; a batch loses that, and its generic warning is the result.
 *
 * So the cost of this branch is extra approval prompts for Phantom users, and
 * the cost of not having it is that Phantom users cannot sweep at all.
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
  // Case-insensitive substring: adapter names reach us as "Phantom",
  // "Phantom Wallet", and whatever the next release calls itself.
  const preferSingle =
    !PHANTOM_USES_BATCH &&
    wallet.walletName?.toLowerCase().includes("phantom") === true &&
    single !== undefined;

  if (decoded.length === 1 && single) {
    const signed = await withSigningTimeout(() => single(decoded[0] as VTx));
    if (!signed || isUnsigned(signed)) {
      throw new Error("The wallet did not return a signed transaction.");
    }
    assertUnmodified(decoded, [signed]);
    return [signed];
  }

  // Multiple transactions: use the batch call whenever it exists — except
  // Phantom, which is signed per transaction above — so most wallets show a
  // single approval rather than a queue of prompts.
  if (batch && !preferSingle) {
    const signed = await withSigningTimeout(() => batch(decoded as VTx[]));

    // A wallet must answer with one transaction per request, in the same order.
    // A shorter (or longer) answer would silently drop or mis-pair transactions:
    // `submitTransactions` pairs signed[i] with packed[i], so a missing entry
    // must stop the batch rather than shift the rest onto the wrong tokens.
    if (!Array.isArray(signed) || signed.length !== decoded.length) {
      const count = Array.isArray(signed) ? signed.length : 0;
      throw new Error(
        `The wallet returned ${
          Array.isArray(signed) ? count : "no"
        } signed transaction${count === 1 ? "" : "s"} for ${
          decoded.length
        }. Nothing was sent.`,
      );
    }

    // Some wallets silently return the input unchanged when the user declines.
    // Detect that instead of broadcasting garbage.
    const unsigned = signed.findIndex(isUnsigned);
    if (unsigned !== -1) {
      throw new Error(
        `Transaction ${unsigned + 1} of ${signed.length} was not signed. Nothing was sent.`,
      );
    }
    assertUnmodified(decoded, signed);
    return signed;
  }

  if (single) {
    const signed: VTx[] = [];
    for (let i = 0; i < decoded.length; i += 1) {
      const transaction = decoded[i];
      if (!transaction) continue;
      const result = await withSigningTimeout(() => single(transaction));
      if (!result || isUnsigned(result)) {
        throw new Error(
          `Transaction ${i + 1} of ${decoded.length} was not signed. Nothing was sent.`,
        );
      }
      signed.push(result);
    }
    if (signed.length !== decoded.length) {
      throw new Error(
        `The wallet signed ${signed.length} of ${decoded.length} transactions. Nothing was sent.`,
      );
    }
    assertUnmodified(decoded, signed);
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
 * Is this status a result, or merely a sighting?
 *
 * `processed` is not a result: the transaction is in a fork's working set and
 * can still disappear, so the batch poll must keep watching it. `confirmed`,
 * `finalized`, and a null `confirmations` (how RPCs that omit
 * `confirmationStatus` spell finalized) are results. A reported error is final
 * in either direction — a failed transaction cannot later succeed.
 *
 * `readStatus` below has always made this distinction for one transaction; the
 * batch path used to treat every non-null status as settled, so a
 * processed-only transaction was removed from the watchlist and reported as
 * landed without ever being confirmed.
 */
function isSettledStatus(status: {
  err?: unknown;
  confirmationStatus?: string;
  confirmations?: number | null;
}): boolean {
  if (status.err != null) return true;
  return (
    status.confirmationStatus === "confirmed" ||
    status.confirmationStatus === "finalized" ||
    status.confirmations === null
  );
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
  onSettled?: () => void,
): Promise<SubmitResult[]> {
  if (inFlight.length === 0) return [];

  const pending = new Map(inFlight.map((entry) => [entry.signature, entry]));
  const out: SubmitResult[] = [];
  const deadlineAt = Date.now() + FINAL_SETTLE_MS;

  for (;;) {
    const signatures = [...pending.keys()];

    let statuses: Array<{
      err?: unknown;
      confirmationStatus?: string;
      confirmations?: number | null;
    } | null> = [];
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
        // Keep watching a processed-only transaction; it is not final yet.
        if (!isSettledStatus(status)) return;
        const entry = pending.get(signature);
        if (!entry) return;
        pending.delete(signature);
        out.push(toResult(entry, status.err ?? null));
        onSettled?.();
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
    // The status poll can miss a transaction that landed — a lagging replica, a
    // restarted node, a signature that aged out of a recent cache — so ask for
    // the transaction itself before reporting a negative. This is the rule
    // `settleTransaction` already applies to one transaction; the batch path
    // used to skip straight to "never included".
    let onChain: Awaited<ReturnType<Connection["getTransaction"]>> = null;
    try {
      onChain = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    } catch {
      onChain = null;
    }

    if (onChain) {
      out.push(toResult({ signature, meta }, onChain.meta?.err ?? null));
      onSettled?.();
      continue;
    }

    out.push({
      index: meta.index,
      ok: false,
      signature,
      // The signature is kept so the summary can link it on Solscan — a
      // truncated signature in the message would be unverifiable.
      error: expired ? NEVER_INCLUDED_MESSAGE : STILL_PENDING_MESSAGE,
      mints: meta.mints,
    });
    onSettled?.();
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

  let completed = 0;
  /** Advance once per transaction, whether it sent or was rejected outright. */
  const reportSettled = (): void => {
    completed = Math.min(completed + 1, signed.length);
    onProgress?.(completed, signed.length);
  };

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
        reportSettled();
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
      reportSettled();
    }
  }

  // ── Phase 2: settle them all together ─────────────────────────────────────
  results.push(
    ...(await settleSignatures(
      connection,
      inFlight,
      blockhashInfo,
      reportSettled,
    )),
  );
  if (completed < signed.length) {
    onProgress?.(signed.length, signed.length);
  }

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
