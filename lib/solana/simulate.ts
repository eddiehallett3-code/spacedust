import { VersionedTransaction, type Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { base64ToBytes } from "@/lib/utils/base64";
import {
  BASE_FEE_LAMPORTS,
  COMPUTE_BUDGET_PROGRAM_ID,
  PRIORITY_FEE_MICRO_LAMPORTS,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@/lib/utils/constants";
import type { PackedTransaction, SimulationOutcome } from "@/types/sweep";

/**
 * Simulation.
 *
 * Every transaction is simulated before the user is ever asked to sign. This is
 * the single most important safety mechanism in the app: if a swap would fail —
 * no liquidity, a frozen account, a rent shortfall — we find out *before* the
 * user approves anything.
 *
 * The user is never charged, and never prompted, for a transaction we could
 * already tell would fail.
 */

/**
 * The loaded-account-data declaration in a transaction, if it has one.
 *
 * Used only to explain a `MaxLoadedAccountsDataSizeExceeded` failure: the error
 * means the accounts and program binaries the transaction loads are larger than
 * the limit it declared, so the limit is the one number that tells a stale
 * client bundle apart from a genuinely oversized transaction.
 */
function declaredLoadedDataLimit(
  transaction: VersionedTransaction,
): number | null {
  const message = transaction.message;
  if (!("compiledInstructions" in message)) return null;

  for (const instruction of message.compiledInstructions) {
    const programId = message.staticAccountKeys[instruction.programIdIndex];
    if (!programId || programId.toBase58() !== COMPUTE_BUDGET_PROGRAM_ID) {
      continue;
    }
    const bytes = instructionBytes(instruction.data);
    // SetLoadedAccountsDataSizeLimit: `[0x04, u32 little-endian]`.
    if (!bytes || bytes.length !== 5 || bytes[0] !== 0x04) continue;
    return new DataView(
      bytes.buffer,
      bytes.byteOffset + 1,
      4,
    ).getUint32(0, true);
  }

  return null;
}

/**
 * Add the declared limit to the one error where it is the answer.
 *
 * `MaxLoadedAccountsDataSizeExceeded` says "the transaction asked to load more
 * than it declared" and nothing else. Printing the declaration turns a dead end
 * into a diagnosis: 1,048,576 means the running bundle predates the 64 MiB fix;
 * anything else means a transaction genuinely loads more than we allowed.
 */
function explainLoadedDataFailure(
  message: string,
  limit: number | null,
): string {
  if (limit === null || !/MaxLoadedAccountsDataSizeExceeded/i.test(message)) {
    return message;
  }
  return `${message} This transaction declares a loaded-account-data limit of ${limit.toLocaleString()} bytes (${Math.round(
    limit / (1024 * 1024),
  )} MiB), and the accounts and program binaries it loads exceed that.`;
}

export async function simulateTransaction(
  connection: Connection,
  packed: PackedTransaction,
): Promise<SimulationOutcome> {
  let loadedDataLimit: number | null = null;

  try {
    const transaction = VersionedTransaction.deserialize(
      base64ToBytes(packed.base64),
    );
    loadedDataLimit = declaredLoadedDataLimit(transaction);

    const response = await connection.simulateTransaction(transaction, {
      // We have no signature yet and do not need one: we are verifying the
      // instruction logic, not the user's authorisation.
      sigVerify: false,
      // A fresh blockhash so a stale one cannot produce a false failure.
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    });

    const value = response.value;

    if (value.err) {
      return {
        index: packed.index,
        ok: false,
        unitsConsumed: value.unitsConsumed ?? null,
        error: explainLoadedDataFailure(
          describeInstructionFailure(value.err, packed, value.logs),
          loadedDataLimit,
        ),
        feeLamports: null,
        dryRun: true,
      };
    }

    return {
      index: packed.index,
      ok: true,
      unitsConsumed: value.unitsConsumed ?? null,
      error: null,
      // `simulateTransaction` does not return a fee, so we compute the exact
      // cost ourselves: base fee per required signature, plus the priority fee
      // implied by the compute limit and price we requested.
      feeLamports: estimateFeeLamports(transaction),
      dryRun: true,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Simulation request failed";
    return {
      index: packed.index,
      ok: false,
      unitsConsumed: null,
      error: explainLoadedDataFailure(message, loadedDataLimit),
      feeLamports: null,
      dryRun: true,
    };
  }
}

/** Simulate every packed transaction. */
export async function simulateAll(
  connection: Connection,
  packed: PackedTransaction[],
): Promise<SimulationOutcome[]> {
  const results: SimulationOutcome[] = [];
  for (const item of packed) {
    results.push(await simulateTransaction(connection, item));
  }
  return results;
}
/**
 * Read a compiled instruction's bytes.
 *
 * `@solana/web3.js` declares `CompiledInstruction.data` as a base58 *string*,
 * but at runtime it is a `Buffer`. Rather than cast blindly, handle both: a
 * string is base58-encoded and gets decoded, a typed array is used as-is.
 */
function instructionBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (typeof data === "string") {
    try {
      return bs58.decode(data);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Exact fee for a transaction we built.
 *
 * `simulateTransaction` does not report a fee, so we derive it from the two
 * components we control:
 *   base fee = 5000 lamports × required signatures
 *   priority = ceil(computeUnitLimit × microLamportsPerCU / 1_000_000)
 *
 * This matches what submission will actually be charged, which is what makes
 * the fee shown before signing trustworthy.
 *
 * NOTE: a v0 message stores its instructions under `compiledInstructions`.
 * There is no `instructions` property on `MessageV0` — reading that silently
 * yields `undefined`, which would drop the priority fee from the estimate
 * without any error.
 */
function estimateFeeLamports(transaction: VersionedTransaction): number {
  const message = transaction.message;
  const base = message.header.numRequiredSignatures * BASE_FEE_LAMPORTS;
  let priority = 0;

  // Every transaction we build is v0. Narrow away the legacy/v1 variants,
  // which do have an `instructions` field but a different shape.
  if (!("compiledInstructions" in message)) return base;

  for (const instruction of message.compiledInstructions) {
    const programId = message.staticAccountKeys[instruction.programIdIndex];
    if (!programId || programId.toBase58() !== COMPUTE_BUDGET_PROGRAM_ID) {
      continue;
    }
    const bytes = instructionBytes(instruction.data);
    if (!bytes) continue;

    // SetComputeUnitLimit is `[0x02, u32 little-endian]`.
    if (bytes.length === 5 && bytes[0] === 0x02) {
      const limit = new DataView(
        bytes.buffer,
        bytes.byteOffset + 1,
        4,
      ).getUint32(0, true);
      priority = Math.ceil((limit * PRIORITY_FEE_MICRO_LAMPORTS) / 1_000_000);
    }
  }

  return base + priority;
}

/**
 * Solana reports an instruction failure as `[index, code]`. Pull the index out
 * so we can tell the user which instruction in the packet was blamed.
 */
function instructionErrorIndex(err: unknown): number | null {
  // Two shapes reach us. A simulation result and a landed-failure status both
  // report `{ InstructionError: [index, detail] }`, while some sources hand
  // over the bare inner array `[index, detail]`. Accepting only the array meant
  // this returned null for every real failure — so the instruction context the
  // comment below promises never appeared, and a raw
  // `{"InstructionError":[2,{"Custom":17}]}` was shown to a user verbatim.
  const inner =
    err && typeof err === "object" && "InstructionError" in err
      ? (err as { InstructionError?: unknown }).InstructionError
      : err;
  const value = Array.isArray(inner) ? inner[0] : null;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * Describe a failure and name the instruction it happened on.
 *
 * The index is the single most useful thing Solana gives us: it turns an opaque
 * JSON blob into "instruction 5 of 6", which is how the "we closed an account
 * that does not exist" bug was tracked down. Works for both simulation errors
 * and transactions that landed and failed, which share the same shape.
 */
export function describeInstructionFailure(
  err: unknown,
  packed: PackedTransaction,
  logs?: string[] | null,
): string {
  const description = describeSimulationError(err, packed, logs);
  const index = instructionErrorIndex(err);
  if (index === null) return description;

  // Which program rejected it, named where we can. A bare `Custom: 6` means
  // different things in Token Metadata and in Core, so without this the reader
  // has to go and find out who was talking.
  const program = programIdAt(packed, index);
  const label = program ? PROGRAM_LABELS[program] : undefined;

  return `Instruction #${index + 1} of ${packed.instructionCount}${
    label ? ` (${label})` : ""
  } failed: ${description}`;
}

/**
 * Pull the useful text out of whatever Solana threw.
 *
 * Errors from web3.js are `Error` instances (`SendTransactionError`, say), and
 * `JSON.stringify` of an `Error` is `{}` — which would silently throw away the
 * only clue we have. Their `logs` array is often the richest source of detail,
 * so that gets folded in too.
 */
function rawErrorText(err: unknown, logs?: string[] | null): string {
  // Logs from *either* an explicit list or the error object itself. A
  // simulation returns its logs *beside* the error rather than inside it, and
  // they are the only place the failed program explains itself — the Anchor
  // error's own name, or the compression program's "Invalid root recomputed
  // from proof". Reading them only off `Error` instances dropped every one of
  // them, which is how a bare `{"InstructionError":[2,{"Custom":6001}]}` — three
  // different errors in three different programs — reached a user as the whole
  // message.
  const fromError =
    err instanceof Error ? (err as { logs?: unknown }).logs : null;
  const logText = [
    ...(Array.isArray(logs) ? logs : []),
    ...(Array.isArray(fromError) ? fromError : []),
  ]
    .filter((line): line is string => typeof line === "string")
    .join(" ");

  const base =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null
        ? JSON.stringify(err)
        : String(err);

  return logText ? `${base} ${logText}` : base;
}

/**
 * Turn Solana's terse simulation errors into something a user can act on.
 *
 * The raw error is always preserved at the end, because these are cryptic and
 * an unexpected value is the only clue when diagnosing a bug.
 */
/**
 * SPL Token program error codes, keyed by the number that reaches us on the wire.
 *
 * A `Custom` code is a number whose meaning comes from the program that raised
 * it — `17` is `AccountFrozen` for the token program and something else for
 * every other program — so these are only consulted when the failing
 * instruction really is a token instruction. Checked against the program's own
 * `TokenError` declaration order, which the existing `11` case below already
 * pinned.
 */
const TOKEN_PROGRAM_ERRORS: Record<number, string> = {
  0: "A token account sits below the rent-exempt minimum, so the token program refused to touch it. Rescan your wallet and try again.",
  4: "A token account belongs to a different wallet than the one we signed with. Rescan your wallet and try again.",
  17: "This token account is frozen by the mint's authority, so nothing can move out of it — not a swap, not a burn. Nothing was lost.",
  18: "This mint's decimals do not match the amount we were given. Rescan your wallet and try again.",
  19: "This token is a native-mint variant the token program will not move. Nothing was lost.",
};

/**
 * Which program owns instruction #index of a packed transaction.
 *
 * Needed to interpret a `Custom` code honestly. Guessing from the number alone
 * would be a confidently wrong answer, which is worse than the raw code.
 */
function programIdAt(packed: PackedTransaction, index: number): string | null {
  try {
    const transaction = VersionedTransaction.deserialize(
      base64ToBytes(packed.base64),
    );
    const instruction = transaction.message.compiledInstructions[index];
    if (!instruction) return null;
    return (
      transaction.message.staticAccountKeys[instruction.programIdIndex]?.toBase58() ??
      null
    );
  } catch {
    return null;
  }
}

/** Jupiter's program, for the mappings that are only ever about a swap. */
const JUPITER_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

/**
 * Names for the programs a failure can come from, so a message can say *who*
 * rejected the instruction. Two rounds of debugging were spent working out
 * which program owned a bare `Custom: 6` — the number means different things in
 * Token Metadata and in Core — and this removes that question entirely.
 */
const PROGRAM_LABELS: Record<string, string> = {
  [TOKEN_PROGRAM_ID]: "SPL Token",
  [TOKEN_2022_PROGRAM_ID]: "Token-2022",
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: "Token Metadata",
  BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY: "Bubblegum",
  cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK: "SPL Account Compression",
  CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d: "Metaplex Core",
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter",
};

/**
 * Metaplex error codes we can name, keyed by program and then code.
 *
 * Only the ones a burn can actually hit, and only when the failing program has
 * been resolved — `6` is `InvalidEditionKey` in Token Metadata and
 * `IncorrectAccount` in Core, so the number alone is not an answer.
 */
const METAPLEX_PROGRAM_ERRORS: Record<string, Record<number, string>> = {
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: {
    // `InvalidEditionKey`: a printed edition's burn needs its *master edition's*
    // accounts, and the builder derives them from the print's own mint — which
    // has no master edition. A real print hit exactly this on mainnet.
    6: "This NFT is a printed edition, and burning one needs its master edition's accounts, which this build does not send yet. Nothing was lost.",
  },
  CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d: {
    // `IncorrectAccount`: usually an asset whose collection does not match what
    // the scan reported.
    6: "Metaplex Core rejected an account in this burn — usually an asset whose collection does not match what was scanned. Rescan your wallet and try again.",
  },
};

export function describeSimulationError(
  err: unknown,
  packed: PackedTransaction,
  logs?: string[] | null,
): string {
  const raw = rawErrorText(err, logs);

  // Whole-transaction failures rather than per-instruction ones. A packed batch
  // of swaps can run out of compute, which is worth saying plainly.
  if (
    /ComputationalBudgetExceeded|computational budget exceeded/i.test(raw)
  ) {
    return `This batch ran out of compute. Sweep fewer tokens at a time. (${truncate(raw)})`;
  }
  if (/BlockhashNotFound|block height exceeded/i.test(raw)) {
    return "The transaction expired before it landed. Run the preview again and re-sign.";
  }

  // The token program's `InvalidAccountData` means it was handed an account it
  // cannot deserialise — in practice an address that holds no account at all.
  // Closing a re-derived ATA that was never created lands here, and it is the
  // single most confusing failure this app produces, so name it explicitly.
  if (/InvalidAccountData|invalid account data/i.test(raw)) {
    return `An account this transaction used does not exist or is not a valid token account. Rescan your wallet and try again. (${truncate(raw)})`;
  }
  if (/IncorrectProgramId/i.test(raw) || /incorrect program id/i.test(raw)) {
    return `A token account is owned by a different token program than the one we called. Rescan your wallet and try again. (${truncate(raw)})`;
  }
  // Custom 11 is the token program's `NonNativeHasBalance`: the account still
  // held a balance when we tried to close it.
  if (/"Custom":11\b/.test(raw)) {
    return `A token account still held a balance when we tried to close it. Rescan your wallet and try again. (${truncate(raw)})`;
  }
  // Any other token-program `Custom` code we can name. Resolved against the
  // program that actually raised it, because the number alone means nothing.
  const customCode = /"Custom":(\d+)/.exec(raw);
  if (customCode) {
    const failing = programIdAt(packed, instructionErrorIndex(err) ?? -1);
    if (failing === TOKEN_PROGRAM_ID || failing === TOKEN_2022_PROGRAM_ID) {
      const named = TOKEN_PROGRAM_ERRORS[Number(customCode[1])];
      if (named) return named;
    }
    // The same idea for the Metaplex programs: their codes overlap with each
    // other and with the token program's, so each is only ever named once the
    // program is known.
    const metaplex = failing ? METAPLEX_PROGRAM_ERRORS[failing] : undefined;
    const named = metaplex?.[Number(customCode[1])];
    // The raw detail is kept, as everywhere else: a named cause is a guess about
    // intent, and the program's own words are the evidence for it.
    if (named) return `${named} (${truncate(raw)})`;
  }
  if (/Instruction: TransferFailed|"Custom":0x1\b/.test(raw)) {
    return `A token transfer failed. This mint may be frozen, or a Token-2022 extension may be blocking the swap. (${truncate(raw)})`;
  }
  if (/AccountNotFound/i.test(raw)) {
    return `A token account no longer exists. Rescan your wallet and try again. (${truncate(raw)})`;
  }
  // A compressed NFT's burn carries a merkle proof, and that proof is only good
  // against the tree's current root. A tree that gains a leaf between the
  // indexer computing a proof and the transaction landing moves the root, and
  // the compression program then rejects the proof — phrased, unhelpfully, as
  // "Invalid root recomputed from proof".
  if (/concurrent merkle tree|Invalid root recomputed from proof/i.test(raw)) {
    return "This cNFT's proof no longer matches its tree: either the tree gained a leaf since the preview was built, or this leaf has already been burned and what still lists it is stale. Check the asset on Solscan — if it has no burn of its own, run the preview again.";
  }
  // `LeafIndexOutOfBounds` arrives as a 6008 from the compression program, and
  // 6008 is also a Bubblegum code, so the number alone is actively misleading.
  if (/LeafIndexOutOfBounds/i.test(raw)) {
    return "This cNFT's leaf index does not match its tree, which means the scan's data is stale. Rescan your wallet and try again.";
  }
  // 0x9b is Token Metadata's `LockedToken`: a pNFT locked or listed for sale
  // inside the owner's own wallet. The planner checks this before building, so
  // reaching here means the listing was created between the preview and the
  // signature.
  if (/"Custom":155\b/.test(raw) || /LockedToken/i.test(raw)) {
    return "This pNFT is locked or listed for sale, so only the current delegate can move it. Delist or unlock it, then try again.";
  }
  // Bubblegum's `PublicKeyMismatch` (6001): an account in the burn is not the
  // one the tree expects — which, for a cNFT, means the scan's record of the
  // tree or the leaf no longer matches the chain.
  if (/"Custom":6001\b/.test(raw) && /PublicKeyMismatch/i.test(raw)) {
    return "Bubblegum rejected an account in this burn: the tree or leaf no longer matches what the scan recorded. Rescan your wallet and try again.";
  }
  // The compression program's own 6001, which is a different error entirely —
  // named from the logs, because the number cannot tell the two apart.
  if (
    /"Custom":6001\b/.test(raw) &&
    /concurrent merkle tree|Invalid root recomputed from proof/i.test(raw)
  ) {
    return "This cNFT's merkle tree changed since the preview was built, so its proof no longer matches. Run the preview again — nothing was burned.";
  }
  if (/InsufficientFundsForFee/i.test(raw)) {
    return "Your wallet does not have enough SOL to cover network fees.";
  }
  if (/0x177|0x178|insufficient funds for rent/i.test(raw)) {
    return "The wallet cannot cover the rent needed to create an output account. Try sweeping into SOL instead.";
  }
  if (/InsufficientFunds|insufficient lamports/i.test(raw) && packed.includesRentReclaim) {
    return "A token account still held a balance when we tried to close it, so the sweep could not complete. Try sweeping fewer tokens at a time.";
  }
  // Jupiter's own codes, and only when Jupiter is the program that failed.
  //
  // These numbers are *not* unique to Jupiter: 6001 is also the compression
  // program's `ConcurrentMerkleTreeError` and Bubblegum's `PublicKeyMismatch`,
  // and an earlier version matched the bare number — which replaced a cNFT
  // burn's real merkle error with a price warning, twice, and swallowed the
  // cause both times.
  const failingProgram = programIdAt(packed, instructionErrorIndex(err) ?? -1);
  const fromJupiter =
    failingProgram === JUPITER_PROGRAM_ID || /jupiter/i.test(raw);

  if (
    fromJupiter &&
    /Slippage|SlippageToleranceExceeded|"Custom":6001\b/i.test(raw)
  ) {
    return "The price moved beyond your slippage tolerance, or this trade is too small for the pool to fill. Try again, or raise the tolerance in settings.";
  }
  if (fromJupiter && /"Custom":6002\b/.test(raw)) {
    return "This trade is too small for the available liquidity. Dust this thin usually cannot be swapped — The Void can reclaim its rent instead.";
  }
  return truncate(raw);
}

function truncate(value: string): string {
  // Long enough to keep the failed program's own sentence. At 200 the raw
  // detail was being cut off mid-word right where the useful part began, which
  // is how a Core failure arrived as `…({"InstructionError":[2,{"Custom":6}]} Program…`
  // and told nobody anything.
  return value.length > 400 ? `${value.slice(0, 400)}…` : value;
}