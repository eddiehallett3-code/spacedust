import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { plannedCloseAccounts } from "@/lib/solana/compose";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@/lib/utils/constants";
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
 * A safety panel that cries wolf on correct behaviour is worse than no panel, so
 * the expectation is now derived from the same function that builds the closes.
 */

const OWNER = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

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

function accounts(builds: SwapBuild[]): string[] {
  return plannedCloseAccounts({
    owner: new PublicKey(OWNER),
    builds,
    skipCloseMints: new Set<string>(),
    tokenPrograms: new Map([[USDC, "legacy"]]),
  });
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
});
