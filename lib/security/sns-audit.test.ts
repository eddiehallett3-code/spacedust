import { describe, expect, it } from "vitest";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  auditInstructions,
  type AuditExpectations,
} from "@/lib/security/instruction-audit";
import { SNS_NAME_PROGRAM_ID } from "@/lib/security/program-ids";

/**
 * The SNS delete crosses the network, so the audit is the only thing between a
 * server response and a name being given away. These tests lock the four fields
 * that matter: it is a delete, it is authorised by the wallet, the rent comes
 * back to the wallet, and it acts only on a name the user selected.
 */

const OWNER = "YNvAM4wiyvkgoExvz2ZH2AdhxaRF8ggi15BVSdvb6uA";
const STRANGER = "9qDz4uC7M7oJdhCErKEtLzm4pkdjdc7uQAFggy5jYrmt";
const NAME_ACCOUNT = "3AMLqpWhZurbUiXLUEf5nHYtVQttEwmh2FPnYkfBPyCw";
const OTHER_NAME = "ETyW5vNyWubynX7pyncBA4P5YwsggHASZjmSYK3cc9N6";

function snsDelete(
  nameAccount: string,
  authority: string,
  refund: string,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(SNS_NAME_PROGRAM_ID),
    keys: [
      { pubkey: new PublicKey(nameAccount), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(authority), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(refund), isSigner: false, isWritable: true },
    ],
    data: Buffer.from([3]),
  });
}

function salvage(over: Partial<AuditExpectations> = {}): AuditExpectations {
  return {
    flow: "salvage",
    owner: OWNER,
    feeWallet: null,
    expectedFeeLamports: 0,
    expectedSubjects: [NAME_ACCOUNT],
    ...over,
  };
}

describe("SNS name deletion", () => {
  it("accepts the delete shape the route returns", () => {
    const result = auditInstructions(
      [snsDelete(NAME_ACCOUNT, OWNER, OWNER)],
      salvage(),
    );

    expect(result.ok).toBe(true);
    expect(result.calls.map((call) => call.programName)).toContain(
      "SNS Name Registry",
    );
  });

  it("refuses a delete that would refund a third party", () => {
    const result = auditInstructions(
      [snsDelete(NAME_ACCOUNT, OWNER, STRANGER)],
      salvage(),
    );

    expect(result.ok).toBe(false);
    expect(result.findings.find((finding) => finding.severity === "refuse")?.code)
      .toBe("refund-to-third-party");
  });

  it("refuses a delete for a name that was not selected", () => {
    const result = auditInstructions(
      [snsDelete(OTHER_NAME, OWNER, OWNER)],
      salvage(),
    );

    expect(result.ok).toBe(false);
    expect(result.findings.find((finding) => finding.severity === "refuse")?.code)
      .toBe("unexpected-subject");
  });

  it("refuses a delete authorised by someone who is not the wallet", () => {
    const result = auditInstructions(
      [snsDelete(NAME_ACCOUNT, STRANGER, OWNER)],
      salvage(),
    );

    expect(result.ok).toBe(false);
    expect(result.findings.find((finding) => finding.severity === "refuse")?.code)
      .toBe("unexpected-subject");
  });

  it("refuses an SNS instruction that is not a delete", () => {
    const notADelete = new TransactionInstruction({
      programId: new PublicKey(SNS_NAME_PROGRAM_ID),
      keys: [
        { pubkey: new PublicKey(NAME_ACCOUNT), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(OWNER), isSigner: true, isWritable: false },
        { pubkey: new PublicKey(OWNER), isSigner: false, isWritable: true },
      ],
      data: Buffer.from([9]),
    });

    const result = auditInstructions([notADelete], salvage());

    expect(result.ok).toBe(false);
    expect(result.findings.find((finding) => finding.severity === "refuse")?.code)
      .toBe("unreadable-instruction");
  });
});
