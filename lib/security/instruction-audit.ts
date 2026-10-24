import {
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
  MAX_COMPUTE_UNIT_LIMIT,
  PRIORITY_FEE_MICRO_LAMPORTS,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@/lib/utils/constants";
import { base64ToBytes } from "@/lib/utils/base64";
import {
  ACCOUNT_COMPRESSION_PROGRAM_ID,
  BUBBLEGUM_PROGRAM_ID,
  CORE_PROGRAM_ID,
  FLOW_PROGRAMS,
  JUPITER_PROGRAM_ID,
  NOOP_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
  SNS_NAME_PROGRAM_ID,
  SNS_REGISTER_PROGRAM_ID,
  programLabel,
  type AuditFlowName,
} from "./program-ids";
import { CLOSE_USER_VOLUME_ACCUMULATOR_DISCRIMINATOR } from "@/lib/salvage/pump-accumulator";

/**
 * The instruction audit — what is actually about to be signed, checked against
 * what the plan said it would do.
 *
 * THE GAP THIS CLOSES
 *
 * Every instruction in a transaction this app builds comes from one of three
 * places: our own code, the server route that asks Jupiter for routes, or a
 * Metaplex builder. The simulation gate that already exists proves a transaction
 * will not *fail* — and a `SystemProgram.transfer` sending the whole balance to
 * an attacker simulates perfectly. Nothing else in the pipeline asks whether the
 * instructions mean what the screen says they mean.
 *
 * So this module answers one question, as a pure function over instructions:
 * **could this set of instructions do anything the user did not ask for?** If
 * the answer is "possibly", the plan is refused before a wallet is ever opened.
 *
 * WHAT IT CAN AND CANNOT SEE
 *
 * It is deliberately a *closed* check. There is no scoring, no heuristic and no
 * "probably fine": a program is either on the flow's allow-list or the plan is
 * refused, and inside a program the instruction is either one of the forms named
 * below or it is refused. The interesting consequences are all refusals —
 * `Approve` and `SetAuthority` are refused in *every* flow, because no flow in
 * this app ever needs to grant a delegation or hand over ownership, and those
 * are the two instructions that turn a mistake into a loss.
 *
 * What it cannot do is interpret the inside of an aggregator call. Jupiter's
 * swap data is opaque, and pretending otherwise would be worse than saying so —
 * so a Jupiter call is reported as opaque, and what protects the user there is
 * the surrounding invariants: no SOL can leave except the computed fee, no
 * delegation can be granted, no authority can move, and rent only comes back to
 * the owner. The token-level outcome of a swap is checked after the fact
 * instead, from the simulation's own balance deltas.
 *
 * Nothing here signs, sends, or mutates anything.
 */

export type AuditFlow = AuditFlowName;

/**
 * What a flow promised, so the audit has something to check the bytes against.
 *
 * Everything optional is optional because a flow genuinely does not know it —
 * but the required fields are the ones that matter most: who is paying, and
 * where a fee is allowed to go.
 */
export interface AuditExpectations {
  flow: AuditFlow;
  /** The wallet. It pays, it signs, and it is the only permitted beneficiary. */
  owner: string;
  /** The fee recipient compiled into this build, or null when fees are off. */
  feeWallet: string | null;
  /** The exact fee this plan computed. More than this leaving is a refusal. */
  expectedFeeLamports: number;
  /** Accounts the plan intends to close. An extra close is a warning. */
  expectedCloses?: readonly string[];
  /** Accounts the plan intends to act on — name accounts, token accounts. */
  expectedSubjects?: readonly string[];
  /** The only token accounts a transfer may credit (a send's destination). */
  expectedTransferDestinations?: readonly string[];
  /**
   * Where a compressed NFT is meant to go.
   *
   * A cNFT names its new owner as an *account key*, not an associated token
   * account, so it cannot be expressed as a transfer destination. Set by a send
   * and checked against the Bubblegum instruction's account list; a burn leaves
   * it unset, because a destroyed leaf has nowhere to go.
   */
  expectedCompressedDestination?: string | null;
  /** Accounts SOL may legitimately be moved to besides the fee wallet. */
  allowedSolDestinations?: readonly string[];
  /**
   * The sponsor advancing the network fee, when one is used.
   *
   * Its repayment is a System transfer from the wallet back to the sponsor, and
   * it is capped exactly like the Spacedust fee is: a plan that pays back more
   * than it said it would is refused, not merely reported. Without this field a
   * repayment would be indistinguishable from SOL leaving to a stranger.
   */
  sponsor?: { address: string; expectedLamports: number } | null;
  /** Wallets that may own an account this batch creates. Defaults to you. */
  allowedAtaOwners?: readonly string[];
}

export interface AuditFinding {
  /** `refuse` stops the plan. `warn` is shown and the user decides. */
  severity: "refuse" | "warn";
  code: AuditCode;
  message: string;
  programId?: string;
  instructionIndex?: number;
}

export type AuditCode =
  | "unknown-program"
  | "token-instruction-unexpected"
  | "unreadable-instruction"
  | "system-instruction"
  | "sol-leaves-owner"
  | "fee-exceeds-plan"
  | "sponsor-repayment-exceeds-plan"
  | "delegate-grant"
  | "authority-change"
  | "mint-authority"
  | "freeze-authority"
  | "transfer-unexpected"
  | "transfer-foreign-authority"
  | "rent-to-third-party"
  | "close-unexpected"
  | "burn-foreign-authority"
  | "ata-foreign-owner"
  | "ata-foreign-payer"
  | "refund-to-third-party"
  | "unexpected-subject"
  | "owner-absent"
  | "compute-budget-exceeds-plan"
  | "duplicate-compute-budget"
  | "aggregator-opaque";

/** One program's presence in the batch, in the shape the panel renders. */
export interface AuditCall {
  programId: string;
  programName: string;
  count: number;
  notes: string[];
}

export interface AuditResult {
  ok: boolean;
  findings: AuditFinding[];
  calls: AuditCall[];
  /** Total lamports the batch sends to the fee wallet. */
  feeLamports: number;
}

// ── Decoders ────────────────────────────────────────────────────────────────
//
// Each returns null rather than guessing when the bytes are not the shape they
// claim. A null from a decoder on an allow-listed program is itself a refusal:
// "I cannot tell what this does" is never a reason to sign it.

const SYSTEM_TRANSFER = 2;

/** SPL Token / Token-2022 instruction indices. Both programs share these. */
const TOKEN_INSTRUCTION_NAMES: Record<number, string> = {
  0: "InitializeMint",
  1: "InitializeAccount",
  2: "InitializeMultisig",
  3: "Transfer",
  4: "Approve",
  5: "Revoke",
  6: "SetAuthority",
  7: "MintTo",
  8: "Burn",
  9: "CloseAccount",
  10: "FreezeAccount",
  11: "ThawAccount",
  12: "TransferChecked",
  13: "ApproveChecked",
  14: "MintToChecked",
  15: "BurnChecked",
  16: "InitializeAccount2",
  17: "SyncNative",
  18: "InitializeAccount3",
  19: "InitializeMultisig2",
  20: "InitializeMint2",
};

function isTokenProgram(programId: string): boolean {
  return programId === TOKEN_PROGRAM_ID || programId === TOKEN_2022_PROGRAM_ID;
}

interface SystemTransferDecoded {
  from: string;
  to: string;
  lamports: number;
}

function decodeSystemTransfer(
  instruction: TransactionInstruction,
): SystemTransferDecoded | null {
  const { data, keys } = instruction;
  if (data.length !== 12) return null;
  if (data.readUInt32LE(0) !== SYSTEM_TRANSFER) return null;
  const from = keys[0]?.pubkey.toBase58();
  const to = keys[1]?.pubkey.toBase58();
  if (!from || !to) return null;
  return { from, to, lamports: Number(data.readBigUInt64LE(4)) };
}

/** The instruction index byte, or null when there is no data to read. */
function tokenInstructionIndex(
  instruction: TransactionInstruction,
): number | null {
  if (instruction.data.length === 0) return null;
  const index = instruction.data[0];
  return index === undefined ? null : index;
}

function tokenInstructionName(index: number): string {
  return TOKEN_INSTRUCTION_NAMES[index] ?? `instruction #${index}`;
}

/**
 * The SNS delete, decoded from the bytes the registry program's own builder
 * produces: a single discriminator byte `3`, then `[name account, authority
 * (signer), refund target]`.
 *
 * This is checked field by field rather than trusted, because the instruction
 * arrives over the network from `/api/domains` — and the refund target is the
 * one field where a wrong value is a theft rather than a failure.
 */
interface SnsDeleteDecoded {
  nameAccount: string;
  authority: string;
  refund: string;
}

function decodeSnsDelete(
  instruction: TransactionInstruction,
): SnsDeleteDecoded | null {
  if (instruction.data.length !== 1 || instruction.data[0] !== 3) return null;
  const nameAccount = instruction.keys[0]?.pubkey.toBase58();
  const authority = instruction.keys[1]?.pubkey.toBase58();
  const refund = instruction.keys[2]?.pubkey.toBase58();
  if (!nameAccount || !authority || !refund) return null;
  return { nameAccount, authority, refund };
}

/**
 * An SNS registrar burn, from the current SDK's own builder: one tag byte `16`,
 * then `[name program, system, domain, reverse, reselling state, state, central
 * state, authority (signer), refund target]`.
 *
 * This is the route current `.sns` names take. The legacy registry delete above
 * is kept because a name account can still be deleted directly, but the burn is
 * the one that also clears the registrar's reverse and resale state.
 */
interface SnsBurnDecoded {
  nameProgram: string;
  nameAccount: string;
  authority: string;
  refund: string;
  authorityIsSigner: boolean;
}

function decodeSnsBurn(
  instruction: TransactionInstruction,
): SnsBurnDecoded | null {
  if (instruction.data.length !== 1 || instruction.data[0] !== 16) return null;
  if (instruction.keys.length < 9) return null;
  const nameProgram = instruction.keys[0]?.pubkey.toBase58();
  const nameAccount = instruction.keys[2]?.pubkey.toBase58();
  const authority = instruction.keys[7]?.pubkey.toBase58();
  const refund = instruction.keys[8]?.pubkey.toBase58();
  if (!nameProgram || !nameAccount || !authority || !refund) return null;
  return {
    nameProgram,
    nameAccount,
    authority,
    refund,
    authorityIsSigner: instruction.keys[7]?.isSigner === true,
  };
}

interface AtaCreateDecoded {
  payer: string;
  ata: string;
  owner: string;
  mint: string;
}

/**
 * An associated-token-account create. The builder sends no data for the plain
 * form and `[1]` for the idempotent one; anything else is not a create.
 */
function decodeAtaCreate(
  instruction: TransactionInstruction,
): AtaCreateDecoded | null {
  const { data, keys } = instruction;
  const isCreate = data.length === 0 || (data.length === 1 && data[0] === 1);
  if (!isCreate) return null;
  const payer = keys[0]?.pubkey.toBase58();
  const ata = keys[1]?.pubkey.toBase58();
  const owner = keys[2]?.pubkey.toBase58();
  const mint = keys[3]?.pubkey.toBase58();
  if (!payer || !ata || !owner || !mint) return null;
  return { payer, ata, owner, mint };
}

interface ComputeBudgetDecoded {
  kind: "limit" | "price" | "loaded-data-size";
  value: number;
}

function decodeComputeBudget(
  instruction: TransactionInstruction,
): ComputeBudgetDecoded | null {
  const { data } = instruction;
  // SetComputeUnitLimit: one discriminator byte, then a u32.
  if (data.length === 5 && data[0] === 2) {
    return { kind: "limit", value: data.readUInt32LE(1) };
  }
  // SetComputeUnitPrice: one discriminator byte, then a u64 — nine bytes, not
  // five. Getting this wrong is what a first test run caught, and it is worth
  // the comment: the two instructions the same builder emits are different
  // lengths.
  if (data.length === 9 && data[0] === 3) {
    return { kind: "price", value: Number(data.readBigUInt64LE(1)) };
  }
  // SetLoadedAccountsDataSizeLimit: one discriminator byte, then a u32. Same
  // five-byte shape as the compute limit and a different discriminator, which
  // is exactly the sort of pair a length-only check would confuse.
  if (data.length === 5 && data[0] === 4) {
    return { kind: "loaded-data-size", value: data.readUInt32LE(1) };
  }
  return null;
}

// ── The audit ───────────────────────────────────────────────────────────────

/** How a base58 address appears in a message a human has to read. */
function short(address: string | undefined): string {
  if (!address) return "an account this audit could not read";
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Accumulates findings and the per-program summary while the instructions are
 * walked, so every rule below reads the same way.
 */
interface AuditAccumulator {
  findings: AuditFinding[];
  calls: Map<string, AuditCall>;
  feeLamports: number;
}

function refuse(
  into: AuditAccumulator,
  code: AuditCode,
  message: string,
  programId: string,
  instructionIndex: number,
): void {
  into.findings.push({
    severity: "refuse",
    code,
    message,
    programId,
    instructionIndex,
  });
}

function caution(
  into: AuditAccumulator,
  code: AuditCode,
  message: string,
  programId: string,
  instructionIndex: number,
): void {
  into.findings.push({
    severity: "warn",
    code,
    message,
    programId,
    instructionIndex,
  });
}

/** Records that a program appears in this batch, and what it is doing. */
function noteProgram(
  into: AuditAccumulator,
  programId: string,
  note?: string,
): void {
  const existing = into.calls.get(programId);
  if (existing) {
    existing.count += 1;
    if (note && !existing.notes.includes(note)) existing.notes.push(note);
    return;
  }
  into.calls.set(programId, {
    programId,
    programName: programLabel(programId),
    count: 1,
    notes: note ? [note] : [],
  });
}

/**
 * Walk every instruction and decide whether it may be signed.
 *
 * The order of the checks is the order of importance: is this program allowed in
 * this flow at all, then what does this particular instruction do, then does it
 * touch anything the plan did not name. Every branch either records a note (the
 * program is doing something we expected) or a finding — there is no third
 * outcome where an instruction is quietly skipped.
 */
export function auditInstructions(
  instructions: readonly TransactionInstruction[],
  expected: AuditExpectations,
): AuditResult {
  const into: AuditAccumulator = {
    findings: [],
    calls: new Map(),
    feeLamports: 0,
  };

  const allowed = new Set(FLOW_PROGRAMS[expected.flow]);
  const owner = expected.owner;
  const plannedCloses = new Set(expected.expectedCloses ?? []);
  const plannedSubjects = new Set(expected.expectedSubjects ?? []);
  const transferDestinations = new Set(
    expected.expectedTransferDestinations ?? [],
  );
  const solDestinations = new Set(expected.allowedSolDestinations ?? []);
  const ataOwners = new Set(expected.allowedAtaOwners ?? [owner]);

  let limitSeen = false;
  let priceSeen = false;
  let loadedDataSeen = false;

  instructions.forEach((instruction, index) => {
    const programId = instruction.programId.toBase58();

    // ── 1. Is this program allowed in this flow at all? ───────────────────
    if (!allowed.has(programId)) {
      noteProgram(into, programId);
      refuse(
        into,
        "unknown-program",
        `The batch contains an instruction for ${programLabel(programId)} (${programId}), which a ${expected.flow} plan never uses. Nothing was signed. If you did not expect this, do not simply retry: it means the instructions for this plan did not come from this app's own planner.`,
        programId,
        index,
      );
      return;
    }

    // ── 2. Compute budget: only ever the values this app sets ─────────────
    if (programId === COMPUTE_BUDGET_PROGRAM_ID) {
      const decoded = decodeComputeBudget(instruction);
      if (!decoded) {
        noteProgram(into, programId);
        refuse(
          into,
          "unreadable-instruction",
          "A Compute Budget instruction carrying data this audit does not recognise.",
          programId,
          index,
        );
        return;
      }
      if (decoded.kind === "limit") {
        if (limitSeen) {
          noteProgram(into, programId);
          refuse(
            into,
            "duplicate-compute-budget",
            "The batch sets a compute-unit limit more than once, which is not something this app builds.",
            programId,
            index,
          );
          return;
        }
        limitSeen = true;
        if (decoded.value > MAX_COMPUTE_UNIT_LIMIT) {
          noteProgram(into, programId);
          refuse(
            into,
            "compute-budget-exceeds-plan",
            `The batch asks for ${decoded.value.toLocaleString()} compute units, more than the ${MAX_COMPUTE_UNIT_LIMIT.toLocaleString()} this app ever sets. A budget nobody uses is still charged to you.`,
            programId,
            index,
          );
          return;
        }
        noteProgram(
          into,
          programId,
          `limit ${decoded.value.toLocaleString()} CU`,
        );
        return;
      }
      if (decoded.kind === "loaded-data-size") {
        if (loadedDataSeen) {
          noteProgram(into, programId);
          refuse(
            into,
            "duplicate-compute-budget",
            "The batch declares its loaded-account-data limit more than once, which is not something this app builds.",
            programId,
            index,
          );
          return;
        }
        loadedDataSeen = true;
        // Zero is rejected on chain, and anything above our own declaration is a
        // budget this app never sets. Both mean the instruction did not come
        // from the planner.
        if (
          decoded.value === 0 ||
          decoded.value > LOADED_ACCOUNTS_DATA_SIZE_LIMIT
        ) {
          noteProgram(into, programId);
          refuse(
            into,
            "compute-budget-exceeds-plan",
            `The batch declares a loaded-account-data limit of ${decoded.value.toLocaleString()} bytes, outside the ${LOADED_ACCOUNTS_DATA_SIZE_LIMIT.toLocaleString()} this app always sets.`,
            programId,
            index,
          );
          return;
        }
        noteProgram(
          into,
          programId,
          `loaded account data ${decoded.value.toLocaleString()} B`,
        );
        return;
      }

      if (priceSeen) {
        noteProgram(into, programId);
        refuse(
          into,
          "duplicate-compute-budget",
          "The batch sets a priority fee more than once, which is not something this app builds.",
          programId,
          index,
        );
        return;
      }
      priceSeen = true;
      if (decoded.value > PRIORITY_FEE_MICRO_LAMPORTS) {
        noteProgram(into, programId);
        refuse(
          into,
          "compute-budget-exceeds-plan",
          `The batch sets a priority fee of ${decoded.value} micro-lamports per unit, above the ${PRIORITY_FEE_MICRO_LAMPORTS} this app ever sets.`,
          programId,
          index,
        );
        return;
      }
      noteProgram(into, programId, `priority fee ${decoded.value} µL/CU`);
      return;
    }

    // ── 3. System: the only instruction that can move SOL ─────────────────
    if (programId === SYSTEM_PROGRAM_ID) {
      const transfer = decodeSystemTransfer(instruction);
      if (!transfer) {
        noteProgram(into, programId);
        refuse(
          into,
          "system-instruction",
          `The batch contains a System program instruction that is not a transfer (${instruction.data.length} bytes of data). None of this app's plans builds one.`,
          programId,
          index,
        );
        return;
      }
      if (transfer.from !== owner) {
        noteProgram(into, programId);
        refuse(
          into,
          "sol-leaves-owner",
          `The batch moves SOL out of ${short(transfer.from)}, which is not your wallet.`,
          programId,
          index,
        );
        return;
      }
      if (expected.feeWallet !== null && transfer.to === expected.feeWallet) {
        if (transfer.lamports > expected.expectedFeeLamports) {
          noteProgram(into, programId);
          refuse(
            into,
            "fee-exceeds-plan",
            `The batch sends ${transfer.lamports.toLocaleString()} lamports to the fee wallet, more than the ${expected.expectedFeeLamports.toLocaleString()} the plan showed you.`,
            programId,
            index,
          );
          return;
        }
        into.feeLamports += transfer.lamports;
        noteProgram(
          into,
          programId,
          `fee ${transfer.lamports.toLocaleString()} lamports → ${short(transfer.to)}`,
        );
        return;
      }
      // Repaying the sponsor that advanced the network fee. Capped like the fee
      // is, and counted separately: it is the network fee coming back, not the
      // Spacedust fee, and adding it to `feeLamports` would misstate both.
      if (expected.sponsor && transfer.to === expected.sponsor.address) {
        if (transfer.lamports > expected.sponsor.expectedLamports) {
          noteProgram(into, programId);
          refuse(
            into,
            "sponsor-repayment-exceeds-plan",
            `The batch repays ${transfer.lamports.toLocaleString()} lamports to the fee sponsor, more than the ${expected.sponsor.expectedLamports.toLocaleString()} the plan showed you.`,
            programId,
            index,
          );
          return;
        }
        noteProgram(
          into,
          programId,
          `network fee repaid ${transfer.lamports.toLocaleString()} lamports → ${short(transfer.to)}`,
        );
        return;
      }
      // Moving your own SOL to an account you own is not a loss — and a sweep
      // that wraps SOL legitimately does exactly that. Moving it anywhere else
      // is a refusal.
      if (transfer.to === owner || solDestinations.has(transfer.to)) {
        noteProgram(
          into,
          programId,
          `SOL → ${short(transfer.to)}, an account you own`,
        );
        return;
      }
      noteProgram(into, programId);
      refuse(
        into,
        "sol-leaves-owner",
        `The batch sends ${transfer.lamports.toLocaleString()} lamports of your SOL to ${short(transfer.to)}, which is neither your wallet nor the fee wallet the plan named.`,
        programId,
        index,
      );
      return;
    }

      // ── 4. Token programs ───────────────────────────────────────────────
      // The close carries the rent and the burn carries the balance, so both
      // are checked against the owner. Everything that could hand value or
      // control to someone else is refused outright, in every flow.
      if (isTokenProgram(programId)) {
        const code = tokenInstructionIndex(instruction);
        if (code === null) {
          noteProgram(into, programId);
          refuse(
            into,
            "unreadable-instruction",
            `A ${programLabel(programId)} instruction with no data, which means it cannot be interpreted.`,
            programId,
            index,
          );
          return;
        }
        const name = tokenInstructionName(code);
        const label = programLabel(programId);

        if (code === 9) {
          // CloseAccount: rent must come back to the wallet that paid it.
          const account = instruction.keys[0]?.pubkey.toBase58() ?? "";
          const destination = instruction.keys[1]?.pubkey.toBase58();
          if (destination !== owner) {
            noteProgram(into, programId);
            refuse(
              into,
              "rent-to-third-party",
              `A ${label} CloseAccount would refund an account's rent to ${short(destination)} instead of your wallet.`,
              programId,
              index,
            );
            return;
          }
          noteProgram(into, programId, "close → rent to you");
          if (plannedCloses.size > 0 && !plannedCloses.has(account)) {
            caution(
              into,
              "close-unexpected",
              `The batch closes ${short(account)}, an account the plan did not name. Its rent still comes to you, so this is only worth knowing about.`,
              programId,
              index,
            );
          }
          return;
        }

        if (code === 5) {
          // Revoke clears a delegation. Only the permission screen does that —
          // and it is the one flow where granting and clearing are the subject,
          // so the check is that it is *only* ever a revoke.
          if (expected.flow !== "approvals") {
            noteProgram(into, programId);
            refuse(
              into,
              "token-instruction-unexpected",
              `A ${label} Revoke would clear a delegation, and this is not a revoke plan.`,
              programId,
              index,
            );
            return;
          }
          const revokeAuthority = instruction.keys[1]?.pubkey.toBase58();
          if (revokeAuthority !== owner) {
            noteProgram(into, programId);
            refuse(
              into,
              "unexpected-subject",
              `A ${label} Revoke would be authorised by ${short(revokeAuthority)}, not by your wallet.`,
              programId,
              index,
            );
            return;
          }
          noteProgram(into, programId, "clear a delegation on your account");
          return;
        }

        if (code === 4 || code === 13) {
          noteProgram(into, programId);
          refuse(
            into,
            "delegate-grant",
            `A ${label} ${name} would give another address permission to move tokens out of an account. No flow in this app ever creates a delegation — an approval can only be cleared, never granted.`,
            programId,
            index,
          );
          return;
        }

        if (code === 6) {
          noteProgram(into, programId);
          refuse(
            into,
            "authority-change",
            `A ${label} SetAuthority would hand ownership or mint control of an account to a different address.`,
            programId,
            index,
          );
          return;
        }

        if (code === 7 || code === 14) {
          noteProgram(into, programId);
          refuse(
            into,
            "mint-authority",
            `A ${label} ${name} would create new tokens, which needs the mint authority.`,
            programId,
            index,
          );
          return;
        }

        if (code === 10 || code === 11) {
          noteProgram(into, programId);
          refuse(
            into,
            "freeze-authority",
            `A ${label} ${name} would ${code === 10 ? "freeze" : "thaw"} an account, which needs the mint's freeze authority.`,
            programId,
            index,
          );
          return;
        }

        if (code === 8 || code === 15) {
          // Burn / BurnChecked. Only The Void destroys anything, and only a
          // balance the wallet itself owns.
          if (expected.flow !== "void") {
            noteProgram(into, programId);
            refuse(
              into,
              "token-instruction-unexpected",
              `A ${label} ${name} would destroy tokens, and this is not a burn plan.`,
              programId,
              index,
            );
            return;
          }
          // Burn and BurnChecked share the same first three accounts:
          // `[account, mint, owner]`. The authority is always the third, for
          // both instructions — reading the fourth on BurnChecked found either
          // nothing or a multisig signer, and refused a legitimate burn.
          const authority = instruction.keys[2];
          if (authority?.pubkey.toBase58() !== owner) {
            noteProgram(into, programId);
            refuse(
              into,
              "burn-foreign-authority",
              `A ${label} Burn is authorised by ${short(authority?.pubkey.toBase58())}, not by your wallet.`,
              programId,
              index,
            );
            return;
          }
          noteProgram(into, programId, "burn of your own balance");
          return;
        }

        if (code === 3 || code === 12) {
          // Transfer / TransferChecked. Only a send moves a balance, only its
          // owner may authorise it, and only to the destination that was
          // verified before the batch was built.
          if (expected.flow !== "payload") {
            noteProgram(into, programId);
            refuse(
              into,
              "token-instruction-unexpected",
              `A ${label} ${name} would move tokens, and this is not a send plan.`,
              programId,
              index,
            );
            return;
          }
          const authority =
            code === 12 ? instruction.keys[3] : instruction.keys[2];
          const destination =
            code === 12 ? instruction.keys[2] : instruction.keys[1];
          if (authority?.pubkey.toBase58() !== owner) {
            noteProgram(into, programId);
            refuse(
              into,
              "transfer-foreign-authority",
              `A ${label} Transfer is authorised by ${short(authority?.pubkey.toBase58())}, not by your wallet.`,
              programId,
              index,
            );
            return;
          }
          const destinationAddress = destination?.pubkey.toBase58() ?? "";
          if (!transferDestinations.has(destinationAddress)) {
            noteProgram(into, programId);
            refuse(
              into,
              "transfer-unexpected",
              `A ${label} Transfer would send tokens to ${short(destinationAddress)}, which is not the destination you set.`,
              programId,
              index,
            );
            return;
          }
          noteProgram(into, programId, "send → the destination you set");
          return;
        }

        if (code === 17) {
          // SyncNative only copies the lamports an account already holds into
          // its own token balance. It cannot move anything out.
          noteProgram(into, programId, "wrap SOL already in a wrapped-SOL account");
          return;
        }

        if (code === 38) {
          // Token-2022 WithdrawExcessLamports. The account keeps its rent-exempt
          // deposit and the lamports above it go to whoever the authority names
          // — so the authority is the wallet, the destination is the wallet, and
          // the account is one the plan listed. Anything else is rent leaving.
          if (expected.flow !== "excess-rent") {
            noteProgram(into, programId);
            refuse(
              into,
              "token-instruction-unexpected",
              `A ${label} WithdrawExcessLamports would move an account's spare lamports, and this is not the excess-rent plan.`,
              programId,
              index,
            );
            return;
          }
          const account = instruction.keys[0]?.pubkey.toBase58() ?? "";
          const destination = instruction.keys[1]?.pubkey.toBase58();
          const authority = instruction.keys[2]?.pubkey.toBase58();
          if (authority !== owner || !instruction.keys[2]?.isSigner) {
            noteProgram(into, programId);
            refuse(
              into,
              "unexpected-subject",
              `A ${label} WithdrawExcessLamports would be authorised by ${short(authority)}, not by your wallet.`,
              programId,
              index,
            );
            return;
          }
          if (destination !== owner) {
            noteProgram(into, programId);
            refuse(
              into,
              "rent-to-third-party",
              `A ${label} WithdrawExcessLamports would send an account's spare lamports to ${short(destination)} instead of your wallet.`,
              programId,
              index,
            );
            return;
          }
          if (plannedSubjects.size > 0 && !plannedSubjects.has(account)) {
            noteProgram(into, programId);
            refuse(
              into,
              "unexpected-subject",
              `A withdraw acts on ${short(account)}, which is not one of the accounts the plan named.`,
              programId,
              index,
            );
            return;
          }
          noteProgram(into, programId, "withdraw spare rent → you");
          return;
        }

        noteProgram(into, programId);
        refuse(
          into,
          "token-instruction-unexpected",
          `The batch contains a ${label} ${name} instruction, which none of this app's flows builds.`,
          programId,
          index,
        );
        return;
      }

      // ── 5. Associated Token: an account is created, and for whom ────────
      if (programId === ASSOCIATED_TOKEN_PROGRAM_ID) {
        const create = decodeAtaCreate(instruction);
        if (!create) {
          noteProgram(into, programId);
          refuse(
            into,
            "unreadable-instruction",
            "The batch contains an Associated Token program instruction that is not an account create.",
            programId,
            index,
          );
          return;
        }
        if (create.payer !== owner) {
          noteProgram(into, programId);
          refuse(
            into,
            "ata-foreign-payer",
            `An account would be created and paid for by ${short(create.payer)}, not by your wallet.`,
            programId,
            index,
          );
          return;
        }
        if (!ataOwners.has(create.owner)) {
          // A send knows exactly who the account belongs to, so a stranger
          // owning it is a refusal. A sweep does not: an aggregator's route can
          // legitimately create a scratch account, so it is reported instead.
          noteProgram(into, programId);
          const message = `The batch creates an account owned by ${short(create.owner)}, which is neither your wallet nor the destination you set.`;
          if (expected.flow === "payload") {
            refuse(into, "ata-foreign-owner", message, programId, index);
          } else {
            caution(into, "ata-foreign-owner", message, programId, index);
          }
          return;
        }
        noteProgram(
          into,
          programId,
          `create an account owned by ${short(create.owner)}`,
        );
        return;
      }

      // ── 6. Jupiter: opaque, and the one place this audit cannot read ────
      if (programId === JUPITER_PROGRAM_ID) {
        const namesOwner = instruction.keys.some(
          (key) => key.pubkey.toBase58() === owner,
        );
        if (!namesOwner) {
          noteProgram(into, programId);
          caution(
            into,
            "aggregator-opaque",
            "A Jupiter aggregator call that does not name your wallet as an account at all. It still cannot move SOL, grant a delegation or change an authority — those are refused outright above — but this call is not interpretable, so compare the token balances after signing.",
            programId,
            index,
          );
          return;
        }
        noteProgram(
          into,
          programId,
          "swap (aggregator call: SOL, authority and rent stay locked down)",
        );
        return;
      }

      // ── 6b. Pump.fun: closing the wallet's own volume account ────────────
      // One instruction, and it is decoded rather than trusted: the account it
      // closes must be one the plan named, the wallet must be the signer the
      // program derives the PDA from, and the event authority must be the one
      // Pump derives for itself. A different discriminator is not a close.
      if (programId === PUMP_AMM_PROGRAM_ID) {
        if (expected.flow !== "pump-accumulator") {
          noteProgram(into, programId);
          refuse(
            into,
            "token-instruction-unexpected",
            `A ${programLabel(programId)} instruction, which this flow never uses.`,
            programId,
            index,
          );
          return;
        }
        const data = instruction.data;
        const isClose =
          data.length === CLOSE_USER_VOLUME_ACCUMULATOR_DISCRIMINATOR.length &&
          CLOSE_USER_VOLUME_ACCUMULATOR_DISCRIMINATOR.every(
            (byte, offset) => data[offset] === byte,
          );
        if (!isClose) {
          noteProgram(into, programId);
          refuse(
            into,
            "unreadable-instruction",
            `The batch contains a ${programLabel(programId)} instruction that is not a volume-account close, so it cannot be interpreted.`,
            programId,
            index,
          );
          return;
        }
        const wallet = instruction.keys[0]?.pubkey.toBase58();
        const accumulator = instruction.keys[1]?.pubkey.toBase58() ?? "";
        const eventAuthority = instruction.keys[2]?.pubkey.toBase58();
        const namedProgram = instruction.keys[3]?.pubkey.toBase58();
        if (wallet !== owner || !instruction.keys[0]?.isSigner) {
          noteProgram(into, programId);
          refuse(
            into,
            "unexpected-subject",
            `A volume-account close would be signed by ${short(wallet)}, not by your wallet.`,
            programId,
            index,
          );
          return;
        }
        if (namedProgram !== PUMP_AMM_PROGRAM_ID) {
          noteProgram(into, programId);
          refuse(
            into,
            "unexpected-subject",
            `A volume-account close names ${short(namedProgram)} as its program instead of Pump's AMM.`,
            programId,
            index,
          );
          return;
        }
        if (!eventAuthority) {
          noteProgram(into, programId);
          refuse(
            into,
            "unreadable-instruction",
            "A volume-account close does not name Pump's event authority.",
            programId,
            index,
          );
          return;
        }
        if (plannedSubjects.size > 0 && !plannedSubjects.has(accumulator)) {
          noteProgram(into, programId);
          refuse(
            into,
            "unexpected-subject",
            `A close acts on ${short(accumulator)}, which is not the account the plan named.`,
            programId,
            index,
          );
          return;
        }
        noteProgram(into, programId, "close your volume account → rent to you");
        return;
      }

      // ── 7. SNS: the burn and the legacy delete, field by field ───────────
      // The instruction arrives over the network from `/api/domains`, so every
      // field is checked rather than trusted — and the refund target is the one
      // where a wrong value is a theft rather than a failure.
      if (programId === SNS_REGISTER_PROGRAM_ID) {
        const burn = decodeSnsBurn(instruction);
        if (!burn) {
          noteProgram(into, programId);
          refuse(
            into,
            "unreadable-instruction",
            "The batch contains an SNS registrar instruction that is not a name burn.",
            programId,
            index,
          );
          return;
        }
        if (burn.nameProgram !== SNS_NAME_PROGRAM_ID) {
          noteProgram(into, programId);
          refuse(
            into,
            "unexpected-subject",
            `A name burn would call name program ${short(burn.nameProgram)}, not SNS's registry.`,
            programId,
            index,
          );
          return;
        }
        if (!burn.authorityIsSigner || burn.authority !== owner) {
          noteProgram(into, programId);
          refuse(
            into,
            "unexpected-subject",
            `A name burn would be authorised by ${short(burn.authority)}, not by your wallet.`,
            programId,
            index,
          );
          return;
        }
        if (burn.refund !== owner) {
          noteProgram(into, programId);
          refuse(
            into,
            "refund-to-third-party",
            `Burning a name would refund its rent to ${short(burn.refund)} instead of your wallet.`,
            programId,
            index,
          );
          return;
        }
        if (
          plannedSubjects.size > 0 &&
          !plannedSubjects.has(burn.nameAccount)
        ) {
          noteProgram(into, programId);
          refuse(
            into,
            "unexpected-subject",
            `A burn acts on name account ${short(burn.nameAccount)}, which is not one of the names you selected.`,
            programId,
            index,
          );
          return;
        }
        noteProgram(into, programId, "burn a name you selected, rent to you");
        return;
      }

      if (programId === SNS_NAME_PROGRAM_ID) {
        const deletion = decodeSnsDelete(instruction);
        if (!deletion) {
          noteProgram(into, programId);
          refuse(
            into,
            "unreadable-instruction",
            "The batch contains an SNS registry instruction that is not a name delete.",
            programId,
            index,
          );
          return;
        }
        if (deletion.authority !== owner) {
          noteProgram(into, programId);
          refuse(
            into,
            "unexpected-subject",
            `A name delete would be authorised by ${short(deletion.authority)}, not by your wallet.`,
            programId,
            index,
          );
          return;
        }
        if (deletion.refund !== owner) {
          noteProgram(into, programId);
          refuse(
            into,
            "refund-to-third-party",
            `Deleting a name would refund its rent to ${short(deletion.refund)} instead of your wallet.`,
            programId,
            index,
          );
          return;
        }
        if (
          plannedSubjects.size > 0 &&
          !plannedSubjects.has(deletion.nameAccount)
        ) {
          noteProgram(into, programId);
          refuse(
            into,
            "unexpected-subject",
            `A delete acts on name account ${short(deletion.nameAccount)}, which is not one of the domains you selected.`,
            programId,
            index,
          );
          return;
        }
        noteProgram(into, programId, "delete a name you selected, rent to you");
        return;
      }

      // ── 8. The Metaplex burn routes ─────────────────────────────────────
      // Only The Void uses these, and their instruction layouts are the one
      // thing here this audit does not decode: the wallets are on the flow's
      // allow-list, so the program is right, but what it does inside is the
      // builder's business. What can be checked is that the wallet is named —
      // a burn of an asset the wallet has nothing to do with is refused.
      {
        const namesOwner = instruction.keys.some(
          (key) => key.pubkey.toBase58() === owner,
        );
        // The two helper programs move nothing: one verifies the leaf, the other
        // checks the tree's root. Everything else here either burns or, in a
        // send, moves a compressed leaf.
        const movesNothing =
          programId === NOOP_PROGRAM_ID ||
          programId === ACCOUNT_COMPRESSION_PROGRAM_ID;
        if (!namesOwner && !movesNothing) {
          noteProgram(into, programId);
          refuse(
            into,
            "owner-absent",
            `A ${programLabel(programId)} instruction does not name your wallet anywhere in its account list, which is not how this app's burn routes are built.`,
            programId,
            index,
          );
          return;
        }

        // A cNFT send names its destination as an account key, so it can be
        // checked here — and it matters more than anywhere else: a wrong key in
        // this instruction hands the leaf to whoever it names, and nothing on
        // chain gives it back.
        if (
          programId === BUBBLEGUM_PROGRAM_ID &&
          expected.expectedCompressedDestination &&
          !instruction.keys.some(
            (key) =>
              key.pubkey.toBase58() === expected.expectedCompressedDestination,
          )
        ) {
          noteProgram(into, programId);
          refuse(
            into,
            "unexpected-subject",
            `A compressed transfer in this batch does not name ${short(expected.expectedCompressedDestination)} as its new owner, so the leaf would not arrive there.`,
            programId,
            index,
          );
          return;
        }

        const note =
          programId === NOOP_PROGRAM_ID
            ? "verifies a leaf, moves nothing"
            : programId === ACCOUNT_COMPRESSION_PROGRAM_ID
              ? "checks the tree's root, moves nothing"
              : programId === BUBBLEGUM_PROGRAM_ID
                ? expected.expectedCompressedDestination
                  ? "moves a compressed leaf of yours to the address you set"
                  : "burns a compressed leaf you own"
                : programId === CORE_PROGRAM_ID
                  ? "burns a Core asset you own"
                  : "burns a classic NFT you own";
        noteProgram(into, programId, note);
      }
    });

    return {
      ok: !into.findings.some((finding) => finding.severity === "refuse"),
      findings: into.findings,
      calls: [...into.calls.values()],
      feeLamports: into.feeLamports,
    };
  }

// ── The gate ────────────────────────────────────────────────────────────────

/**
 * Thrown when the audit refuses a plan. Carries the findings so a caller can
 * render them all rather than only the first.
 */
export class InstructionAuditError extends Error {
  override readonly name = "InstructionAuditError";
  constructor(readonly result: AuditResult) {
    super(refusalMessage(result));
  }
}

/**
 * One sentence a person can act on, naming the first refusal and how many more
 * there are. The full list travels with the error for anything that wants it.
 */
export function refusalMessage(result: AuditResult): string {
  const refusals = result.findings.filter(
    (finding) => finding.severity === "refuse",
  );
  const first = refusals[0];
  if (!first) return "The instruction audit refused this plan.";
  const rest =
    refusals.length > 1
      ? ` (${refusals.length - 1} more refusal${refusals.length > 2 ? "s" : ""} after it.)`
      : "";
  return `Refused before signing: ${first.message}${rest} Nothing was signed and no funds left your wallet.`;
}

/**
 * The audit run against the *packed* transactions rather than the instructions
 * they were built from.
 *
 * This is deliberately a narrower check than the one above and is not a
 * replacement for it: it can only see program ids, because resolving account
 * indices inside a v0 message needs the address lookup tables the packer used.
 * What it proves is that nothing arrived during packing — every program in the
 * bytes that will be signed is one the flow is allowed to use, and the fee payer
 * the transaction names is the wallet itself.
 *
 * `staticAccountKeys` is authoritative for a program id: the loader's own
 * `sanitize()` rejects a message whose `programIdIndex` points outside the
 * static keys, so a program id can never arrive from a lookup table. An index
 * that resolves to nothing is treated as a refusal rather than ignored.
 */
export function auditPackedPrograms(
  packed: readonly { base64: string }[],
  expected: Pick<AuditExpectations, "flow" | "owner" | "sponsor">,
): AuditFinding[] {
  const allowed = new Set(FLOW_PROGRAMS[expected.flow]);
  const findings: AuditFinding[] = [];

  packed.forEach((item, transactionIndex) => {
    let transaction;
    try {
      transaction = VersionedTransaction.deserialize(base64ToBytes(item.base64));
    } catch {
      findings.push({
        severity: "refuse",
        code: "unreadable-instruction",
        message: `Transaction ${transactionIndex + 1} of ${packed.length} could not be decoded, so what it contains cannot be checked.`,
      });
      return;
    }

    const keys = transaction.message.staticAccountKeys;
    const payer = keys[0]?.toBase58();
    // The fee payer is the wallet — or the sponsor that advanced the fee, when
    // the plan said one would. Never anyone else: this is the same property the
    // sponsor's own server re-derives from these bytes before it signs.
    if (payer !== expected.owner && payer !== expected.sponsor?.address) {
      findings.push({
        severity: "refuse",
        code: "sol-leaves-owner",
        message: `Transaction ${transactionIndex + 1} of ${packed.length} is paid for by ${short(payer)} rather than your wallet.`,
      });
    }

    transaction.message.compiledInstructions.forEach(
      (instruction, instructionIndex) => {
        const programId = keys[instruction.programIdIndex]?.toBase58();
        if (!programId) {
          findings.push({
            severity: "refuse",
            code: "unreadable-instruction",
            message: `Transaction ${transactionIndex + 1}, instruction ${instructionIndex + 1}: the program it calls cannot be resolved from the transaction's own account keys.`,
            instructionIndex,
          });
          return;
        }
        if (!allowed.has(programId)) {
          findings.push({
            severity: "refuse",
            code: "unknown-program",
            message: `Transaction ${transactionIndex + 1}, instruction ${instructionIndex + 1} calls ${programLabel(programId)} (${programId}), which is not on the ${expected.flow} allow-list.`,
            programId,
            instructionIndex,
          });
        }
      },
    );
  });

  return findings;
}

/**
 * The single call a planner makes: audit the instructions it built, audit the
 * transactions it packed from them, and throw if either refuses.
 *
 * Both are run because they answer different questions — the first says "this is
 * what the instruction means", the second says "this is what the signed bytes
 * contain" — and a plan that fails either is a plan that does not get signed.
 */
export function assertPlanAudited(input: {
  instructions: readonly TransactionInstruction[];
  packed?: readonly { base64: string }[];
  expected: AuditExpectations;
}): AuditResult {
  const result = auditInstructions(input.instructions, input.expected);

  if (input.packed && input.packed.length > 0) {
    const packedFindings = auditPackedPrograms(input.packed, input.expected);
    if (packedFindings.length > 0) {
      result.findings.push(...packedFindings);
      result.ok = false;
    }
  }

  if (!result.ok) throw new InstructionAuditError(result);
  return result;
}



