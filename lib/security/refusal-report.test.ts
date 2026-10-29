import { describe, expect, it } from "vitest";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { InstructionAuditError, auditInstructions } from "./instruction-audit";
import { refusalReport } from "./refusal-report";

/**
 * The text a user pastes when the app refuses to sign something.
 *
 * Worth testing because it is the only artefact of a refusal that survives the
 * screen: if the code or the message goes missing here, the report is a paragraph
 * that says "it didn't work", and the diagnostics the audit produced are lost at
 * the exact moment they matter.
 */

const OWNER = "3gJFX3KFfsPFERu437FeUBbH2B6twpfBD5ZkoZGsgUty";
const STRANGER = "9qDz4uC7M7oJdhCErKEtLzm4pkdjdc7uQAFggy5jYrmt";

/** A sweep whose only instruction moves SOL to someone else — a refusal. */
function refused(): InstructionAuditError {
  const result = auditInstructions(
    [
      SystemProgram.transfer({
        fromPubkey: new PublicKey(OWNER),
        toPubkey: new PublicKey(STRANGER),
        lamports: 1_000_000_000,
      }),
    ],
    {
      flow: "sweep",
      owner: OWNER,
      feeWallet: null,
      expectedFeeLamports: 0,
    },
  );

  expect(result.ok).toBe(false);
  return new InstructionAuditError(result);
}

describe("refusalReport", () => {
  it("writes out the rule, the reason, and where it happened", () => {
    const report = refusalReport(refused());

    expect(report).toContain("Nothing was signed and nothing was sent");
    expect(report).toContain("sol-leaves-owner");
    expect(report).toContain("program: System");
    expect(report).toContain("instruction: 1");
  });

  it("counts the refusals rather than only naming the first", () => {
    // The panel shows one sentence; the report has to carry all of them, or a
    // second refusal is invisible to whoever reads the paste.
    expect(refusalReport(refused())).toContain("refusals: 1");
  });

  it("returns null for anything that is not an audit refusal", () => {
    // The caller shows the copy control only when there is something to copy.
    expect(refusalReport(new Error("boom"))).toBeNull();
    expect(refusalReport("boom")).toBeNull();
    expect(refusalReport(null)).toBeNull();
  });
});
