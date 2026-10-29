import { InstructionAuditError, type AuditFinding } from "./instruction-audit";
import { programLabel } from "./program-ids";

/**
 * A refusal, written out as text a person can paste somewhere.
 *
 * The instruction audit already knows exactly why it stopped — which program,
 * which instruction index, which rule — and the UI currently shows one sentence of
 * it. That sentence is the right thing to *read*, and the wrong thing to *report*:
 * a user with a genuine problem has to retype a paragraph, and the bits that would
 * make it diagnosable never leave the screen.
 *
 * So this is the other half: the same refusal as a plain block, copying the
 * findings in full. No wallet address, no signature, no key, nothing that was not
 * already on screen — only what the audit decided and why.
 *
 * Returns `null` for anything that is not an audit refusal, so a caller can show
 * the button only when there is something worth copying.
 */
export function refusalReport(error: unknown): string | null {
  if (!(error instanceof InstructionAuditError)) return null;

  const { findings, calls, feeLamports } = error.result;
  const refusals = findings.filter((finding) => finding.severity === "refuse");
  if (refusals.length === 0) return null;

  const lines: string[] = [
    "Spacedust refused this plan before signing. Nothing was signed and nothing was sent.",
    "",
    `refusals: ${refusals.length}`,
  ];

  for (const finding of refusals) {
    lines.push("", describe(finding));
  }

  if (calls.length > 0) {
    lines.push(
      "",
      `programs in the batch: ${calls
        .map((call) => `${call.programName} ×${call.count}`)
        .join(", ")}`,
    );
  }

  if (feeLamports > 0) {
    lines.push(`fee the batch would have paid: ${feeLamports} lamports`);
  }

  return lines.join("\n");
}

/** One finding, indented under its own header so a paste stays readable. */
function describe(finding: AuditFinding): string {
  const lines = [`- ${finding.code}: ${finding.message}`];

  if (finding.programId) {
    // The label as well as the address: whoever reads the paste should not have to
    // recognise a program id to know which program was involved.
    lines.push(`    program: ${programLabel(finding.programId)} (${finding.programId})`);
  }
  if (typeof finding.instructionIndex === "number") {
    lines.push(`    instruction: ${finding.instructionIndex + 1}`);
  }

  return lines.join("\n");
}
