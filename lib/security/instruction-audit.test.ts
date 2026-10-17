import { describe, expect, it } from "vitest";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  AuthorityType,
  createApproveInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnInstruction,
  createRevokeInstruction,
  createSetAuthorityInstruction,
} from "@solana/spl-token";
import {
  createCloseAccountInstruction,
  createComputeBudgetInstructions,
} from "@/lib/solana/instructions";
import { TOKEN_PROGRAM_ID } from "@/lib/utils/constants";
import { buildSend, recipientTokenAccount } from "@/lib/solana/transfer";
import {
  InstructionAuditError,
  assertPlanAudited,
  auditInstructions,
  auditPackedPrograms,
  type AuditExpectations,
} from "./instruction-audit";
import {
  BUBBLEGUM_PROGRAM_ID,
  CORE_PROGRAM_ID,
  JUPITER_PROGRAM_ID,
} from "./program-ids";

/**
 * The audit, proved against the bytes this app actually builds.
 *
 * Every "accepts" case below goes through the real builder the app ships —
 * `createComputeBudgetInstructions`, `createCloseAccountInstruction`,
 * `buildSend` — so a change that alters an instruction layout fails here rather
 * than at a wallet prompt.
 * Every "refuses" case is the attack the check exists for, written as the
 * smallest instruction that would carry it out.
 */

const FEE_WALLET = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
const OWNER = "3gJFX3KFfsPFERu437FeUBbH2B6twpfBD5ZkoZGsgUty";
const DESTINATION = "2NPGoYUAFDwkbrKeHmQdkjeA593om56riGhjfWLS7TLR";
const STRANGER = "9qDz4uC7M7oJdhCErKEtLzm4pkdjdc7uQAFggy5jYrmt";
const ATA = "7ZY8izSSAn7VFo5dyVxpf6xwXWemxMGJNbxthQiXVxeK";
const SOURCE = "FUTLE3UD1rjyJo4mYxtgJCSiK1AE4umsGuenMFayqNMY";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const owner = new PublicKey(OWNER);
const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);

/** The two instructions every plan carries, built by the app's own builder. */
function budget(limit = 800_000, price = 1_000): TransactionInstruction[] {
  return createComputeBudgetInstructions(limit, price);
}

/** A stand-in for the aggregator's opaque call, shaped as Jupiter's is. */
function jupiterSwap(keys: PublicKey[] = [owner]): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(JUPITER_PROGRAM_ID),
    keys: keys.map((pubkey) => ({
      pubkey,
      isSigner: false,
      isWritable: true,
    })),
    data: Buffer.from([1, 2, 3, 4]),
  });
}

/** A plain SOL transfer, the instruction a drain would be built from. */
function flip(
  from: string,
  to: string,
  lamports: number,
): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: new PublicKey(from),
    toPubkey: new PublicKey(to),
    lamports,
  });
}

function sweep(over: Partial<AuditExpectations> = {}): AuditExpectations {
  return {
    flow: "sweep",
    owner: OWNER,
    feeWallet: null,
    expectedFeeLamports: 0,
    ...over,
  };
}

/** The first refusal in a result, which is what a user is shown. */
function refusal(result: { findings: { severity: string; code: string }[] }) {
  return result.findings.find((finding) => finding.severity === "refuse");
}

describe("a sweep's own instructions", () => {
  it("accepts what the app's builders produce", () => {
    const result = auditInstructions(
      [
        ...budget(),
        jupiterSwap([owner, new PublicKey(ATA)]),
        createCloseAccountInstruction(new PublicKey(ATA), owner, tokenProgram),
      ],
      sweep({ expectedCloses: [ATA] }),
    );

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.feeLamports).toBe(0);
    // The summary names every program, so the panel can show what is inside.
    expect(result.calls.map((call) => call.programName).sort()).toEqual([
      "Compute Budget",
      "Jupiter",
      "SPL Token",
    ]);
    expect(
      result.calls.find((call) => call.programName === "SPL Token")?.notes,
    ).toEqual(["close → rent to you"]);
  });

  it("refuses SOL leaving for a third party", () => {
    const result = auditInstructions(
      [...budget(), jupiterSwap(), flip(OWNER, STRANGER, 1_000_000_000)],
      sweep(),
    );

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("sol-leaves-owner");
    // The message has to name where the SOL was going, or it cannot be acted on.
    expect(
      result.findings.find((f) => f.code === "sol-leaves-owner")?.message,
    ).toContain("9qDz…Yrmt");
    // Nothing was paid to a fee wallet here — the transfer was refused, and this
    // sweep fixture declares no fee wallet anyway (a fee no longer rides solely
    // inside the aggregator call: a sweep charges its rent-reclaim fee as a
    // System transfer, which is why `feeWallet` is a thing this flow sets).
    expect(result.feeLamports).toBe(0);
  });

  it("refuses an Approve smuggled into a batch", () => {
    const approve = createApproveInstruction(
      new PublicKey(ATA),
      new PublicKey(STRANGER),
      owner,
      1n,
      [],
      tokenProgram,
    );

    const result = auditInstructions(
      [...budget(), jupiterSwap(), approve],
      sweep(),
    );

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("delegate-grant");
  });

  it("refuses a SetAuthority, which no flow ever needs", () => {
    const setAuthority = createSetAuthorityInstruction(
      new PublicKey(ATA),
      owner,
      AuthorityType.AccountOwner,
      new PublicKey(STRANGER),
      [],
      tokenProgram,
    );

    const result = auditInstructions(
      [...budget(), jupiterSwap(), setAuthority],
      sweep(),
    );

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("authority-change");
  });

  it("refuses a close whose rent would go somewhere other than you", () => {
    const result = auditInstructions(
      [
        ...budget(),
        jupiterSwap(),
        createCloseAccountInstruction(
          new PublicKey(ATA),
          new PublicKey(STRANGER),
          tokenProgram,
        ),
      ],
      sweep(),
    );

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("rent-to-third-party");
  });

  it("refuses a program the flow never uses", () => {
    const alien = new TransactionInstruction({
      programId: new PublicKey(STRANGER),
      keys: [{ pubkey: owner, isSigner: true, isWritable: true }],
      data: Buffer.from([9]),
    });

    const result = auditInstructions(
      [...budget(), jupiterSwap(), alien],
      sweep(),
    );

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("unknown-program");
  });

  it("allows SOL to move into an account the plan declared as your own", () => {
    // A sweep that outputs SOL wraps it, and wrapping moves lamports into your
    // own wrapped-SOL account. That is declared, so it passes.
    const result = auditInstructions(
      [...budget(), jupiterSwap(), flip(OWNER, ATA, 1_000_000)],
      sweep({ allowedSolDestinations: [ATA] }),
    );

    expect(result.ok).toBe(true);
  });

  it("reports an unplanned close without stopping the plan", () => {
    const result = auditInstructions(
      [
        ...budget(),
        jupiterSwap(),
        createCloseAccountInstruction(
          new PublicKey(STRANGER),
          owner,
          tokenProgram,
        ),
      ],
      sweep({ expectedCloses: [ATA] }),
    );

    // The rent still goes to the owner, so this is information, not a refusal.
    expect(result.ok).toBe(true);
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "close-unexpected",
    ]);
    expect(result.findings[0]?.severity).toBe("warn");
  });
});

/** The three instructions a send is made of, from the app's own builder. */
function sendInstructions(destination = DESTINATION): TransactionInstruction[] {
  return buildSend({
    owner,
    mint: new PublicKey(MINT),
    source: new PublicKey(SOURCE),
    recipient: new PublicKey(destination),
    amount: 1_000n,
    decimals: 6,
    tokenProgram,
    createRecipientAccount: true,
    closeSource: true,
  });
}

const destinationAta = recipientTokenAccount(
  new PublicKey(DESTINATION),
  new PublicKey(MINT),
  tokenProgram,
).toBase58();

function payload(over: Partial<AuditExpectations> = {}): AuditExpectations {
  return {
    flow: "payload",
    owner: OWNER,
    feeWallet: FEE_WALLET,
    expectedFeeLamports: 100,
    expectedTransferDestinations: [destinationAta],
    allowedAtaOwners: [DESTINATION],
    expectedCloses: [SOURCE],
    ...over,
  };
}

describe("a send", () => {
  it("accepts a send to the destination, with the fee, and nothing else", () => {
    const result = auditInstructions(
      [...budget(200_000), ...sendInstructions(), flip(OWNER, FEE_WALLET, 100)],
      payload(),
    );

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.feeLamports).toBe(100);
    expect(result.calls.map((call) => call.programName).sort()).toEqual([
      "Associated Token",
      "Compute Budget",
      "SPL Token",
      "System",
    ]);
  });

  it("refuses a transfer to an address that is not the destination", () => {
    // The destination was verified before the batch was built; a transfer that
    // ignores it is the exact failure that verification exists to prevent. The
    // account create is allowed here so the *transfer* is what gets caught.
    const result = auditInstructions(
      [...budget(200_000), ...sendInstructions(STRANGER)],
      payload({ allowedAtaOwners: [STRANGER] }),
    );

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("transfer-unexpected");
  });

  it("refuses a send whose destination account belongs to someone else", () => {
    // The same batch with the created account checked as well: the account is
    // for a stranger, so it is refused before the transfer is even reached.
    const result = auditInstructions(
      [...budget(200_000), ...sendInstructions(STRANGER)],
      payload(),
    );

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("ata-foreign-owner");
  });

  it("refuses an account created for a stranger", () => {
    const created = createAssociatedTokenAccountIdempotentInstruction(
      owner,
      new PublicKey(ATA),
      new PublicKey(STRANGER),
      new PublicKey(MINT),
      tokenProgram,
    );

    const result = auditInstructions([...budget(200_000), created], payload());

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("ata-foreign-owner");
  });

  it("refuses a fee above what the plan showed", () => {
    const result = auditInstructions(
      [...budget(200_000), ...sendInstructions(), flip(OWNER, FEE_WALLET, 101)],
      payload(),
    );

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("fee-exceeds-plan");
  });

  it("refuses a transfer authorised by someone who is not you", () => {
    const foreign = new TransactionInstruction({
      programId: tokenProgram,
      keys: [
        { pubkey: new PublicKey(SOURCE), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(MINT), isSigner: false, isWritable: false },
        {
          pubkey: new PublicKey(destinationAta),
          isSigner: false,
          isWritable: true,
        },
        { pubkey: new PublicKey(STRANGER), isSigner: true, isWritable: false },
      ],
      // TransferChecked: index 12, then an 8-byte amount and a decimals byte.
      data: Buffer.from([12, 0, 0, 0, 0, 0, 0, 0, 0, 6]),
    });

    const result = auditInstructions([...budget(200_000), foreign], payload());

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("transfer-foreign-authority");
  });
});

describe("a burn and a revoke", () => {
  it("accepts a burn of your own balance and the close that follows it", () => {
    const result = auditInstructions(
      [
        ...budget(400_000),
        createBurnInstruction(
          new PublicKey(SOURCE),
          new PublicKey(MINT),
          owner,
          1_000n,
          [],
          tokenProgram,
        ),
        createCloseAccountInstruction(new PublicKey(SOURCE), owner, tokenProgram),
      ],
      {
        flow: "void",
        owner: OWNER,
        feeWallet: FEE_WALLET,
        expectedFeeLamports: 0,
        expectedCloses: [SOURCE],
      },
    );

    expect(result.ok).toBe(true);
    expect(
      result.calls.find((call) => call.programName === "SPL Token")?.notes,
    ).toEqual(["burn of your own balance", "close → rent to you"]);
  });

  it("refuses a burn in a flow that is not a burn", () => {
    const result = auditInstructions(
      [
        ...budget(),
        createBurnInstruction(
          new PublicKey(SOURCE),
          new PublicKey(MINT),
          owner,
          1_000n,
          [],
          tokenProgram,
        ),
      ],
      sweep(),
    );

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("token-instruction-unexpected");
  });

  it("refuses a burn of a balance that is not yours", () => {
    const result = auditInstructions(
      [
        ...budget(400_000),
        createBurnInstruction(
          new PublicKey(SOURCE),
          new PublicKey(MINT),
          new PublicKey(STRANGER),
          1_000n,
          [],
          tokenProgram,
        ),
      ],
      {
        flow: "void",
        owner: OWNER,
        feeWallet: FEE_WALLET,
        expectedFeeLamports: 0,
      },
    );

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("burn-foreign-authority");
  });

  it("accepts a revoke, which clears a delegation", () => {
    const result = auditInstructions(
      [
        ...budget(200_000),
        createRevokeInstruction(new PublicKey(ATA), owner, [], tokenProgram),
      ],
      {
        flow: "approvals",
        owner: OWNER,
        feeWallet: null,
        expectedFeeLamports: 0,
      },
    );

    expect(result.ok).toBe(true);
    expect(
      result.calls.find((call) => call.programName === "SPL Token")?.notes,
    ).toEqual(["clear a delegation on your account"]);
  });

  it("refuses a burn route in a flow that never burns", () => {
    const burn = new TransactionInstruction({
      programId: new PublicKey(CORE_PROGRAM_ID),
      keys: [{ pubkey: owner, isSigner: true, isWritable: false }],
      data: Buffer.from([1, 2, 3]),
    });

    const result = auditInstructions([...budget(50_000), burn], payload());

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("unknown-program");
  });
});

describe("the compute budget", () => {
  it("refuses a budget above the app's own ceiling", () => {
    // The app never sets more than MAX_COMPUTE_UNIT_LIMIT, and the priority fee
    // is billed on the budget that is *requested* — so an inflated budget is a
    // cost, not a danger, but it is still not something we built.
    const result = auditInstructions(
      [...budget(1_500_000), jupiterSwap()],
      sweep(),
    );

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("compute-budget-exceeds-plan");
  });

  it("refuses two limits, which no plan builds", () => {
    const result = auditInstructions(
      [...budget(), ...budget(), jupiterSwap()],
      sweep(),
    );

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("duplicate-compute-budget");
  });

  it("refuses a priority fee above the constant", () => {
    const result = auditInstructions(
      [...budget(800_000, 99_999_999), jupiterSwap()],
      sweep(),
    );

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("compute-budget-exceeds-plan");
  });
});

describe("instructions that cannot be read", () => {
  it("refuses a token instruction with no data at all", () => {
    const empty = new TransactionInstruction({
      programId: tokenProgram,
      keys: [{ pubkey: owner, isSigner: false, isWritable: true }],
      data: Buffer.from([]),
    });

    const result = auditInstructions([...budget(), empty], sweep());

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("unreadable-instruction");
  });

  it("refuses a System instruction that is not a transfer", () => {
    const assign = new TransactionInstruction({
      programId: new PublicKey("11111111111111111111111111111111"),
      keys: [{ pubkey: owner, isSigner: true, isWritable: true }],
      // Assign (index 1): the shape a hostile plan would need to repoint an account.
      data: Buffer.from([1, 0, 0, 0, 1, 2, 3]),
    });

    const result = auditInstructions(
      [...budget(), assign],
      sweep({ allowedSolDestinations: [] }),
    );

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("system-instruction");
  });
});

/** A real packed transaction, so the packed check runs against real bytes. */
function pack(
  instructions: TransactionInstruction[],
  payer = OWNER,
): { base64: string } {
  const message = new TransactionMessage({
    payerKey: new PublicKey(payer),
    recentBlockhash: "11111111111111111111111111111111",
    instructions,
  }).compileToV0Message();
  return {
    base64: Buffer.from(new VersionedTransaction(message).serialize()).toString(
      "base64",
    ),
  };
}

describe("the packed bytes", () => {
  it("accepts a transaction whose programs are all on the flow's list", () => {
    const findings = auditPackedPrograms(
      [pack([...budget(), jupiterSwap()])],
      { flow: "sweep", owner: OWNER },
    );

    expect(findings).toEqual([]);
  });

  it("catches a program that is not on the flow's list", () => {
    const alien = new TransactionInstruction({
      programId: new PublicKey(STRANGER),
      keys: [{ pubkey: owner, isSigner: true, isWritable: true }],
      data: Buffer.from([9]),
    });

    const findings = auditPackedPrograms(
      [pack([...budget(), alien])],
      { flow: "sweep", owner: OWNER },
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("unknown-program");
    expect(findings[0]?.programId).toBe(STRANGER);
  });

  it("catches a transaction that names someone else as the payer", () => {
    const findings = auditPackedPrograms(
      [pack([...budget(), jupiterSwap()], STRANGER)],
      { flow: "sweep", owner: OWNER },
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      "sol-leaves-owner",
    ]);
  });

  it("refuses bytes it cannot decode rather than assuming they are fine", () => {
    const findings = auditPackedPrograms([{ base64: "bm90IGEgdHJhbnNhY3Rpb24=" }], {
      flow: "sweep",
      owner: OWNER,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("unreadable-instruction");
  });
});

describe("the gate a planner calls", () => {
  it("returns the audit when nothing is wrong", () => {
    const result = assertPlanAudited({
      instructions: [...budget(), jupiterSwap()],
      packed: [pack([...budget(), jupiterSwap()])],
      expected: sweep(),
    });

    expect(result.ok).toBe(true);
    expect(result.calls).toHaveLength(2);
  });

  it("throws a message that names the refusal and says nothing was signed", () => {
    let thrown: unknown;
    try {
      assertPlanAudited({
        instructions: [
          ...budget(),
          jupiterSwap(),
          flip(OWNER, STRANGER, 1_000_000_000),
        ],
        expected: sweep(),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(InstructionAuditError);
    const message = (thrown as Error).message;
    expect(message).toContain("Refused before signing");
    expect(message).toContain("9qDz…Yrmt");
    expect(message).toContain("Nothing was signed");
  });

  it("throws when the packed bytes disagree with the instructions", () => {
    // The instruction list is clean; the bytes contain something else. This is
    // the case the second check exists for.
    const alien = new TransactionInstruction({
      programId: new PublicKey(STRANGER),
      keys: [{ pubkey: owner, isSigner: true, isWritable: true }],
      data: Buffer.from([9]),
    });

    expect(() =>
      assertPlanAudited({
        instructions: [...budget(), jupiterSwap()],
        packed: [pack([...budget(), jupiterSwap(), alien])],
        expected: sweep(),
      }),
    ).toThrow(InstructionAuditError);
  });
});


/**
 * A compressed transfer's destination is an account key, not an ATA — so it is
 * checked against the instruction's account list rather than against a derived
 * address. The instruction here is deliberately a stub: the check being proved is
 * about *which keys are named*, and Bubblegum's own data layout is covered by
 * `lib/solana/cnft-transfer.test.ts`.
 */
describe("a compressed transfer", () => {
  const bubblegum = (keys: string[]): TransactionInstruction =>
    new TransactionInstruction({
      programId: new PublicKey(BUBBLEGUM_PROGRAM_ID),
      keys: keys.map((key) => ({
        pubkey: new PublicKey(key),
        isSigner: false,
        isWritable: false,
      })),
      data: Buffer.from([163, 52, 200, 231, 140, 3, 69, 186, 0]),
    });

  const expectations: AuditExpectations = {
    flow: "payload",
    owner: OWNER,
    feeWallet: null,
    expectedFeeLamports: 0,
    expectedCompressedDestination: DESTINATION,
  };

  it("accepts a transfer that names the address you set", () => {
    const result = auditInstructions(
      [...budget(100_000), bubblegum([OWNER, DESTINATION])],
      expectations,
    );

    expect(result.ok).toBe(true);
    expect(
      result.calls.find((call) => call.programName === "Bubblegum")?.notes,
    ).toEqual(["moves a compressed leaf of yours to the address you set"]);
  });

  it("refuses one that would send the leaf somewhere else", () => {
    // The failure this rule exists for: a leaf handed to a key nobody intended,
    // with no account and no rent to notice it by.
    const result = auditInstructions(
      [...budget(100_000), bubblegum([OWNER, STRANGER])],
      expectations,
    );

    expect(result.ok).toBe(false);
    expect(refusal(result)?.code).toBe("unexpected-subject");
  });

  it("does not apply the rule to a burn, which has nowhere to send anything", () => {
    const result = auditInstructions(
      [...budget(100_000), bubblegum([OWNER])],
      { ...expectations, expectedCompressedDestination: null },
    );

    expect(result.ok).toBe(true);
  });
});

