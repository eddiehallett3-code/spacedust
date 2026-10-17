import { describe, expect, it } from "vitest";
import { PublicKey, type Connection } from "@solana/web3.js";
import { composePackUnits, plannedCloseAccounts } from "@/lib/solana/compose";
import { createComputeBudgetInstructions } from "@/lib/solana/instructions";
import { packTransactions } from "@/lib/solana/pack";
import { auditInstructions } from "@/lib/security/instruction-audit";
import { JUPITER_PROGRAM_ID } from "@/lib/security/program-ids";
import {
  JUP_MINT,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  WSOL_MINT,
} from "@/lib/utils/constants";
import type { ApiInstruction } from "@/types/jupiter";
import type { SwapBuild } from "@/types/sweep";

/**
 * "The audit is told about every close the composer will make."
 *
 * These two disagreed, and the visible symptom was a warning on a batch that was
 * doing exactly the right thing: the composer falls back to the derived ATA when
 * the scanner could not name the account holding a balance, while the audit's
 * expected-closes list was built from `build.tokenAccount` alone. The close then
 * looked like one "the plan did not name".
 *
 * The same warning came back one level up — from Jupiter's own cleanup, which
 * closes the wallet's wrapped-SOL account on a SOL-output swap, once per swap.
 * It is covered below too.
 *
 * A safety panel that cries wolf on correct behaviour is worse than no panel, so
 * the expectation is now derived from the same code that builds the closes.
 */

const OWNER = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
const FEE_WALLET = "3gJFX3KFfsPFERu437FeUBbH2B6twpfBD5ZkoZGsgUty";
const STRANGER = "9qDz4uC7M7oJdhCErKEtLzm4pkdjdc7uQAFggy5jYrmt";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

/** The canonical ATA the composer derives, computed independently here. */
function derivedAta(owner: string, mint: string, token2022 = false): string {
  const [address] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBuffer(),
      new PublicKey(token2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
  );
  return address.toBase58();
}

function build(overrides: Partial<SwapBuild> = {}): SwapBuild {
  return {
    mint: USDC,
    symbol: "USDC",
    logoUri: null,
    inAmount: "1000",
    tokenAccount: null,
    outAmount: "1",
    otherAmountThreshold: "1",
    outputMint: "So11111111111111111111111111111111111111112",
    priceImpactPct: null,
    routeLabels: [],
    computeBudgetInstructions: [],
    bundle: { setup: [], swap: {} as never, cleanup: null, other: [] },
    addressesByLookupTableAddress: null,
    lastValidBlockHeight: 0,
    error: null,
    ...overrides,
  };
}
/**
 * A connection that answers the composer's one batched close-target read.
 *
 * The composer now reads each target's **own** deposit and prices the fee from it,
 * so a test that expects a fee has to supply a deposit — which is the behaviour
 * worth pinning: the same account holding more earns a proportionally larger fee,
 * instead of a flat figure that was only right for a 165-byte account.
 */
function connectionWith(
  lamports: number,
  program: string = TOKEN_PROGRAM_ID,
): Connection {
  return {
    getMultipleAccountsInfo: async (addresses: PublicKey[]) =>
      addresses.map(() => ({
        data: Buffer.alloc(0),
        executable: false,
        lamports,
        owner: new PublicKey(program),
        rentEpoch: 0,
      })),
  } as unknown as Connection;
}



function accounts(builds: SwapBuild[]): string[] {
  return plannedCloseAccounts({
    owner: new PublicKey(OWNER),
    builds,
    skipCloseMints: new Set<string>(),
    tokenPrograms: new Map([[USDC, "legacy"]]),
  });
}

/**
 * Jupiter's cleanup instruction, shaped exactly as `/api/plan` forwards it: a
 * token-program `CloseAccount` (`data: [9]`, base64 `CQ==`) whose first account
 * is the one closed and whose second is the refund target.
 */
function cleanupClose(account: string, refund: string): ApiInstruction {
  return {
    programId: TOKEN_PROGRAM_ID,
    accounts: [
      { pubkey: account, isWritable: true, isSigner: false },
      { pubkey: refund, isWritable: true, isSigner: false },
      { pubkey: refund, isWritable: false, isSigner: true },
    ],
    data: "CQ==",
  };
}

/** Two SOL-output swaps that share the wallet's wrapped-SOL account. */
function wrappedSolBuilds(): SwapBuild[] {
  const wrapped = derivedAta(OWNER, WSOL_MINT);
  return [USDC, BONK].map((mint, index) =>
    build({
      mint,
      symbol: index === 0 ? "USDC" : "BONK",
      tokenAccount: null,
      outputMint: WSOL_MINT,
      bundle: {
        setup: [],
        swap: {} as never,
        cleanup: cleanupClose(wrapped, OWNER),
        other: [],
      },
    }),
  );
}

/** The stand-in for Jupiter's opaque swap call — the same shape `/api/plan` forwards. */
function apiSwap(): ApiInstruction {
  return { programId: JUPITER_PROGRAM_ID, accounts: [], data: "AQ==" };
}

/** A build whose swap is a real, well-formed Jupiter instruction. */
function swapBuild(overrides: Partial<SwapBuild> = {}): SwapBuild {
  return build({
    tokenAccount: derivedAta(OWNER, USDC),
    bundle: { setup: [], swap: apiSwap(), cleanup: null, other: [] },
    ...overrides,
  });
}

/** Every System transfer in a unit, as `{ to, lamports }`. */
function systemTransfers(instructions: { programId: PublicKey; data: Buffer; keys: { pubkey: PublicKey }[] }[]) {
  return instructions
    .filter((ix) => ix.programId.toBase58() === SYSTEM_PROGRAM_ID)
    .map((ix) => ({
      to: ix.keys[1]?.pubkey.toBase58(),
      lamports: ix.data.readBigUInt64LE(4),
    }));
}

describe("plannedCloseAccounts", () => {
  it("names the canonical account the scanner reported", () => {
    // The ordinary case: the holding is in its ATA, the swap drains it, and the
    // close is declared to the audit.
    const reported = derivedAta(OWNER, USDC);
    expect(accounts([build({ tokenAccount: reported })])).toEqual([reported]);
  });

  it("names the DERIVED account when the scanner could not", () => {
    // The bug: the composer closes this, and the audit used to be told nothing.
    expect(accounts([build({ tokenAccount: null })])).toEqual([
      derivedAta(OWNER, USDC),
    ]);
  });

  it("declares nothing for a non-canonical account, because nothing is closed", () => {
    // Jupiter's swap only ever drains the ATA, so a balance sitting in an old
    // non-standard account is left alone: no close means no expectation to
    // report, and the composer says why in a warning instead.
    expect(
      accounts([
        build({ tokenAccount: "DqHAep7hD2VJ4rsWSxkLoBSRMiLkdw7y8DLx1htrryts" }),
      ]),
    ).toEqual([]);
  });

  it("names nothing for a mint whose close is skipped", () => {
    // A transfer-fee mint keeps a residue, so there is no close to declare.
    expect(
      plannedCloseAccounts({
        owner: new PublicKey(OWNER),
        builds: [build({ tokenAccount: null })],
        skipCloseMints: new Set([USDC]),
        tokenPrograms: new Map([[USDC, "legacy"]]),
      }),
    ).toEqual([]);
  });

  it("names the one wrapped-SOL account each SOL-output swap closes in cleanup", () => {
    // Jupiter wraps a SOL output into the wallet's wrapped-SOL account and
    // closes it again in each swap's cleanup — so a two-token sweep closes this
    // *one* account twice. Declared once here, the audit stops reporting it as
    // "an account the plan did not name" for every swap in the batch.
    const declared = accounts(wrappedSolBuilds());
    expect(declared).toHaveLength(3);
    expect(new Set(declared)).toEqual(
      new Set([
        derivedAta(OWNER, USDC),
        derivedAta(OWNER, BONK),
        derivedAta(OWNER, WSOL_MINT),
      ]),
    );
  });

  it("declares no cleanup close whose refund is not your wallet", () => {
    // A cleanup close paying someone else is refused by the audit on its own
    // terms. Declaring it here would excuse it, so it must not be declared.
    const wrapped = derivedAta(OWNER, WSOL_MINT);
    expect(
      accounts([
        build({
          tokenAccount: derivedAta(OWNER, USDC),
          outputMint: WSOL_MINT,
          bundle: {
            setup: [],
            swap: {} as never,
            cleanup: cleanupClose(wrapped, STRANGER),
            other: [],
          },
        }),
      ]),
    ).toEqual([derivedAta(OWNER, USDC)]);
  });

  it("ignores a cleanup that is not a close", () => {
    // Only a token-program CloseAccount is a close; anything else in cleanup is
    // not something this list may claim.
    const source = derivedAta(OWNER, USDC);
    expect(
      accounts([
        build({
          tokenAccount: source,
          bundle: {
            setup: [],
            swap: {} as never,
            // InitializeAccount (index 1), not CloseAccount (index 9).
            cleanup: { ...cleanupClose(source, OWNER), data: "AQ==" },
            other: [],
          },
        }),
      ]),
    ).toEqual([source]);
  });
});

/**
 * "One fee transfer per account the sweep closes for its rent."
 *
 * A sweep earns its rent back by closing the accounts its own swaps emptied, and
 * that reclaim is charged like every other flow here: a plain SOL transfer of
 * 1.5% of the rent, sitting after the close that returned it. These lock the
 * amount and the position, because a fee that is priced per *transaction*
 * instead of per *account* would silently scale with how the packer groups
 * swaps — the exact bug the per-account pricing exists to avoid.
 */
describe("composePackUnits rent-reclaim fee", () => {
  const owner = new PublicKey(OWNER);
  /** 1.5% of one fresh token account's deposit, floored: 1,488,440 × 150 bps. */
  const closeFee = 22_326;
  const RENT = 1_488_440;

  it("adds one fee transfer, directly after the close that funds it", async () => {
    const { units } = await composePackUnits({
      owner,
      builds: [swapBuild()],
      skipCloseMints: new Set<string>(),
      tokenPrograms: new Map([[USDC, "legacy"]]),
      connection: connectionWith(RENT),
      feeWallet: FEE_WALLET,
      reclaimFeeBps: 150,
    });

    const instructions = units[0]?.instructions ?? [];
    const closeIndex = instructions.findIndex(
      (ix) => ix.programId.toBase58() === TOKEN_PROGRAM_ID && ix.data[0] === 9,
    );
    const transferIndex = instructions.findIndex(
      (ix) => ix.programId.toBase58() === SYSTEM_PROGRAM_ID,
    );

    // Immediately after the close: the rent has been credited to the wallet by
    // then, so the fee can never be an unfunded transfer.
    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(transferIndex).toBe(closeIndex + 1);
    expect(systemTransfers(instructions)).toEqual([
      { to: FEE_WALLET, lamports: BigInt(closeFee) },
    ]);
  });

  it("builds no transfer when fees are off, or the fee is zero", async () => {
    // Either guard alone must mean "charge nothing": a null wallet is "fees
    // off", and a zero per-account fee is the planner's answer when the fee
    // wallet is unfunded or there is no rent to price against.
    const off = await composePackUnits({
      owner,
      builds: [swapBuild()],
      skipCloseMints: new Set<string>(),
      tokenPrograms: new Map([[USDC, "legacy"]]),
      connection: connectionWith(RENT),
      feeWallet: null,
      reclaimFeeBps: 150,
    });
    const zero = await composePackUnits({
      owner,
      builds: [swapBuild()],
      skipCloseMints: new Set<string>(),
      tokenPrograms: new Map([[USDC, "legacy"]]),
      connection: connectionWith(RENT),
      feeWallet: FEE_WALLET,
      reclaimFeeBps: 0,
    });

    expect(systemTransfers(off.units[0]?.instructions ?? [])).toEqual([]);
    expect(systemTransfers(zero.units[0]?.instructions ?? [])).toEqual([]);
  });

  it("charges nothing when nothing is closed", async () => {
    // A non-canonical holding is left alone: Jupiter's swap drains only the ATA,
    // so there is no close, no rent, and therefore no fee.
    const { units } = await composePackUnits({
      owner,
      builds: [
        swapBuild({ tokenAccount: "DqHAep7hD2VJ4rsWSxkLoBSRMiLkdw7y8DLx1htrryts" }),
      ],
      skipCloseMints: new Set<string>(),
      tokenPrograms: new Map([[USDC, "legacy"]]),
      connection: connectionWith(RENT),
      feeWallet: FEE_WALLET,
      reclaimFeeBps: 150,
    });

    expect(units[0]?.rentReclaim).toBe(false);
    expect(systemTransfers(units[0]?.instructions ?? [])).toEqual([]);
  });
});

/**
 * The reported symptom, reproduced end to end.
 *
 * A four-token SOL sweep closes the wallet's **one** wrapped-SOL account four
 * times — once in each swap's cleanup — and the panel showed "the batch closes …,
 * an account the plan did not name" four times about it.
 *
 * This runs the real pipeline (compose → pack → `plannedCloseAccounts` → audit)
 * and asserts both directions in one place: with the account declared, nothing
 * is unexpected; with the declaration removed, the same four warnings come back.
 * That pairing is what makes it a regression test rather than a restatement of
 * the fix.
 */
describe("a four-token SOL sweep declares its own closes", () => {
  const owner = new PublicKey(OWNER);
  const wrapped = derivedAta(OWNER, WSOL_MINT);
  /** 1.5% of one fresh token account's deposit, floored: 1,488,440 × 150 bps. */
  const closeFee = 22_326;
  const RENT = 1_488_440;
  const mints = [
    USDC,
    BONK,
    JUP_MINT,
    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  ];

  function solSwapBuild(mint: string, symbol: string): SwapBuild {
    return build({
      mint,
      symbol,
      tokenAccount: derivedAta(OWNER, mint),
      outputMint: WSOL_MINT,
      bundle: {
        setup: [],
        swap: apiSwap(),
        // Every swap wraps SOL into the same account and closes it again.
        cleanup: cleanupClose(wrapped, OWNER),
        other: [],
      },
    });
  }

  it("warns about none of them — and would warn four times without the declaration", async () => {
    const builds = mints.map((mint, index) => solSwapBuild(mint, `T${index}`));
    const composeInput = {
      owner,
      builds,
      skipCloseMints: new Set<string>(),
      tokenPrograms: new Map<string, "legacy" | "token2022">(),
    };

    const { units } = await composePackUnits({
      ...composeInput,
      connection: connectionWith(RENT),
      feeWallet: FEE_WALLET,
      reclaimFeeBps: 150,
    });
    const prologue = createComputeBudgetInstructions(800_000, 1_000);
    const packed = packTransactions({
      units,
      prologue,
      payer: owner,
      blockhash: "11111111111111111111111111111111",
      lookupTables: [],
    });
    const instructions = [
      ...prologue,
      ...units.flatMap((unit) => unit.instructions),
    ];

    // Four swaps really do close that one account four times.
    const closes = instructions.filter(
      (ix) =>
        ix.programId.toBase58() === TOKEN_PROGRAM_ID &&
        ix.data[0] === 9 &&
        ix.keys[0]?.pubkey.toBase58() === wrapped,
    );
    expect(closes).toHaveLength(4);
    expect(packed.transactions.length).toBeGreaterThan(0);

    const expectedCloses = plannedCloseAccounts(composeInput);
    expect(expectedCloses).toContain(wrapped);

    const expectations = {
      flow: "sweep" as const,
      owner: OWNER,
      feeWallet: FEE_WALLET,
      expectedFeeLamports: mints.length * closeFee,
      allowedSolDestinations: [wrapped],
    };

    // As built: every close was declared, so none is "unexpected".
    const declared = auditInstructions(instructions, {
      ...expectations,
      expectedCloses,
    });
    expect(
      declared.findings.filter((f) => f.code === "close-unexpected"),
    ).toEqual([]);
    expect(declared.ok).toBe(true);

    // Without the wrapped-SOL account in the list — the bug — the same one
    // account is reported once per swap. Still only information, never a
    // refusal, which is why it reached the user instead of stopping the sweep.
    const undeclared = auditInstructions(instructions, {
      ...expectations,
      expectedCloses: expectedCloses.filter((account) => account !== wrapped),
    });
    expect(
      undeclared.findings.filter((f) => f.code === "close-unexpected"),
    ).toHaveLength(mints.length);
    expect(undeclared.ok).toBe(true);
  });
});
