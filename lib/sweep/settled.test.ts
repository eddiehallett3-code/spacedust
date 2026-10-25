import { describe, expect, it, vi } from "vitest";
import { PublicKey, type Connection, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { readSettledSweep } from "./settled";
import { WSOL_MINT, USDC_MINT } from "@/lib/utils/constants";

/**
 * These pin the two figures the success screen used to invent.
 *
 * The numbers are not invented here either: the first fixture is a real 3-token
 * sweep read off mainnet (two transactions, 7,000 lamports of fee each, 4,465,320
 * lamports of rent reclaimed, 66,978 of platform fee), and the round trip has to
 * come back with the 2,996,741 lamports that actually reached the wallet. The
 * Solflare fixture exists because a wallet that adds its own priority fee is the
 * case the old estimate got wrong by 12x.
 */

const OWNER = "G4ucVPdGWwbPxJdox4acDpcN8tFXU2VP35Dg9wbEmG95";
const FEE_WALLET = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";

interface TxShape {
  fee: number;
  /** What the route delivered, in lamports. */
  received: number;
  /** Rent each close credited the owner. */
  rents: number[];
  /** Platform fee paid to the fee wallet. */
  platformFee: number;
}

/**
 * A 32-byte key that is valid base58, derived from a small integer so a failure
 * can be identified from the address alone.
 */
function fakeKey(seed: number): PublicKey {
  const bytes = new Uint8Array(32).fill(seed);
  return new PublicKey(bytes);
}

/**
 * Build a parsed transaction whose balances are consistent with the story it
 * tells: the owner's delta is what is left after rent comes in and fees go out.
 */
function makeTx(shape: TxShape): ParsedTransactionWithMeta {
  const closed = shape.rents.map((rent, index) => ({ key: fakeKey(index + 1), rent }));
  const keys = [new PublicKey(OWNER), new PublicKey(FEE_WALLET), ...closed.map((entry) => entry.key)];

  const rentTotal = shape.rents.reduce((sum, rent) => sum + rent, 0);
  const ownerDelta = shape.received + rentTotal - shape.fee - shape.platformFee;

  const preBalances = [1_000_000_000, 0, ...shape.rents];
  const postBalances = [
    preBalances[0]! + ownerDelta,
    shape.platformFee,
    ...shape.rents.map(() => 0),
  ];

  const instructions = [
    ...closed.map((entry) => ({
      programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      parsed: {
        type: "closeAccount",
        info: { account: entry.key.toBase58(), destination: OWNER, owner: OWNER },
      },
      program: "spl-token",
      stackHeight: 1,
    })),
    ...(shape.platformFee > 0
      ? [
          {
            programId: "11111111111111111111111111111111",
            parsed: {
              type: "transfer",
              info: { source: OWNER, destination: FEE_WALLET, lamports: shape.platformFee },
            },
            program: "system",
            stackHeight: 1,
          },
        ]
      : []),
  ];

  return {
    slot: 1,
    blockTime: 1_700_000_000,
    meta: {
      fee: shape.fee,
      err: null,
      preBalances,
      postBalances,
      innerInstructions: [],
      preTokenBalances: [],
      postTokenBalances: [],
      logMessages: [],
      rewards: [],
      loadedAddresses: { writable: [], readonly: [] },
    },
    transaction: {
      message: {
        accountKeys: keys.map((pubkey, index) => ({
          pubkey,
          signer: index === 0,
          writable: true,
          source: "transaction",
        })),
        instructions,
        recentBlockhash: "11111111111111111111111111111111",
      },
      signatures: ["signature"],
    },
    version: 0,
  } as unknown as ParsedTransactionWithMeta;
}

function fakeConnection(transactions: Array<ParsedTransactionWithMeta | null>) {
  let index = 0;
  return {
    getParsedTransaction: vi.fn(async () => transactions[index++] ?? null),
  } as unknown as Connection;
}

describe("readSettledSweep", () => {
  it("reports the delivery a real 3-token sweep produced, not its quote", async () => {
    // Transaction A: two closes, 44,652 of platform fee, 4,923,307 of owner delta.
    // Transaction B: one close, 22,326 of platform fee, 2,457,776 of owner delta.
    // Read together they delivered 2,996,741 lamports, which is what the wallet
    // balance showed and 459 lamports below what the routes were quoted for.
    const connection = fakeConnection([
      makeTx({ fee: 7_000, received: 1_998_079, rents: [1_488_440, 1_488_440], platformFee: 44_652 }),
      makeTx({ fee: 7_000, received: 998_662, rents: [1_488_440], platformFee: 22_326 }),
    ]);

    const settled = await readSettledSweep({
      connection,
      signatures: ["a", "b"],
      owner: OWNER,
      outputAsset: "SOL",
      feeWallet: FEE_WALLET,
    });

    expect(settled).not.toBeNull();
    expect(settled?.feeLamports).toBe(14_000);
    expect(settled?.received).toBeCloseTo(0.002996741, 9);
    expect(settled?.transactionsRead).toBe(2);
  });

  it("charges what the wallet paid, not what the app asked for", async () => {
    // Solflare set its own priority fee: 87,000 lamports against the 7,000 the
    // simulation estimated. The receipt has to show the wallet's number.
    const connection = fakeConnection([
      makeTx({ fee: 87_000, received: 1_998_079, rents: [1_488_440, 1_488_440], platformFee: 44_652 }),
    ]);

    const settled = await readSettledSweep({
      connection,
      signatures: ["a"],
      owner: OWNER,
      outputAsset: "SOL",
      feeWallet: FEE_WALLET,
    });

    expect(settled?.feeLamports).toBe(87_000);
    // The fee cancels out of the delivery arithmetic — it moved lamports out and
    // is added straight back — so the same fill is reported either way.
    expect(settled?.received).toBeCloseTo(0.001998079, 9);
  });

  it("reads a token-denominated output from its account balance", async () => {
    const tx = makeTx({ fee: 7_000, received: 0, rents: [1_488_440], platformFee: 22_326 });
    // 1.234567 USDC arriving in the owner's account, in raw units.
    tx.meta!.preTokenBalances = [
      { accountIndex: 0, mint: USDC_MINT, owner: OWNER, uiTokenAmount: { amount: "0", decimals: 6, uiAmount: 0, uiAmountString: "0" } },
    ];
    tx.meta!.postTokenBalances = [
      { accountIndex: 0, mint: USDC_MINT, owner: OWNER, uiTokenAmount: { amount: "1234567", decimals: 6, uiAmount: 1.234567, uiAmountString: "1.234567" } },
      // A pool's own account must not be counted as the user's.
      { accountIndex: 1, mint: USDC_MINT, owner: "PoolAccount111111111111111111111111111111", uiTokenAmount: { amount: "999000000", decimals: 6, uiAmount: 999, uiAmountString: "999" } },
    ];

    const settled = await readSettledSweep({
      connection: fakeConnection([tx]),
      signatures: ["a"],
      owner: OWNER,
      outputAsset: "USDC",
      feeWallet: FEE_WALLET,
    });

    expect(settled?.received).toBeCloseTo(1.234567, 6);
  });

  it("returns null rather than a partial sum when a transaction cannot be read", async () => {
    // All-or-nothing: half a fee looks measured, and that is worse than a quote.
    const connection = fakeConnection([
      makeTx({ fee: 7_000, received: 1_000, rents: [], platformFee: 0 }),
      null,
    ]);

    const settled = await readSettledSweep({
      connection,
      signatures: ["a", "b"],
      owner: OWNER,
      outputAsset: "SOL",
      feeWallet: FEE_WALLET,
    });

    expect(settled).toBeNull();
  });

  it("returns null when there is nothing to read", async () => {
    const settled = await readSettledSweep({
      connection: fakeConnection([]),
      signatures: [],
      owner: OWNER,
      outputAsset: "SOL",
      feeWallet: FEE_WALLET,
    });

    expect(settled).toBeNull();
  });

  it("ignores wSOL left in a token account when the output is native", async () => {
    // The mint is wSOL either way; the branch is chosen by the configured output
    // asset, so a stray token balance must not be read as delivery on the native
    // path.
    const tx = makeTx({ fee: 7_000, received: 1_000_000, rents: [], platformFee: 0 });
    tx.meta!.postTokenBalances = [
      { accountIndex: 0, mint: WSOL_MINT, owner: OWNER, uiTokenAmount: { amount: "5", decimals: 9, uiAmount: 5e-9, uiAmountString: "0.000000005" } },
    ];

    const settled = await readSettledSweep({
      connection: fakeConnection([tx]),
      signatures: ["a"],
      owner: OWNER,
      outputAsset: "SOL",
      feeWallet: FEE_WALLET,
    });

    expect(settled?.received).toBeCloseTo(0.001, 9);
  });
});

