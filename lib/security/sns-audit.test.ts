import { describe, expect, it } from "vitest";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { burnDomain } from "@bonfida/spl-name-service";
import {
  auditInstructions,
  type AuditExpectations,
} from "@/lib/security/instruction-audit";
import { SNS_REGISTER_PROGRAM_ID } from "@/lib/security/program-ids";

/**
 * The SNS burn crosses the network, so the audit is the only thing between a
 * server response and a name being given away. These tests use the SDK's real
 * builder, then lock the four fields that matter: it names SNS's registry, it
 * is authorised by the wallet, the rent comes back to the wallet, and it acts
 * only on a name the user selected.
 */

const OWNER = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";
const STRANGER = "9qDz4uC7M7oJdhCErKEtLzm4pkdjdc7uQAFggy5jYrmt";
const NAME = "bankocbcindonesia";
const NAME_ACCOUNT = "58kg3s7A955wKSxZUEKdV6ZMjcZQqAVKxszUb9VBWMD";

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

describe("SNS name burns", () => {
  it("accepts the burn shape the route returns", () => {
    const result = auditInstructions(
      [burnDomain(`${NAME}.sns`, new PublicKey(OWNER), new PublicKey(OWNER))],
      salvage(),
    );

    expect(result.ok).toBe(true);
    expect(result.calls.map((call) => call.programName)).toContain(
      "SNS Registrar",
    );
  });

  it("refuses a burn that would refund a third party", () => {
    const result = auditInstructions(
      [burnDomain(`${NAME}.sns`, new PublicKey(OWNER), new PublicKey(STRANGER))],
      salvage(),
    );

    expect(result.ok).toBe(false);
    expect(
      result.findings.find((finding) => finding.severity === "refuse")?.code,
    ).toBe("refund-to-third-party");
  });

  it("refuses a burn for a name that was not selected", () => {
    const result = auditInstructions(
      [
        burnDomain(
          "superteamblkn.sns",
          new PublicKey(OWNER),
          new PublicKey(OWNER),
        ),
      ],
      salvage(),
    );

    expect(result.ok).toBe(false);
    expect(
      result.findings.find((finding) => finding.severity === "refuse")?.code,
    ).toBe("unexpected-subject");
  });

  it("refuses a burn authorised by someone who is not the wallet", () => {
    const result = auditInstructions(
      [
        burnDomain(
          `${NAME}.sns`,
          new PublicKey(STRANGER),
          new PublicKey(OWNER),
        ),
      ],
      salvage(),
    );

    expect(result.ok).toBe(false);
    expect(
      result.findings.find((finding) => finding.severity === "refuse")?.code,
    ).toBe("unexpected-subject");
  });

  it("refuses a registrar instruction that is not a burn", () => {
    const notABurn = new TransactionInstruction({
      programId: new PublicKey(SNS_REGISTER_PROGRAM_ID),
      keys: [],
      data: Buffer.from([9]),
    });

    const result = auditInstructions([notABurn], salvage());

    expect(result.ok).toBe(false);
    expect(
      result.findings.find((finding) => finding.severity === "refuse")?.code,
    ).toBe("unreadable-instruction");
  });
});
