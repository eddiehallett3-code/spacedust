import { describe, expect, it } from "vitest";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import { composePackUnits } from "@/lib/solana/compose";
import { createComputeBudgetInstructions } from "@/lib/solana/instructions";
import { JUPITER_PROGRAM_ID } from "@/lib/security/program-ids";
import {
  repackWithFreshBlockhash,
  refreshBlockhash,
  type PlanSweepResult,
  type RepackInput,
} from "@/lib/sweep/plan-sweep";
import { base64ToBytes } from "@/lib/utils/base64";
import { TOKEN_PROGRAM_ID } from "@/lib/utils/constants";
import type { ApiInstruction } from "@/types/jupiter";
import type { PlanResponse, SwapBuild } from "@/types/sweep";

/**
 * The blockhash refresh, which is what keeps a phone from losing the tail of a
 * batch.
 *
 * A sweep signs every transaction with one blockhash, so the window is shared by
 * the whole batch and by however long the human takes to approve it. The refresh
 * that fixes that has to be a *re-pack* rather than a re-plan: the same swaps, the
 * same grouping, a new blockhash — no new Jupiter quotes, and a preview that still
 * describes what will be signed. These tests pin exactly that, because a refresh
 * that re-quoted would change amounts under a preview the user had already read.
 */

const OWNER = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BLOCKHASH_A = "11111111111111111111111111111111";
const BLOCKHASH_B = "So11111111111111111111111111111111111111112";

function build(mint: string, symbol: string): SwapBuild {
  return {
    mint,
    symbol,
    logoUri: null,
    inAmount: "1000",
    tokenAccount: null,
    outAmount: "1",
    otherAmountThreshold: "1",
    outputMint: "So11111111111111111111111111111111111111112",
    priceImpactPct: null,
    routeLabels: [],
    computeBudgetInstructions: [],
    bundle: {
      setup: [],
      swap: {
        programId: JUPITER_PROGRAM_ID,
        accounts: [],
        data: "AQ==",
      } satisfies ApiInstruction,
      cleanup: null,
      other: [],
    },
    addressesByLookupTableAddress: null,
    lastValidBlockHeight: 0,
    error: null,
  };
}

function connectionWith(
  blockhash: string,
  lastValidBlockHeight: number,
): Connection {
  return {
    getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight }),
  } as unknown as Connection;
}

/**
 * A connection that answers the composer's batched close-target read with one
 * deposit per account, so a fee can be priced exactly as it is on mainnet.
 */
function connectionWithRent(lamports: number): Connection {
  return {
    getMultipleAccountsInfo: async (addresses: PublicKey[]) =>
      addresses.map(() => ({
        data: Buffer.alloc(0),
        executable: false,
        lamports,
        owner: new PublicKey(TOKEN_PROGRAM_ID),
        rentEpoch: 0,
      })),
  } as unknown as Connection;
}

/** The blockhash a packed transaction actually carries. */
function embeddedBlockhash(base64: string): string {
  return VersionedTransaction.deserialize(base64ToBytes(base64)).message
    .recentBlockhash;
}

async function input(units: RepackInput["units"]): Promise<RepackInput> {
  return {
    units,
    prologue: createComputeBudgetInstructions(800_000, 1_000),
    payer: new PublicKey(OWNER),
    lookupTables: [],
  };
}

async function composedUnits() {
  const { units } = await composePackUnits({
    owner: new PublicKey(OWNER),
    builds: [build(USDC, "USDC"), build(BONK, "BONK")],
    skipCloseMints: new Set<string>(),
    tokenPrograms: new Map([
      [USDC, "legacy"],
      [BONK, "legacy"],
    ]),
    feeWallet: OWNER,
    // A rate, applied by the composer to each close target's own deposit. The
    // fake connection below reports one fresh account's rent.
    connection: connectionWithRent(1_488_440),
    reclaimFeeBps: 150,
  });
  return units;
}

function planResponse(): PlanResponse {
  return {
    builds: [],
    failures: [],
    totalInValueUsd: 0,
    totalExpectedOutUsd: 0,
    estimatedRentReclaimLamports: 0,
    tokenAccountRentLamports: 1_488_440,
    emptyAccountRentLamports: 650_240,
    feeBps: 50,
    feeAccount: null,
    warnings: [],
    estimatedFeeLamports: 5_000,
    createdAt: 0,
  };
}

describe("repackWithFreshBlockhash", () => {
  it("packs the same batch onto a new blockhash, grouping unchanged", async () => {
    const packInput = await input(await composedUnits());

    const first = await repackWithFreshBlockhash(
      connectionWith(BLOCKHASH_A, 100),
      packInput,
    );
    const again = await repackWithFreshBlockhash(
      connectionWith(BLOCKHASH_B, 200),
      packInput,
    );

    // Same swaps, same transactions in the same order — only the hash differs.
    expect(again.packed.map((tx) => tx.mints)).toEqual(
      first.packed.map((tx) => tx.mints),
    );
    expect(again.packed.map((tx) => tx.instructionCount)).toEqual(
      first.packed.map((tx) => tx.instructionCount),
    );
    expect(again.lastValidBlockHeight).toBe(200);

    for (const transaction of again.packed) {
      expect(embeddedBlockhash(transaction.base64)).toBe(BLOCKHASH_B);
    }
    for (const transaction of first.packed) {
      expect(embeddedBlockhash(transaction.base64)).toBe(BLOCKHASH_A);
    }
  });
});

describe("refreshBlockhash", () => {
  it("carries the plan across and re-derives what the packing implies", async () => {
    const packInput = await input(await composedUnits());
    const result = {
      plan: planResponse(),
      packed: [],
      simulations: [],
      warnings: ["kept"],
      blockhash: BLOCKHASH_A,
      lastValidBlockHeight: 100,
      estimatedFeeLamports: 5_000,
      rentByMint: new Map([
        [USDC, 1_488_440],
        [BONK, 1_488_440],
      ]),
      feeByMint: new Map([
        [USDC, 22_326],
        [BONK, 22_326],
      ]),
      estimatedRentReclaimLamports: 0,
      estimatedReclaimFeeLamports: 0,
      estimatedNetRentLamports: 0,
      hasFailures: false,
      audit: { ok: true, findings: [], calls: [], feeLamports: 0 },
      repackInput: packInput,
    } satisfies PlanSweepResult;

    const refreshed = await refreshBlockhash(
      connectionWith(BLOCKHASH_B, 200),
      result,
    );

    // Re-packed, not re-planned: everything but the blockhash is the same object.
    expect(refreshed.blockhash).toBe(BLOCKHASH_B);
    expect(refreshed.lastValidBlockHeight).toBe(200);
    expect(refreshed.plan).toBe(result.plan);
    expect(refreshed.audit).toBe(result.audit);
    expect(refreshed.simulations).toBe(result.simulations);
    expect(refreshed.warnings).toEqual(["kept"]);

    // Both accounts were closed, so two deposits and two fees.
    expect(refreshed.estimatedRentReclaimLamports).toBe(2 * 1_488_440);
    expect(refreshed.estimatedReclaimFeeLamports).toBe(2 * 22_326);
    expect(refreshed.estimatedNetRentLamports).toBe(
      2 * 1_488_440 - 2 * 22_326,
    );
  });
});
