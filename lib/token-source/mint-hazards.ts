import type {
  MintFacts,
  MintHazard,
  MintHazardKind,
  MintHazardSeverity,
} from "@/types/token";

/**
 * What a token's mint can do to its holders.
 *
 * These are read from the mint account and nothing else, which is the point:
 * every one is a fact, not an inference. "The freeze authority is 4kT…" is
 * checkable; "this token is a scam" is not, and the app does not say it.
 *
 * The distinction matters because a live mint authority is not inherently bad —
 * USDC has one — so these notes state the power and let the holder judge. The
 * severity only decides how loudly the row says it.
 *
 * The shapes live in `types/token.ts` beside the rest of the domain; this file
 * is only the wording, so it stays pure and testable with no chain access.
 */

/** Re-exported so callers can import the pair from one place. */
export type { MintFacts, MintHazard, MintHazardKind, MintHazardSeverity };

/**
 * Turn facts into the notes a holder needs.
 *
 * Ordered by severity, then by how completely it removes your options: a
 * freeze authority and a permanent delegate are the two that mean "you may not
 * be able to sell", so they lead.
 */
export function describeMintHazards(facts: MintFacts): MintHazard[] {
  const hazards: MintHazard[] = [];

  if (facts.freezeAuthority) {
    hazards.push({
      kind: "freeze-authority",
      severity: "danger",
      label: "Can be frozen",
      detail: `The issuer can freeze this token account, so you may not be able to sell. The freeze authority is ${facts.freezeAuthority}.`,
    });
  }

  if (facts.permanentDelegate) {
    hazards.push({
      kind: "permanent-delegate",
      severity: "danger",
      label: "Permanent delegate",
      detail: `${facts.permanentDelegate} can move or burn this balance at any time, without your signature.`,
    });
  }

  if (facts.nonTransferable) {
    hazards.push({
      kind: "non-transferable",
      severity: "danger",
      label: "Cannot be sent",
      detail:
        "This token can be received but never transferred on, so the only way out is for the issuer to act.",
    });
  }

  if (facts.defaultFrozen) {
    hazards.push({
      kind: "default-frozen",
      severity: "warning",
      label: "New holders frozen",
      detail:
        "New token accounts for this mint start frozen, so a buyer may need the issuer to release them before selling.",
    });
  }

  if (facts.mintAuthority) {
    hazards.push({
      kind: "mint-authority",
      severity: "warning",
      label: "Issuer can mint",
      detail: `More supply can be created at any time, which dilutes every holder. The mint authority is ${facts.mintAuthority}. This is not automatically bad — many legitimate tokens keep one.`,
    });
  }

  if (facts.transferFeeBps != null && facts.transferFeeBps > 0) {
    const percent = facts.transferFeeBps / 100;
    hazards.push({
      kind: "transfer-fee",
      severity: "warning",
      label: `${percent}% transfer fee`,
      detail: `Every transfer of this token loses ${percent}% to the issuer, on the way in and on the way out.`,
    });
  }

  if (facts.mintCloseAuthority) {
    hazards.push({
      kind: "mint-close-authority",
      severity: "warning",
      label: "Mint can be closed",
      detail: `${facts.mintCloseAuthority} can close the mint account, which can leave holders with a token that cannot be moved.`,
    });
  }

  return hazards;
}

/** True when any note means "you may not be able to sell". */
export function hasSeriousHazard(hazards: readonly MintHazard[]): boolean {
  return hazards.some((hazard) => hazard.severity === "danger");
}
