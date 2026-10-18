import { describe, expect, it } from "vitest";
import {
  COMPUTE_BUDGET_PROGRAM_ID,
  COMPUTE_UNIT_LIMIT,
  LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
  MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES,
} from "@/lib/utils/constants";
import { createComputeBudgetInstructions } from "./instructions";

/**
 * The prologue a wallet reads first.
 *
 * Phantom's guidance for avoiding simulation warnings is to state both resource
 * budgets explicitly, so the shape of these bytes is not cosmetic: a transaction
 * that declares its compute limit but not the account data it may load is only
 * half-described. These tests pin the wire format — two five-byte bodies, one
 * nine-byte body, three distinct discriminators — because a wrong length here is
 * a transaction the audit will (rightly) refuse.
 */

function decoded(
  instructions: ReturnType<typeof createComputeBudgetInstructions>,
) {
  return instructions.map((instruction) => {
    const { data } = instruction;
    return data.length === 5
      ? { kind: data[0], value: data.readUInt32LE(1) }
      : { kind: data[0], value: Number(data.readBigUInt64LE(1)) };
  });
}

describe("createComputeBudgetInstructions", () => {
  it("declares the compute limit and the account data it may load", () => {
    const instructions = createComputeBudgetInstructions();

    expect(decoded(instructions)).toEqual([
      { kind: 2, value: COMPUTE_UNIT_LIMIT },
      { kind: 4, value: LOADED_ACCOUNTS_DATA_SIZE_LIMIT },
    ]);
    for (const instruction of instructions) {
      expect(instruction.programId.toBase58()).toBe(COMPUTE_BUDGET_PROGRAM_ID);
      expect(instruction.keys).toEqual([]);
    }
  });

  it("adds the priority fee between them, and only when it is charged", () => {
    const paid = decoded(createComputeBudgetInstructions(800_000, 1_000));
    expect(paid).toEqual([
      { kind: 2, value: 800_000 },
      { kind: 3, value: 1_000 },
      { kind: 4, value: LOADED_ACCOUNTS_DATA_SIZE_LIMIT },
    ]);

    // Zero means no instruction at all: the discriminator costs five bytes and
    // a priority fee of nothing is not worth a byte.
    expect(decoded(createComputeBudgetInstructions(800_000, 0))).toEqual([
      { kind: 2, value: 800_000 },
      { kind: 4, value: LOADED_ACCOUNTS_DATA_SIZE_LIMIT },
    ]);
  });

  it("never emits a loaded-data limit the runtime would reject", () => {
    // Zero fails with InvalidLoadedAccountsDataSizeLimit, so a caller passing it
    // gets the app's own declared limit rather than an unliftable transaction.
    for (const nonsense of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const [, loaded] = decoded(
        createComputeBudgetInstructions(800_000, 0, nonsense),
      );
      expect(loaded?.value).toBe(LOADED_ACCOUNTS_DATA_SIZE_LIMIT);
    }

    const [, clamped] = decoded(
      createComputeBudgetInstructions(800_000, 0, 100_000_000),
    );
    expect(clamped?.value).toBe(MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES);
  });

  it("emits one instruction per type, which the runtime requires", () => {
    const kinds = decoded(createComputeBudgetInstructions(800_000, 1_000)).map(
      (instruction) => instruction.kind,
    );

    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toHaveLength(3);
  });
});
