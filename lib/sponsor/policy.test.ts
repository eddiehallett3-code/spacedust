import { describe, expect, it } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  CLOSE_COMPUTE_UNIT_LIMIT,
  PRIORITY_FEE_MICRO_LAMPORTS,
  TOKEN_PROGRAM_ID,
} from "@/lib/utils/constants";
import { createCloseAccountInstruction, createComputeBudgetInstructions } from "@/lib/solana/instructions";
import {
  MAX_SPONSORED_PRIORITY_MICRO_LAMPORTS,
  SPONSOR_MARGIN_LAMPORTS,
  feeLamportsForMessage,
  sponsoredRepaymentLamports,
  verifySponsoredTransaction,
} from "./policy";

/**
 * The sponsor's side of the bargain, tested as a list of things it must refuse.
 *
 * This is the only code in the app that spends lamports nobody approved
 * individually, so the tests are written the way an attacker would probe it:
 * can I get it to sign for a transaction where it is not the fee payer, where it
 * is not repaid, where it is named in an instruction, where the repayment comes
 * from a stranger, or where it is asked to fund an account creation?
 *
 * Every one of those has to fail closed, and the happy path has to still work —
 * otherwise the feature is safe because it is broken.
 */

const sponsor = Keypair.generate();
const wallet = Keypair.generate();
const stranger = Keypair.generate().publicKey;
const tokenAccount = Keypair.generate().publicKey;

/** What a real sponsored plan repays for one transaction. */
const REPAYMENT = sponsoredRepaymentLamports(CLOSE_COMPUTE_UNIT_LIMIT);

/** The fee a two-signature transaction with our compute budget actually costs. */
const FEE =
  2 * 5_000 +
  Math.ceil(
    (CLOSE_COMPUTE_UNIT_LIMIT * PRIORITY_FEE_MICRO_LAMPORTS) / 1_000_000,
  );

function closeInstruction(): TransactionInstruction {
  return createCloseAccountInstruction(
    tokenAccount,
    wallet.publicKey,
    new PublicKey(TOKEN_PROGRAM_ID),
  );
}

function repaymentInstruction(
  lamports: number,
  from: PublicKey = wallet.publicKey,
): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: from,
    toPubkey: sponsor.publicKey,
    lamports,
  });
}

/** Build and partially sign a sponsored transaction, then return its bytes. */
function bytes(input: {
  payer?: PublicKey;
  instructions?: TransactionInstruction[];
  repayment?: number | null;
  signedBy?: Keypair[];
} = {}): Uint8Array {
  const repayment =
    input.repayment === undefined ? REPAYMENT : input.repayment;

  const message = new TransactionMessage({
    payerKey: input.payer ?? sponsor.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [
      ...createComputeBudgetInstructions(
        CLOSE_COMPUTE_UNIT_LIMIT,
        PRIORITY_FEE_MICRO_LAMPORTS,
      ),
      closeInstruction(),
      ...(repayment === null ? [] : [repaymentInstruction(repayment)]),
      ...(input.instructions ?? []),
    ],
  }).compileToV0Message();

  const transaction = new VersionedTransaction(message);
  transaction.sign(input.signedBy ?? [wallet]);
  return transaction.serialize();
}

describe("feeLamportsForMessage", () => {
  it("charges the base fee per signer plus the priority fee in the message", () => {
    const message = new TransactionMessage({
      payerKey: sponsor.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: createComputeBudgetInstructions(
        CLOSE_COMPUTE_UNIT_LIMIT,
        PRIORITY_FEE_MICRO_LAMPORTS,
      ),
    }).compileToV0Message();

    // One signer in this message, so one base fee: 5,000 + 500 priority.
    expect(feeLamportsForMessage(message)).toBe(5_500);
  });

  it("charges both signatures once the wallet is a signer too", () => {
    const message = new TransactionMessage({
      payerKey: sponsor.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [
        ...createComputeBudgetInstructions(
          CLOSE_COMPUTE_UNIT_LIMIT,
          PRIORITY_FEE_MICRO_LAMPORTS,
        ),
        closeInstruction(),
      ],
    }).compileToV0Message();

    expect(feeLamportsForMessage(message)).toBe(FEE);
  });
});

describe("sponsoredRepaymentLamports", () => {
  it("covers both signatures, the priority fee, and the margin", () => {
    expect(sponsoredRepaymentLamports(CLOSE_COMPUTE_UNIT_LIMIT)).toBe(
      FEE + SPONSOR_MARGIN_LAMPORTS,
    );
  });
});

/** Build a message with an arbitrary compute budget, for the cap tests. */
function bytesWithCompute(
  compute: TransactionInstruction[],
  repayment: number | null = REPAYMENT,
): Uint8Array {
  const message = new TransactionMessage({
    payerKey: sponsor.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [
      ...compute,
      closeInstruction(),
      ...(repayment === null ? [] : [repaymentInstruction(repayment)]),
    ],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([wallet]);
  return transaction.serialize();
}

describe("verifySponsoredTransaction — what it must refuse", () => {
  it("accepts a close it pays for and is repaid for", () => {
    const verdict = verifySponsoredTransaction(
      bytes(),
      sponsor.publicKey.toBase58(),
    );

    expect(verdict).toEqual({
      ok: true,
      feeLamports: FEE,
      repaymentLamports: FEE + SPONSOR_MARGIN_LAMPORTS,
      feePayer: sponsor.publicKey.toBase58(),
    });
  });

  it("accepts a wallet paying its own Spacedust fee in the same transaction", () => {
    // The fee wallet is a third party, but it is the wallet's own money moving —
    // the sponsor has no business refusing it.
    const verdict = verifySponsoredTransaction(
      bytes({
        instructions: [
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: stranger,
            lamports: 5_000,
          }),
        ],
      }),
      sponsor.publicKey.toBase58(),
    );

    expect(verdict.ok).toBe(true);
  });

  it("refuses when it is not the fee payer", () => {
    // A stranger pays; the wallet still signs. Two signers, and the sponsor is
    // not the first of them.
    const verdict = verifySponsoredTransaction(
      bytes({ payer: stranger }),
      sponsor.publicKey.toBase58(),
    );

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/not the fee payer/i);
  });

  it("refuses a different sponsor's address", () => {
    const verdict = verifySponsoredTransaction(bytes(), stranger.toBase58());

    expect(verdict.ok).toBe(false);
  });

  it("refuses a transaction the wallet has not signed yet", () => {
    const verdict = verifySponsoredTransaction(
      bytes({ signedBy: [] }),
      sponsor.publicKey.toBase58(),
    );

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/has not signed/i);
  });

  it("refuses when the repayment is smaller than the fee", () => {
    const verdict = verifySponsoredTransaction(
      bytes({ repayment: FEE }),
      sponsor.publicKey.toBase58(),
    );

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/does not cover/i);
  });

  it("refuses a transaction with no repayment at all", () => {
    const verdict = verifySponsoredTransaction(
      bytes({ repayment: null }),
      sponsor.publicKey.toBase58(),
    );

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/does not cover/i);
  });
});


describe("verifySponsoredTransaction — the remaining refusals", () => {
  it("refuses a repayment that would come from a third party", () => {
    // A System transfer's source must sign, so trying to repay the sponsor from
    // someone else's lamports adds a third signer — which is itself refused. The
    // `from` check behind it is defence in depth: with exactly two signers, the
    // only account able to send the sponsor anything is the wallet.
    const verdict = verifySponsoredTransaction(
      bytes({
        repayment: null,
        instructions: [repaymentInstruction(REPAYMENT, stranger)],
      }),
      sponsor.publicKey.toBase58(),
    );

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/two signers|own SOL/i);
    }
  });

  it("refuses to be named in an instruction it is paying for", () => {
    const verdict = verifySponsoredTransaction(
      bytes({
        instructions: [
          createCloseAccountInstruction(
            sponsor.publicKey,
            wallet.publicKey,
            new PublicKey(TOKEN_PROGRAM_ID),
          ),
        ],
      }),
      sponsor.publicKey.toBase58(),
    );

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/may not appear/i);
  });

  it("refuses an account creation, which the sponsor cannot recover", () => {
    const verdict = verifySponsoredTransaction(
      bytes({
        instructions: [
          new TransactionInstruction({
            programId: new PublicKey("11111111111111111111111111111111"),
            keys: [],
            // 52 bytes of anything: not the 12-byte transfer this policy allows.
            data: Buffer.alloc(52),
          }),
        ],
      }),
      sponsor.publicKey.toBase58(),
    );

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/System transfer/i);
  });

  it("refuses a program outside the sponsored set", () => {
    const verdict = verifySponsoredTransaction(
      bytes({
        instructions: [
          new TransactionInstruction({
            programId: new PublicKey(
              "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
            ),
            keys: [],
            data: Buffer.alloc(0),
          }),
        ],
      }),
      sponsor.publicKey.toBase58(),
    );

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/does not pay for/i);
  });

  it("refuses a priority fee above the cap it agreed to", () => {
    const verdict = verifySponsoredTransaction(
      bytesWithCompute(
        createComputeBudgetInstructions(
          CLOSE_COMPUTE_UNIT_LIMIT,
          MAX_SPONSORED_PRIORITY_MICRO_LAMPORTS + 1,
        ),
      ),
      sponsor.publicKey.toBase58(),
    );

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/priority fee/i);
  });

  it("refuses a compute limit above the cap it agreed to", () => {
    const verdict = verifySponsoredTransaction(
      bytesWithCompute(
        createComputeBudgetInstructions(1_400_001, PRIORITY_FEE_MICRO_LAMPORTS),
      ),
      sponsor.publicKey.toBase58(),
    );

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/compute limit/i);
  });

  it("refuses bytes that are not a versioned transaction", () => {
    const verdict = verifySponsoredTransaction(
      new Uint8Array([1, 2, 3]),
      sponsor.publicKey.toBase58(),
    );

    expect(verdict.ok).toBe(false);
  });

  it("refuses a transaction with one signer, which cannot carry a repayment", () => {
    const message = new TransactionMessage({
      payerKey: sponsor.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: createComputeBudgetInstructions(CLOSE_COMPUTE_UNIT_LIMIT),
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    transaction.sign([sponsor]);

    const verdict = verifySponsoredTransaction(
      transaction.serialize(),
      sponsor.publicKey.toBase58(),
    );

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/two signers/i);
  });
});

