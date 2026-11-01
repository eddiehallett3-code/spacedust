import { describe, expect, it } from "vitest";
import {
  describeMintHazards,
  hasSeriousHazard,
} from "@/lib/token-source/mint-hazards";
import type { MintFacts } from "@/types/token";

/**
 * The hazard notes shown on a wallet scan.
 *
 * Two things are being protected here. The first is that the notes are *facts*
 * — "the freeze authority is X" — because the app's whole argument is that it
 * does not overstate. The second is the opposite failure: a note that fires on
 * an ordinary token turns the list into noise, and noise is how a real warning
 * gets ignored.
 */

const ISSUER = "4Tk9rQ2mQxU7bFz8yVw3pN6cJmL1sD5hG2aE4kN8vR3c";
const DELEGATE = "8xLp3fD7qWm2yTn6bVk1cR9sJ4hG5aE8nZ3uP6dM2wQ";
const CLOSER = "9Yq2mK5vB8nR3tL7wX1zC4fH6jD9sP2gA5eU8oI3rN";

/** A token with nothing wrong with it: every authority revoked. */
function facts(overrides: Partial<MintFacts> = {}): MintFacts {
  return {
    mint: "Mint1111111111111111111111111111111111111111",
    program: "legacy",
    mintAuthority: null,
    freezeAuthority: null,
    transferFeeBps: null,
    permanentDelegate: null,
    nonTransferable: false,
    defaultFrozen: false,
    mintCloseAuthority: null,
    ...overrides,
  };
}

describe("describeMintHazards", () => {
  it("says nothing about a token whose authorities are all revoked", () => {
    expect(describeMintHazards(facts())).toEqual([]);
  });

  it("names the freeze authority, because that is the one that traps a holder", () => {
    const hazards = describeMintHazards(facts({ freezeAuthority: ISSUER }));

    expect(hazards).toHaveLength(1);
    expect(hazards[0]).toMatchObject({
      kind: "freeze-authority",
      severity: "danger",
      label: "Can be frozen",
    });
    // The address is the evidence, so it has to be in the sentence.
    expect(hazards[0]?.detail).toContain(ISSUER);
  });

  it("treats a permanent delegate as danger", () => {
    const hazards = describeMintHazards(facts({ permanentDelegate: DELEGATE }));

    expect(hazards[0]).toMatchObject({
      kind: "permanent-delegate",
      severity: "danger",
    });
    expect(hazards[0]?.detail).toContain(DELEGATE);
  });

  it("treats a non-transferable mint as danger", () => {
    const hazards = describeMintHazards(facts({ nonTransferable: true }));

    expect(hazards[0]).toMatchObject({
      kind: "non-transferable",
      severity: "danger",
      label: "Cannot be sent",
    });
  });

  it("warns about a live mint authority without calling it malicious", () => {
    // USDC keeps a mint authority. The note states the power and says so, rather
    // than implying every mintable token is a scam.
    const hazards = describeMintHazards(facts({ mintAuthority: ISSUER }));

    expect(hazards[0]).toMatchObject({
      kind: "mint-authority",
      severity: "warning",
    });
    expect(hazards[0]?.detail).toContain("not automatically bad");
  });

  it("converts basis points into a percentage a holder can read", () => {
    const hazards = describeMintHazards(facts({ transferFeeBps: 500 }));

    expect(hazards[0]).toMatchObject({
      kind: "transfer-fee",
      severity: "warning",
      label: "5% transfer fee",
    });
  });

  it("stays quiet when the fee is zero", () => {
    expect(describeMintHazards(facts({ transferFeeBps: 0 }))).toEqual([]);
  });

  it("warns about a mint close authority", () => {
    const hazards = describeMintHazards(facts({ mintCloseAuthority: CLOSER }));

    expect(hazards[0]).toMatchObject({
      kind: "mint-close-authority",
      severity: "warning",
    });
  });

  it("warns when new accounts start frozen", () => {
    const hazards = describeMintHazards(facts({ defaultFrozen: true }));

    expect(hazards[0]).toMatchObject({
      kind: "default-frozen",
      severity: "warning",
    });
  });

  it("puts the dangerous ones first", () => {
    const hazards = describeMintHazards(
      facts({
        mintAuthority: ISSUER,
        freezeAuthority: ISSUER,
        transferFeeBps: 300,
      }),
    );

    expect(hazards[0]?.severity).toBe("danger");
    expect(hazards.at(-1)?.severity).toBe("warning");
  });

  it("reports every power at once rather than stopping at the first", () => {
    const hazards = describeMintHazards(
      facts({
        freezeAuthority: ISSUER,
        permanentDelegate: DELEGATE,
        nonTransferable: true,
        mintAuthority: ISSUER,
        transferFeeBps: 250,
        defaultFrozen: true,
        mintCloseAuthority: CLOSER,
      }),
    );

    expect(hazards).toHaveLength(7);
    expect(new Set(hazards.map((hazard) => hazard.kind)).size).toBe(7);
  });
});

describe("hasSeriousHazard", () => {
  it("is false for warnings alone", () => {
    expect(
      hasSeriousHazard(describeMintHazards(facts({ mintAuthority: ISSUER }))),
    ).toBe(false);
  });

  it("is true once something can stop you selling", () => {
    expect(
      hasSeriousHazard(describeMintHazards(facts({ freezeAuthority: ISSUER }))),
    ).toBe(true);
  });
});
