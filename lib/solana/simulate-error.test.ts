import { describe, expect, it } from "vitest";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { packTransactions, type PackUnit } from "@/lib/solana/pack";
import { describeSimulationError, describeInstructionFailure } from "@/lib/solana/simulate";
import { TOKEN_PROGRAM_ID } from "@/lib/utils/constants";

/**
 * A `Custom` code is only a number. Its meaning comes from the program that
 * raised it, so naming one is only honest when we have checked *which* program
 * failed — `17` is the token program's `AccountFrozen`, and would be a
 * confidently wrong answer from anything else.
 *
 * This exists because a raw `{"InstructionError":[2,{"Custom":17}]}` reached a
 * user as the entire error message when their token turned out to be frozen.
 */

const PAYER = new PublicKey("11111111111111111111111111111112");
const BLOCKHASH = "11111111111111111111111111111111";
const NOOP_PROGRAM = "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV";

/** One packed transaction whose only instruction belongs to `programId`. */
function packedWith(programId: string) {
  const units: PackUnit[] = [
    {
      mint: "Mint1",
      instructions: [
        new TransactionInstruction({
          programId: new PublicKey(programId),
          keys: [],
          data: Buffer.from([8]),
        }),
      ],
      rentReclaim: false,
    },
  ];
  return packTransactions({
    units,
    prologue: [],
    payer: PAYER,
    blockhash: BLOCKHASH,
    lookupTables: [],
  }).transactions[0]!;
}

const frozenErr = { InstructionError: [0, { Custom: 17 }] };

describe("describeSimulationError and Custom codes", () => {
  it("names a frozen token account in words", () => {
    const message = describeSimulationError(frozenErr, packedWith(TOKEN_PROGRAM_ID));
    expect(message).toContain("frozen");
    expect(message).toContain("Nothing was lost");
    // And not just the raw code, which is what the user saw.
    expect(message).not.toContain("Custom");
  });

  it("refuses to interpret the same code from another program", () => {
    const message = describeSimulationError(frozenErr, packedWith(NOOP_PROGRAM));
    expect(message).not.toContain("frozen");
    // Falls back to the raw code: honestly unhelpful beats confidently wrong.
    expect(message).toContain("Custom");
  });

  it("does not mistake some other program's custom 26 for slippage", async () => {
    // `0x1a` is 26, and *any* program's `Custom: 26` used to match the slippage
    // pattern — which swallowed a cNFT burn failure whole and reported a price
    // problem that cannot apply to a burn. Only Jupiter's own code is slippage.
    const message = describeSimulationError(
      { InstructionError: [2, { Custom: 26 }] },
      packedWith(TOKEN_PROGRAM_ID),
    );
    expect(message).not.toContain("slippage");
    expect(message).toContain("Custom");
  });

  it("does not read a burn's 6001 as slippage either", async () => {
    // 6001 is Jupiter's slippage *and* the compression program's
    // `ConcurrentMerkleTreeError` and Bubblegum's `PublicKeyMismatch`. Matching
    // the bare number replaced a cNFT burn's real merkle error with a price
    // warning — twice — so the code alone is never enough.
    const message = describeSimulationError(
      {
        InstructionError: [2, { Custom: 6001 }],
        logs: ["Program log: Error using concurrent merkle tree: Invalid root recomputed from proof"],
      },
      packedWith(NOOP_PROGRAM),
    );
    expect(message).not.toContain("slippage");
    expect(message).toContain("no longer matches its tree");
    // And it names both causes, because a burned leaf and a racing tree look
    // identical from the client — a cNFT has no account to check.
    expect(message).toContain("already been burned");
  });

  it("still reports an unknown token-program code rather than guessing", () => {
    const message = describeSimulationError(
      { InstructionError: [0, { Custom: 99 }] },
      packedWith(TOKEN_PROGRAM_ID),
    );
    expect(message).toContain("Custom");
  });

  it("names the program that failed, so the reader knows who is talking", async () => {
    // The same number means different things in different programs: `6` is
    // `InvalidEditionKey` in Token Metadata and `IncorrectAccount` in Core.
    const message = describeInstructionFailure(
      { InstructionError: [0, { Custom: 6 }] },
      packedWith(TOKEN_PROGRAM_ID),
    );
    expect(message).toContain("Instruction #1 of 1");
    expect(message).toContain("(SPL Token)");
  });
});
