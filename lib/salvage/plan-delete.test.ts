import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";
import { DeleteError, deleteComputeBudget, planDomainDeletes } from "./plan-delete";
import { feeFromRentLamports } from "@/lib/solana/rent";
import {
  DELETE_COMPUTE_UNIT_FLOOR,
  MAX_COMPUTE_UNIT_LIMIT,
  RECLAIM_FEE_BPS,
  TOKEN_ACCOUNT_RENT_LAMPORTS,
} from "@/lib/utils/constants";
import type { SalvageDomain } from "@/types/salvage";
import type { ApiInstruction } from "@/types/jupiter";

/**
 * The one flow that cannot be tested on mainnet.
 *
 * A `.sol` costs more to register than the delete returns, so nobody is going to
 * buy one to prove this works — which is exactly why it needs tests more than the
 * flows that a phone can check. These pin the arithmetic, the ordering that makes
 * the fee payable, and the refusal that stops a stale list destroying somebody
 * else's name.
 *
 * The delete instruction itself is built by `/api/domains`, so a stand-in
 * instruction stands in for it here. What is under test is everything this repo
 * decides: pricing, packing, ordering, sponsorship and refusal.
 */

const OWNER = "G4ucVPdGWwbPxJdox4acDpcN8tFXU2VP35Dg9wbEmG95";
const FEE_WALLET = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
const NAME_ACCOUNT = "So11111111111111111111111111111111111111112";
// The SNS registry. Not decoration: the audit refuses any program a salvage plan
// would never use, so a stand-in instruction has to be one the flow could carry.
const STAND_IN_PROGRAM = "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX";

function domain(overrides: Partial<SalvageDomain> = {}): SalvageDomain {
  return {
    name: "spacedust",
    address: NAME_ACCOUNT,
    lamports: TOKEN_ACCOUNT_RENT_LAMPORTS,
    bytes: 96,
    owner: OWNER,
    tokenized: false,
    ...overrides,
  };
}

function standInInstruction(): ApiInstruction {
  // The legacy registry delete as the audit decodes it: one tag byte `3`, then
  // [name account, authority (signer), refund target]. Anything else is refused
  // as "an SNS registry instruction that is not a name delete", which is the
  // check that stops a hand-built instruction riding along with a real one.
  return {
    programId: STAND_IN_PROGRAM,
    accounts: [
      { pubkey: NAME_ACCOUNT, isWritable: true, isSigner: false },
      { pubkey: OWNER, isWritable: false, isSigner: true },
      { pubkey: OWNER, isWritable: true, isSigner: false },
    ],
    data: Buffer.from([3]).toString("base64"),
  };
}

/** Enough of a connection to plan against: no chain, no signing. */
function connectionStub(balanceLamports: number): Connection {
  return {
    getLatestBlockhash: async () => ({
      blockhash: PublicKey.default.toBase58(),
      lastValidBlockHeight: 9_999,
    }),
    // A funded fee wallet, so the fee path is exercised rather than skipped.
    getAccountInfo: async () => ({ lamports: 5_000_000, data: Buffer.alloc(0) }),
    getBalance: async () => balanceLamports,
    getMinimumBalanceForRentExemption: async (size: number) =>
      size > 0 ? TOKEN_ACCOUNT_RENT_LAMPORTS : 650_240,
    simulateTransaction: async () => ({
      context: { slot: 1 },
      value: { err: null, logs: [], unitsConsumed: 1_801 },
    }),
  } as unknown as Connection;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deleteComputeBudget", () => {
  it("sizes the budget from the unit count instead of asking for the sweep's 800k", () => {
    // A delete measures 1,801 CU. The priority fee is billed on what is
    // requested, so asking for a swap's budget would overpay on every delete.
    expect(deleteComputeBudget(1)).toBe(DELETE_COMPUTE_UNIT_FLOOR);
    // Two domains clear the floor and are priced from the count alone:
    // 2 × 30,000, already a multiple of the 10,000 the budget rounds to.
    expect(deleteComputeBudget(2)).toBe(60_000);
  });

  it("grows with the batch and stops at the chain's ceiling", () => {
    expect(deleteComputeBudget(10)).toBe(300_000);
    expect(deleteComputeBudget(10_000)).toBe(MAX_COMPUTE_UNIT_LIMIT);
  });
});

describe("planDelete", () => {
  it("prices the fee on the name account's own rent, and nets it out", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEE_WALLET", FEE_WALLET);

    const plan = await planDomainDeletes({
      connection: connectionStub(5_000_000),
      owner: new PublicKey(OWNER),
      domains: [domain()],
      instructions: [standInInstruction()],
      feeSponsor: null,
    });

    expect(plan.rentLamports).toBe(TOKEN_ACCOUNT_RENT_LAMPORTS);
    expect(plan.reclaimFeeLamports).toBe(
      feeFromRentLamports(TOKEN_ACCOUNT_RENT_LAMPORTS, RECLAIM_FEE_BPS),
    );
    expect(plan.netRentLamports).toBe(
      TOKEN_ACCOUNT_RENT_LAMPORTS -
        feeFromRentLamports(TOKEN_ACCOUNT_RENT_LAMPORTS, RECLAIM_FEE_BPS),
    );
    expect(plan.deleteCount).toBe(1);
    expect(plan.hasFailures).toBe(false);
  });

  it("puts the fee transfer after the delete in the built transaction", async () => {
    // The order is the safety property: the delete credits the rent first, so the
    // fee can only be paid from money that has already arrived. Reversing these
    // two instructions would make the transaction fail on a wallet with little SOL
    // — and would be unfixable in a batch where the fee came from another delete.
    vi.stubEnv("NEXT_PUBLIC_FEE_WALLET", FEE_WALLET);

    const plan = await planDomainDeletes({
      connection: connectionStub(5_000_000),
      owner: new PublicKey(OWNER),
      domains: [domain()],
      instructions: [standInInstruction()],
      feeSponsor: null,
    });

    const transaction = VersionedTransaction.deserialize(
      Buffer.from(plan.packed[0]!.base64, "base64"),
    );
    const message = transaction.message;
    const keys = message.staticAccountKeys.map((key) => key.toBase58());
    const programs = message.compiledInstructions.map(
      (instruction) => keys[instruction.programIdIndex],
    );

    const feeIndex = message.compiledInstructions.findIndex(
      (instruction) =>
        keys[instruction.programIdIndex] === "11111111111111111111111111111111" &&
        instruction.accountKeyIndexes.some((index) => keys[index] === FEE_WALLET),
    );
    const deleteIndex = programs.indexOf(STAND_IN_PROGRAM);

    expect(deleteIndex).toBeGreaterThan(-1);
    expect(feeIndex).toBeGreaterThan(-1);
    expect(feeIndex).toBeGreaterThan(deleteIndex);
  });

  it("refuses a name the registry says belongs to somebody else", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEE_WALLET", FEE_WALLET);

    await expect(
      planDomainDeletes({
        connection: connectionStub(5_000_000),
        owner: new PublicKey(OWNER),
        domains: [domain({ owner: PublicKey.default.toBase58() })],
        instructions: [standInInstruction()],
        feeSponsor: null,
      }),
    ).rejects.toBeInstanceOf(DeleteError);
  });

  it("says why a refused name was left alone, by name", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEE_WALLET", FEE_WALLET);

    try {
      await planDomainDeletes({
        connection: connectionStub(5_000_000),
        owner: new PublicKey(OWNER),
        domains: [domain({ name: "notmine", owner: PublicKey.default.toBase58() })],
        instructions: [standInInstruction()],
        feeSponsor: null,
      });
      expect.unreachable("a name owned by another wallet cannot be deleted");
    } catch (caught) {
      expect(caught).toBeInstanceOf(DeleteError);
      expect((caught as DeleteError).warnings.join(" ")).toContain("notmine.sns");
    }
  });

  it("does not charge a fee when the fee wallet is unfunded", async () => {
    // A fee sent to an account that cannot exist yet fails the whole transaction,
    // so an unfunded fee wallet must switch the fee off rather than build it.
    vi.stubEnv("NEXT_PUBLIC_FEE_WALLET", FEE_WALLET);

    const connection = {
      ...connectionStub(5_000_000),
      getAccountInfo: async () => ({ lamports: 0, data: Buffer.alloc(0) }),
    } as unknown as Connection;

    const plan = await planDomainDeletes({
      connection,
      owner: new PublicKey(OWNER),
      domains: [domain()],
      instructions: [standInInstruction()],
      feeSponsor: null,
    });

    expect(plan.reclaimFeeLamports).toBe(0);
    expect(plan.netRentLamports).toBe(TOKEN_ACCOUNT_RENT_LAMPORTS);
    expect(plan.warnings.join(" ")).toContain("No fee was charged");
  });
});

