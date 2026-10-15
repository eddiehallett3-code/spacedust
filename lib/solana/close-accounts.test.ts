import { describe, expect, it } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { planEmptyAccountClosesTx } from "@/lib/solana/close-accounts";
import {
  BASE_FEE_LAMPORTS,
  CLOSE_COMPUTE_UNIT_LIMIT,
  CLOSE_COMPUTE_UNITS_PER_ACCOUNT,
  MAX_INSTRUCTIONS_PER_TX,
  MAX_TX_SIZE_BYTES,
  PRIORITY_FEE_MICRO_LAMPORTS,
  TOKEN_PROGRAM_ID,
} from "@/lib/utils/constants";
import type { EmptyTokenAccount } from "@/types/token";

/**
 * "Closing is nearly free, so failing one wastes the fee — and every failure
 * here is a failure the user pays for."
 *
 * Reclaiming rent is the one flow in this app that is pure upside: the accounts
 * hold nothing, so there is no value to get wrong. What can go wrong is
 * arithmetic and packaging — a packet over 1232 bytes, a compute budget under
 * what the closes consume, or a rent total that counts an account the chain
 * then refuses to close. Those are the assertions here.
 */

const OWNER = new PublicKey("YNvAM4wiyvkgoExvz2ZH2AdhxaRF8ggi15BVSdvb6uA");
const FOREIGN_AUTHORITY = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** Deterministic, valid, distinct addresses — no random keys in a test. */
function addressFor(index: number): string {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(`empty-account-${index}`)],
    new PublicKey(TOKEN_PROGRAM_ID),
  )[0].toBase58();
}

function account(
  index: number,
  overrides: Partial<EmptyTokenAccount> = {},
): EmptyTokenAccount {
  return {
    address: addressFor(index),
    mint: "So11111111111111111111111111111111111111112",
    program: "legacy",
    lamports: 2_039_280,
    frozen: false,
    closeAuthority: null,
    withheldFees: 0,
    ...overrides,
  };
}

function fakeConnection(): Connection {
  return {
    getLatestBlockhash: async () => ({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 1,
    }),
    simulateTransaction: async () => ({
      value: { err: null, logs: [], unitsConsumed: 1_000 },
    }),
  } as unknown as Connection;
}

describe("planEmptyAccountClosesTx", () => {
  it("budgets more compute than a full packet of closes can consume", () => {
    // The packer has no compute awareness: it splits on bytes alone. So the
    // budget has to be provably larger than the worst packet the byte limit can
    // produce, or a long batch of Token-2022 closes would run out of compute.
    expect(
      MAX_INSTRUCTIONS_PER_TX * CLOSE_COMPUTE_UNITS_PER_ACCOUNT,
    ).toBeLessThanOrEqual(CLOSE_COMPUTE_UNIT_LIMIT);
  });

  it("packs many closes together without exceeding the size limit", async () => {
    const plan = await planEmptyAccountClosesTx({
      connection: fakeConnection(),
      owner: OWNER,
      accounts: Array.from({ length: 20 }, (_, index) => account(index)),
    });

    expect(plan.closeCount).toBe(20);
    for (const tx of plan.packed) {
      expect(tx.sizeBytes).toBeLessThanOrEqual(MAX_TX_SIZE_BYTES);
      expect(tx.includesRentReclaim).toBe(true);
    }
    // Fewer signatures than accounts is the whole point of packing them.
    expect(plan.packed.length).toBeLessThan(20);
  });

  it("splits into more transactions rather than dropping closes", async () => {
    const accounts = Array.from({ length: 120 }, (_, index) => account(index));
    const plan = await planEmptyAccountClosesTx({
      connection: fakeConnection(),
      owner: OWNER,
      accounts,
    });

    expect(plan.packed.length).toBeGreaterThan(1);
    const packed = plan.packed.flatMap((tx) => tx.mints);
    expect(packed).toHaveLength(120);
    expect(new Set(packed).size).toBe(120);
    // Nothing was refused, so nothing should have been warned about either.
    expect(plan.warnings).toHaveLength(0);
  });

  it("closes only what the chain will accept, and prices only that", async () => {
    const accounts = [
      account(0),
      account(1, { program: "token2022", lamports: 2_074_080 }),
      account(2, { closeAuthority: FOREIGN_AUTHORITY }),
      account(3, { withheldFees: 173_279 }),
      account(4, { frozen: true }),
    ];

    const plan = await planEmptyAccountClosesTx({
      connection: fakeConnection(),
      owner: OWNER,
      accounts,
    });

    // The frozen one is in: freezing does not block a close.
    expect(plan.closeCount).toBe(3);
    expect(plan.rentLamports).toBe(2_039_280 + 2_074_080 + 2_039_280);
    // Every refusal is named, or the row reads as a bug.
    expect(plan.warnings.join(" ")).toContain("close authority");
    expect(plan.warnings.join(" ")).toContain("withheld transfer fees");
  });

  it("charges the network fee and nothing else", async () => {
    const plan = await planEmptyAccountClosesTx({
      connection: fakeConnection(),
      owner: OWNER,
      accounts: Array.from({ length: 10 }, (_, index) => account(index)),
    });

    const priorityFee = Math.ceil(
      (CLOSE_COMPUTE_UNIT_LIMIT * PRIORITY_FEE_MICRO_LAMPORTS) / 1_000_000,
    );

    // Reclaiming rent carries no Spacedust cut: the user is recovering their own
    // deposit, not trading. The only cost is what the network charges.
    expect(plan.estimatedFeeLamports).toBe(
      plan.packed.length * (BASE_FEE_LAMPORTS + priorityFee),
    );
    // And it must be dwarfed by what comes back, or the flow is pointless.
    expect(plan.rentLamports).toBeGreaterThan(plan.estimatedFeeLamports * 10);
  });

  it("refuses to build anything when nothing can be closed", async () => {
    await expect(
      planEmptyAccountClosesTx({
        connection: fakeConnection(),
        owner: OWNER,
        accounts: [account(0, { closeAuthority: FOREIGN_AUTHORITY })],
      }),
    ).rejects.toThrow(/could be prepared to close/);
  });
});
