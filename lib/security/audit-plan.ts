import type { TransactionInstruction } from "@solana/web3.js";
import { assertPlanAudited, type AuditExpectations, type AuditResult } from "./instruction-audit";
/**
 * The instructions that are actually about to be signed: the prologue plus every
 * unit the packer put into a transaction, in the order it put them in.
 *
 * A unit the packer dropped is not in the signed bytes, so it is not audited —
 * refusing a whole plan over an instruction that was never going to be sent
 * would cost the user the batch for nothing. The bytes themselves are checked
 * separately (`auditPackedPrograms`), which is what catches anything that
 * arrived during packing.
 */
export function signedInstructions(input: {
  prologue: readonly TransactionInstruction[];
  units: readonly {
    mint: string;
    instructions: readonly TransactionInstruction[];
  }[];
  packedMints: readonly string[];
}): TransactionInstruction[] {
  const sent = new Set(input.packedMints);
  return [
    ...input.prologue,
    ...input.units
      .filter((unit) => sent.has(unit.mint))
      .flatMap((unit) => unit.instructions),
  ];
}

/**
 * The one call a planner makes. Kept here so all six flows audit the same way,
 * and so the shape of the check is in one place rather than six.
 */
export function auditPlanBeforeSigning(input: {
  prologue: readonly TransactionInstruction[];
  units: readonly {
    mint: string;
    instructions: readonly TransactionInstruction[];
  }[];
  packed: readonly { mints: string[]; base64: string }[];
  /**
   * Instructions the packer appends to every transaction after the body — the
   * fee-sponsor repayment. Audited once, because they are byte-identical in
   * every transaction and each one is capped on its own; the sponsor's own
   * server re-sums them per transaction before it signs.
   */
  tail?: readonly TransactionInstruction[];
  expected: AuditExpectations;
}): AuditResult {
  const instructions = signedInstructions({
    prologue: input.prologue,
    units: input.units,
    packedMints: input.packed.flatMap((transaction) => transaction.mints),
  });

  return assertPlanAudited({
    instructions:
      input.tail && input.tail.length > 0
        ? [...instructions, ...input.tail]
        : instructions,
    packed: input.packed,
    expected: input.expected,
  });
}
