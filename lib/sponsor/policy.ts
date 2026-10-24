import { VersionedTransaction, type VersionedMessage } from "@solana/web3.js";
import {
  BASE_FEE_LAMPORTS,
  COMPUTE_BUDGET_PROGRAM_ID,
  PRIORITY_FEE_MICRO_LAMPORTS,
  SYSTEM_PROGRAM_ID,
} from "@/lib/utils/constants";
import { FLOW_PROGRAMS } from "@/lib/security/program-ids";

/**
 * Fee-sponsor policy — the rules a transaction must satisfy before Spacedust
 * will add its signature to it.
 *
 * This is the whole security model of the sponsor, and it is deliberately
 * readable in one sitting. The server holds one key, that key can do exactly one
 * thing (pay a network fee), and it is repaid in the same transaction out of the
 * rent that transaction releases. Nothing here trusts the client: every fact is
 * re-derived from the bytes that will be broadcast.
 *
 * The residual risk is bounded, not hypothetical, and it is stated here so it is
 * not discovered later:
 *
 *  - A sponsored transaction that lands and *fails* still pays its fee, and the
 *    repayment with it rolls back. The server refuses anything its own
 *    simulation rejects, and the balance floor below caps the total at the
 *    float, but the sponsor can lose one fee per attempt.
 *  - The key cannot be drained by a malicious transaction: it is the fee payer
 *    and may appear in no instruction at all, so the only lamports it can lose
 *    are the fee itself.
 */

/**
 * What the sponsor adds to the fee it is repaying.
 *
 * A wallet is entitled to append instructions of its own (Phantom adds
 * Lighthouse assertions), and any of that can change the fee between this
 * calculation and execution. The margin makes "repaid" true even then.
 */
export const SPONSOR_MARGIN_LAMPORTS = 2_000;

/**
 * Below this the sponsor stops signing.
 *
 * The hard backstop: whatever a bug or an abuser does, the most that can leave
 * this wallet is what was put in it. Treat the float as money that is already
 * spent, not as a balance to manage.
 *
 * Sizing it against a small float, because that is the point of this wallet:
 * one sponsored transaction costs about 10,050 lamports and is repaid with
 * 2,000 lamports of margin on top, so a healthy run *grows* the float. The only
 * thing that drains it is a transaction that lands and fails — one fee, no
 * repayment — which the server-side simulation is there to keep rare. 0.001 SOL
 * (1,000,000 lamports) therefore leaves room for roughly eighty failures before
 * the sponsor stops, while letting a wallet funded with 0.005 SOL run from the
 * first transaction.
 */
export const MIN_SPONSOR_BALANCE_LAMPORTS = 1_000_000;

/** The highest priority fee the sponsor will agree to pay, per compute unit. */
export const MAX_SPONSORED_PRIORITY_MICRO_LAMPORTS =
  PRIORITY_FEE_MICRO_LAMPORTS;

/**
 * Programs a sponsored transaction may call.
 *
 * The union of the three flow allow-lists that can be sponsored. This is not the
 * same list as "programs the app knows": a sweep names Jupiter and an ATA create
 * pays the payer for rent the sponsor would never get back, so neither is here.
 */
export const SPONSOR_ALLOWED_PROGRAMS: ReadonlySet<string> = new Set([
  ...FLOW_PROGRAMS.salvage,
  ...FLOW_PROGRAMS["excess-rent"],
  ...FLOW_PROGRAMS["pump-accumulator"],
]);

/** System program discriminants this policy understands. */
const SYSTEM_TRANSFER = 2;

const SIGNATURE_LENGTH = 64;
const LAMPORTS_PER_SIGNATURE = BASE_FEE_LAMPORTS;

export type SponsorVerdict =
  | {
      ok: true;
      /** The fee this transaction will be charged, in lamports. */
      feeLamports: number;
      /** The minimum repayment the sponsor requires for it. */
      repaymentLamports: number;
      /** Who pays — always the sponsor, restated so callers need not re-read. */
      feePayer: string;
    }
  | { ok: false; reason: string };

/** Bytes of a compiled instruction, whatever shape web3.js hands over. */
function bytesOf(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return Uint8Array.from(data as number[]);
  return null;
}

function readU64(bytes: Uint8Array, offset: number): bigint | null {
  if (bytes.length < offset + 8) return null;
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0);
  }
  return value;
}

/**
 * The exact fee a message will be charged.
 *
 * Base fee per required signature plus the priority fee its own compute-budget
 * instructions imply. Read from the message rather than from our constants,
 * because this is the number the sponsor is agreeing to pay.
 */
export function feeLamportsForMessage(message: VersionedMessage): number {
  const base = message.header.numRequiredSignatures * LAMPORTS_PER_SIGNATURE;
  if (!("compiledInstructions" in message)) return base;

  let limit: number | null = null;
  let price: number | null = null;

  for (const instruction of message.compiledInstructions) {
    const programId = message.staticAccountKeys[instruction.programIdIndex];
    if (!programId || programId.toBase58() !== COMPUTE_BUDGET_PROGRAM_ID) {
      continue;
    }
    const bytes = bytesOf(instruction.data);
    if (!bytes || bytes.length < 5) continue;
    if (bytes[0] === 0x02 && bytes.length === 5) {
      limit = new DataView(bytes.buffer, bytes.byteOffset + 1, 4).getUint32(
        0,
        true,
      );
    }
    if (bytes[0] === 0x03 && bytes.length === 9) {
      const raw = readU64(bytes, 1);
      if (raw !== null) price = Number(raw);
    }
  }

  const microLamports = price ?? PRIORITY_FEE_MICRO_LAMPORTS;
  const units = limit ?? 0;
  return base + Math.ceil((units * microLamports) / 1_000_000);
}

/**
 * What a sponsored plan must repay, per transaction.
 *
 * Two signatures — the sponsor's and the wallet's — plus the priority fee this
 * app sets, plus the margin. The client builds a transfer of exactly this from
 * the rent that transaction has just released.
 */
export function sponsoredRepaymentLamports(
  computeUnitLimit: number,
  margin: number = SPONSOR_MARGIN_LAMPORTS,
): number {
  const priority = Math.ceil(
    (computeUnitLimit * PRIORITY_FEE_MICRO_LAMPORTS) / 1_000_000,
  );
  return LAMPORTS_PER_SIGNATURE * 2 + priority + margin;
}

/** The highest compute limit the sponsor will fund. Above this, refuse. */
export const MAX_SPONSORED_COMPUTE_UNIT_LIMIT = 1_400_000;

/**
 * Decide whether the sponsor may sign a transaction.
 *
 * Runs on the bytes that will be broadcast, after the wallet has signed and
 * before the sponsor's signature exists. Every rule below exists to keep one
 * promise: the sponsor pays the fee and nothing else, and the fee comes back.
 */
export function verifySponsoredTransaction(
  encoded: Uint8Array,
  sponsor: string,
): SponsorVerdict {
  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(encoded);
  } catch {
    return { ok: false, reason: "The transaction could not be read." };
  }

  const message = transaction.message;
  if (!("compiledInstructions" in message)) {
    return {
      ok: false,
      reason: "Only versioned (v0) transactions are sponsored.",
    };
  }

  // Without this, the account list is only knowable after fetching a table, and
  // "the sponsor appears in no instruction" could not be proven from the bytes.
  if (message.addressTableLookups.length > 0) {
    return {
      ok: false,
      reason: "A sponsored transaction may not use address lookup tables.",
    };
  }

  if (message.header.numRequiredSignatures !== 2) {
    return {
      ok: false,
      reason:
        "A sponsored transaction has exactly two signers: the sponsor and the wallet.",
    };
  }

  const [feePayer, wallet] = message.staticAccountKeys;
  if (!feePayer || feePayer.toBase58() !== sponsor) {
    return {
      ok: false,
      reason: "The sponsor is not the fee payer of this transaction.",
    };
  }
  if (!wallet) {
    return { ok: false, reason: "The wallet signer could not be read." };
  }

  // The wallet must already have signed. The sponsor will not put its name to a
  // transaction nobody else has authorised, and this is also what stops it
  // being used as a free transaction source for a client that never signs.
  const walletSignature = transaction.signatures[1];
  if (
    !walletSignature ||
    walletSignature.length !== SIGNATURE_LENGTH ||
    walletSignature.every((byte) => byte === 0)
  ) {
    return {
      ok: false,
      reason: "The wallet has not signed this transaction yet.",
    };
  }

  const walletAddress = wallet.toBase58();
  let repaymentLamports = 0;
  let computeLimit = 0;

  for (const instruction of message.compiledInstructions) {
    const programId = message.staticAccountKeys[instruction.programIdIndex];
    const program = programId?.toBase58();
    if (!program) {
      return { ok: false, reason: "An instruction has no readable program." };
    }
    if (!SPONSOR_ALLOWED_PROGRAMS.has(program)) {
      return { ok: false, reason: `The sponsor does not pay for ${program}.` };
    }

    const accountKeys = instruction.accountKeyIndexes.map(
      (index) => message.staticAccountKeys[index]?.toBase58() ?? "",
    );

    if (program === COMPUTE_BUDGET_PROGRAM_ID) {
      const bytes = bytesOf(instruction.data);
      if (bytes && bytes.length === 5 && bytes[0] === 0x02) {
        computeLimit = new DataView(
          bytes.buffer,
          bytes.byteOffset + 1,
          4,
        ).getUint32(0, true);
      }
      if (bytes && bytes.length === 9 && bytes[0] === 0x03) {
        const raw = readU64(bytes, 1);
        // A wallet is free to raise its own priority fee; it is not free to
        // raise the sponsor's.
        if (raw !== null && Number(raw) > MAX_SPONSORED_PRIORITY_MICRO_LAMPORTS) {
          return {
            ok: false,
            reason: `The priority fee of ${Number(raw)} µL/CU is above the ${MAX_SPONSORED_PRIORITY_MICRO_LAMPORTS} the sponsor pays.`,
          };
        }
      }
      continue;
    }

    if (program === SYSTEM_PROGRAM_ID) {
      const bytes = bytesOf(instruction.data);
      const lamports =
        bytes && bytes.length === 12 && bytes[0] === SYSTEM_TRANSFER
          ? readU64(bytes, 4)
          : null;
      const from = accountKeys[0] ?? "";
      const to = accountKeys[1] ?? "";

      if (lamports === null) {
        return {
          ok: false,
          reason:
            "A sponsored transaction may only use a System transfer, never an account create or assign.",
        };
      }
      if (from !== walletAddress) {
        return {
          ok: false,
          reason: "A sponsored transaction may only move the wallet's own SOL.",
        };
      }
      if (to === sponsor) {
        repaymentLamports += Number(lamports);
        continue;
      }
      // Any other SOL movement is the wallet's business, not the sponsor's —
      // but the sponsor may not be named anywhere except its own repayment.
      if (accountKeys.includes(sponsor)) {
        return {
          ok: false,
          reason:
            "The sponsor may only appear as the destination of its repayment.",
        };
      }
      continue;
    }

    // Every non-System instruction: the sponsor must not be named at all, so it
    // cannot be debited by a token program, made an authority, or closed.
    if (accountKeys.includes(sponsor)) {
      return {
        ok: false,
        reason: "The sponsor may not appear in any instruction it is paying for.",
      };
    }
  }

  if (computeLimit > MAX_SPONSORED_COMPUTE_UNIT_LIMIT) {
    return {
      ok: false,
      reason: `The compute limit of ${computeLimit.toLocaleString()} is above the ${MAX_SPONSORED_COMPUTE_UNIT_LIMIT.toLocaleString()} the sponsor funds.`,
    };
  }

  const feeLamports = feeLamportsForMessage(message);
  const required = feeLamports + SPONSOR_MARGIN_LAMPORTS;
  if (repaymentLamports < required) {
    return {
      ok: false,
      reason: `The repayment of ${repaymentLamports.toLocaleString()} lamports does not cover the ${required.toLocaleString()} lamports of fee and margin.`,
    };
  }

  return {
    ok: true,
    feeLamports,
    repaymentLamports: required,
    feePayer: sponsor,
  };
}
