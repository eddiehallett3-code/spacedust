import { afterEach, describe, expect, it } from "vitest";
import { sendEmptiesAccount } from "@/lib/solana/transfer";
import { PublicKey, type Connection } from "@solana/web3.js";
import { SYSTEM_PROGRAM_ID } from "@/lib/utils/constants";
import {
  buildSolTransferUnit,
  computeBudgetForUnits,
  planSend,
  resolveSolSend,
  SendError,
  unsendableAssetReason,
  type PlanSendInput,
} from "./plan-send";
import type { DustToken, NonFungibleAsset } from "@/types/token";

/**
 * The parts of planning that need no chain.
 *
 * The two rules asserted hardest here are the ones that cost money if they are
 * wrong: a compute budget is billed at the size it *requests*, and a close
 * attached to a send that did not empty its account is refused on chain with
 * `Custom: 11` — measured, along with the rest, in
 * `probes/tmp-payload-transfer-probe.mjs`.
 */

const asset = (overrides: Partial<NonFungibleAsset>): NonFungibleAsset => ({
  id: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  name: "Test NFT",
  imageUri: null,
  imageMime: null,
  collection: null,
  compressed: false,
  interface: "V1_NFT",
  tokenAccount: "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi",
  program: "legacy",
  frozen: false,
  merkle: null,
  delegate: null,
  ...overrides,
});

describe("computeBudgetForUnits", () => {
  it("floors a single unit rather than asking for the measured 16,000", () => {
    expect(computeBudgetForUnits(1)).toBe(50_000);
  });

  it("scales with the units, rounded up to the next 10,000", () => {
    // 4 × 16,000 = 64,000
    expect(computeBudgetForUnits(4)).toBe(70_000);
    expect(computeBudgetForUnits(10)).toBe(160_000);
  });

  it("adds a proof allowance for each compressed NFT", () => {
    // A Bubblegum transfer verifies a merkle proof before it moves anything, so
    // asking for a token transfer's budget would under-ask and fail.
    expect(computeBudgetForUnits(1, 1)).toBe(80_000); // 16,000 + 60,000
    expect(computeBudgetForUnits(2, 2)).toBe(160_000); // 32,000 + 120,000
  });

  it("never exceeds Solana's own ceiling", () => {
    expect(computeBudgetForUnits(100)).toBe(1_400_000);
    expect(computeBudgetForUnits(100_000)).toBe(1_400_000);
  });

  it("still answers sanely for zero, which is what an empty batch looks like", () => {
    expect(computeBudgetForUnits(0)).toBe(50_000);
  });

  it("stays far below the sweep's budget for a realistic batch", () => {
    // The priority fee is billed on the request, so a batch of eleven distinct
    // destinations — the measured maximum per transaction — must not be priced
    // like the sweep's fixed 800,000.
    expect(computeBudgetForUnits(11)).toBeLessThan(800_000);
  });
});

describe("sendEmptiesAccount", () => {
  it("is true when the whole balance goes", () => {
    expect(sendEmptiesAccount(1_000n, 1_000n)).toBe(true);
  });

  it("is true when more than the balance is sent, which the chain will clamp", () => {
    expect(sendEmptiesAccount(1_001n, 1_000n)).toBe(true);
  });

  it("is false for a partial send, which must not be followed by a close", () => {
    expect(sendEmptiesAccount(999n, 1_000n)).toBe(false);
  });

  it("is true for an NFT, because one of one is all of it", () => {
    expect(sendEmptiesAccount(1n, 1n)).toBe(true);
  });
});

describe("unsendableAssetReason", () => {
  it("allows an SPL NFT", () => {
    expect(unsendableAssetReason(asset({}))).toBeNull();
  });

  it("allows a legacy NFT", () => {
    expect(unsendableAssetReason(asset({ interface: "LEGACY_NFT" }))).toBeNull();
  });

  it("sends a compressed NFT once the index has described its leaf", () => {
    // A cNFT is a leaf, not an account — so `tokenAccount: null` is normal here
    // and must not be read as "the scan lost it". What it needs is the tree data.
    const reason = unsendableAssetReason(
      asset({
        compressed: true,
        tokenAccount: null,
        merkle: {
          tree: "7MHNupVw45KV1JG3HxPPqUnCJoLzFxt3THMJsLjJRerz",
          leafId: 1172,
          dataHash: "3eNTexmWmu1cEYKhCsoXDCZJRSvgdujR1RQDGVa3t8H9",
          creatorHash: "98UuRrUaTrQF5gQocbrabinCDqmPh2UeyF9t7GwzNVCK",
          assetDataHash: null,
          flags: null,
        },
      }),
    );

    expect(reason).toBeNull();
  });

  it("refuses a leaf the index never described", () => {
    // Without tree, index and hashes there is nothing to prove, so the leaf
    // cannot be moved at all — and without a metadata index this is what every
    // cNFT in the wallet looks like.
    const reason = unsendableAssetReason(
      asset({ compressed: true, tokenAccount: null, merkle: null }),
    );

    expect(reason).toMatch(/metadata index/i);
    expect(reason).toMatch(/prove/i);
  });

  it("refuses a V2 leaf with no asset-data hash", () => {
    // `transferV2` encodes that hash and the program compares it against the
    // leaf, so a leaf the index described without one cannot be moved honestly.
    const reason = unsendableAssetReason(
      asset({
        compressed: true,
        tokenAccount: null,
        interface: "MplBubblegumV2",
        merkle: {
          tree: "6Fqx4W2g1LDE4Qqy6XHZBxPgLnCNEZ2VzrKmg9TQcBUN",
          leafId: 1,
          dataHash: "3Af4hPqqpmqCeXyXxGB4ZAAnp7HfjNJYFD1UocGW8Gsm",
          creatorHash: "CCk2pSgMkvB6NeLJe8z6AzY6MW1XgP7b8vgtT5Sk7n7d",
          assetDataHash: null,
          flags: 0,
        },
      }),
    );

    expect(reason).toMatch(/asset-data hash/i);
  });

  it("names the freeze authority when an asset is frozen", () => {
    const reason = unsendableAssetReason(asset({ frozen: true }));
    expect(reason).toMatch(/frozen/i);
    expect(reason).toMatch(/freeze authority/i);
  });

  it("refuses an asset whose account the scan could not name", () => {
    const reason = unsendableAssetReason(asset({ tokenAccount: null }));
    expect(reason).toMatch(/could not find the token account/i);
  });

  it("refuses a programmable NFT for the reason that applies to it", () => {
    const reason = unsendableAssetReason(
      asset({ interface: "ProgrammableNFT" }),
    );
    expect(reason).toMatch(/Token Metadata/i);
    expect(reason).toMatch(/not built yet/i);
  });

  it("refuses an unrecognised interface by name", () => {
    expect(unsendableAssetReason(asset({ interface: "MplCoreAsset" }))).toMatch(
      /MplCoreAsset/,
    );
  });
});

/**
 * Native SOL, which shares almost nothing with a token.
 *
 * The rule that costs money if it is wrong: a batch pays its network fee from the
 * same wallet it is emptying, so "send everything" has to mean everything minus a
 * floor. Getting it wrong does not produce a wrong number on screen — it produces
 * a transaction that cannot pay for itself, which fails for the whole batch.
 */
describe("resolveSolSend", () => {
  const RESERVE = 1_000_000;

  it("takes the amount it is given", () => {
    expect(resolveSolSend({ lamports: "25000000", balanceLamports: 100_000_000 })).toEqual(
      { amount: 25_000_000n },
    );
  });

  it("allows exactly the balance minus the reserve", () => {
    // The boundary the UI's "Max" sits on: spendable balance, not balance.
    expect(
      resolveSolSend({ lamports: String(100_000_000 - RESERVE), balanceLamports: 100_000_000 }),
    ).toEqual({ amount: BigInt(100_000_000 - RESERVE) });
  });

  it("refuses one lamport more than that", () => {
    const result = resolveSolSend({
      lamports: String(100_000_000 - RESERVE + 1),
      balanceLamports: 100_000_000,
    });

    expect("problem" in result && result.problem).toContain("SOL behind");
  });

  it("refuses zero, which is not a send", () => {
    expect(resolveSolSend({ lamports: "0", balanceLamports: 1_000_000_000 })).toEqual({
      problem: "There is no SOL to send.",
    });
  });

  it("refuses text that is not a number", () => {
    const result = resolveSolSend({ lamports: "all of it", balanceLamports: 1_000_000_000 });
    expect("problem" in result).toBe(true);
  });

  it("refuses nothing at all", () => {
    expect(resolveSolSend({ lamports: null, balanceLamports: 1 })).toEqual({
      problem: "There is no SOL to send.",
    });
  });
});

describe("buildSolTransferUnit", () => {
  const owner = new PublicKey("Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi");
  const recipient = new PublicKey("9qDz4uC7M7oJdhCErKEtLzm4pkdjdc7uQAFggy5jYrmt");

  it("is exactly one System transfer, for the exact amount", () => {
    const unit = buildSolTransferUnit(owner, recipient, 25_000_000n);

    expect(unit.instructions).toHaveLength(1);
    const transfer = unit.instructions[0]!;

    expect(transfer.programId.toBase58()).toBe(SYSTEM_PROGRAM_ID);
    // System transfer: a 4-byte instruction index of 2, then a u64 of lamports.
    expect(transfer.data[0]).toBe(2);
    expect(transfer.data.readBigUInt64LE(4)).toBe(25_000_000n);
    expect(transfer.keys.map((key) => key.pubkey.toBase58())).toEqual([
      owner.toBase58(),
      recipient.toBase58(),
    ]);
  });

  it("claims no rent, because a System transfer closes nothing", () => {
    // The distinction the summary reads: a SOL send frees no rent, so it must
    // never be counted among the closes the fee is charged on.
    expect(buildSolTransferUnit(owner, recipient, 1n).rentReclaim).toBe(false);
  });
});

/**
 * The planner against a fake chain.
 *
 * These cover the rules that only appear once a real plan is built: the fee is
 * reported only when an instruction pays it, native SOL is its own kind of item,
 * an unreadable account is not a missing one, and a repeated mint is one row.
 * Each was a bug found in review, and none needs a network.
 */
describe("planSend against a fake chain", () => {
  const OWNER = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
  const RECIPIENT = "9qDz4uC7M7oJdhCErKEtLzm4pkdjdc7uQAFggy5jYrmt";
  const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const SOURCE = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  const FEE_WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const RENT = 1_488_440;
  /** `floor(1_488_440 × 150 / 10_000)`. */
  const FEE = 22_326;

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FEE_WALLET;
  });

  const token = (): DustToken => ({
    mint: MINT,
    name: "USD Coin",
    symbol: "USDC",
    logoUri: null,
    rawAmount: "1000000",
    balance: 1,
    decimals: 6,
    priceUsd: 1,
    priceChange24h: null,
    valueUsd: 1,
    program: "legacy",
    tokenAccount: SOURCE,
    hasNoPrice: false,
    hasTransferHook: false,
    hasTransferFee: false,
    frozen: false,
    poolLike: false,
    staked: null,
  });

  const request = (connection: Connection): PlanSendInput => ({
    connection,
    owner: new PublicKey(OWNER),
    recipient: new PublicKey(RECIPIENT),
    tokens: [token()],
    assets: [],
  });

  /**
   * Just enough of a connection to plan one send: a source account holding the
   * whole balance, no destination account (so the sender pays its rent), and a
   * simulation that passes. The fee wallet is whatever the test says it is.
   */
  function fakeConnection(
    options: { feeAccountLamports?: number | null; readFails?: boolean } = {},
  ): Connection {
    const feeAccountLamports = options.feeAccountLamports ?? null;

    return {
      getMinimumBalanceForRentExemption: async (size: number) =>
        size === 0 ? 650_240 : size === 1 ? 655_320 : RENT,
      getLatestBlockhash: async () => ({
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight: 1_000,
      }),
      getMultipleParsedAccounts: async (addresses: PublicKey[]) => {
        if (options.readFails) throw new Error("RPC down");
        return {
          context: { slot: 1 },
          value: addresses.map((address) =>
            address.toBase58() === SOURCE
              ? {
                  lamports: RENT,
                  data: {
                    parsed: {
                      info: {
                        state: "initialized",
                        tokenAmount: { amount: "1000000", decimals: 6 },
                      },
                    },
                  },
                }
              : null,
          ),
        };
      },
      getAccountInfo: async () =>
        feeAccountLamports === null ? null : { lamports: feeAccountLamports },
      simulateTransaction: async () => ({
        context: { slot: 1 },
        value: { err: null, logs: [], accounts: null, unitsConsumed: 15_243 },
      }),
    } as unknown as Connection;
  }

  it("charges nothing, on screen or on chain, when no fee wallet is configured", async () => {
    delete process.env.NEXT_PUBLIC_FEE_WALLET;

    const result = await planSend(request(fakeConnection()));

    expect(result.estimatedFeeOnRentLamports).toBe(0);
    expect(
      result.outcomes.find((outcome) => outcome.sending)?.feeLamports,
    ).toBe(0);
    // The net is the rent, less what the destination's account costs to create.
    expect(result.estimatedNetLamports).toBe(
      result.estimatedRentLamports - result.estimatedRecipientAccountLamports,
    );
  });

  it("charges nothing when the fee wallet is configured but unfunded", async () => {
    process.env.NEXT_PUBLIC_FEE_WALLET = FEE_WALLET;

    const result = await planSend(
      request(fakeConnection({ feeAccountLamports: 0 })),
    );

    expect(result.estimatedFeeOnRentLamports).toBe(0);
    expect(
      result.outcomes.find((outcome) => outcome.sending)?.feeLamports,
    ).toBe(0);
  });

  it("still charges, and reports, the fee when the fee wallet is funded", async () => {
    process.env.NEXT_PUBLIC_FEE_WALLET = FEE_WALLET;

    const result = await planSend(
      request(fakeConnection({ feeAccountLamports: 10_000_000 })),
    );

    expect(result.estimatedFeeOnRentLamports).toBe(FEE);
    expect(
      result.outcomes.find((outcome) => outcome.sending)?.feeLamports,
    ).toBe(FEE);
  });

  it("plans an SOL-only batch, which is a real selection", async () => {
    // The opening guard only knew about tokens and NFTs, so an SOL-only batch
    // threw "Nothing is selected" before it ever reached the SOL row.
    const result = await planSend({
      ...request(fakeConnection()),
      tokens: [],
      assets: [],
      solLamports: "25000000",
      solBalanceLamports: 100_000_000,
    });

    const sol = result.outcomes.find((outcome) => outcome.kind === "sol");
    expect(sol?.sending).toBe(true);
    expect(sol?.amount).toBe(25_000_000n);
    expect(result.packed).toHaveLength(1);
    // SOL is not a token account, so it frees no rent and closes nothing.
    expect(result.estimatedRentLamports).toBe(0);
  });

  it("refuses an SOL-only batch whose amount cannot be sent, instead of building zero", async () => {
    const error = await planSend({
      ...request(fakeConnection()),
      tokens: [],
      assets: [],
      solLamports: "0",
      solBalanceLamports: 1_000_000_000,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SendError);
    expect((error as SendError).hint).toMatch(/no SOL to send/i);
  });

  it("refuses a SOL amount that would leave nothing for the destination accounts", async () => {
    // The token row runs first and creates the recipient's account for
    // 1,488,440 lamports. Sending this much SOL leaves only the 1,000,000
    // reserve, so the combined batch could not pay for its own creates.
    const result = await planSend({
      ...request(fakeConnection()),
      solLamports: "100000000",
      solBalanceLamports: 101_000_000,
    });

    const sol = result.outcomes.find((outcome) => outcome.kind === "sol");
    expect(sol?.sending).toBe(false);
    expect(sol?.refused).toMatch(/recipient's accounts/i);
    // The token itself is unaffected.
    expect(
      result.outcomes.find((outcome) => outcome.kind === "token")?.sending,
    ).toBe(true);
  });

  it("reports a failed read as unreadable, not as an account that no longer exists", async () => {
    const error = await planSend(
      request(fakeConnection({ readFails: true })),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SendError);
    expect((error as SendError).hint).toMatch(/could not be read right now/i);
    expect((error as SendError).hint).not.toMatch(/no longer exists/i);
  });

  it("plans one row per mint when the request repeats a token", async () => {
    const result = await planSend({
      ...request(fakeConnection()),
      tokens: [token(), token()],
    });

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.sending).toBe(true);
  });
});
