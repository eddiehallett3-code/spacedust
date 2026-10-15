/**
 * Whether the two actions are available, and why not when they are not.
 *
 * Extracted from the component for one reason: this gating has silently gone
 * wrong twice. A Void preview once settled on a phase that counted as busy, so
 * the panel rendered beautifully beside a send button that was disabled forever —
 * and a dead button reads as a broken button, not as a broken phase. The
 * conditions here are small enough to get wrong and important enough that a user
 * has no way to diagnose them from the screen.
 *
 * So they live in a pure function with tests, and the rules are stated once:
 * an action is available exactly when its reason not to be is absent.
 */
export interface PreparationGate {
  /** The destination is settled: valid, and verified if verification is required. */
  destinationReady: boolean;
  canPrepare: boolean;
  canSend: boolean;
  /** Why the preview is unavailable. Null when it is available. */
  blockedReason: string | null;
  /** Why signing is unavailable, when the preview itself was fine. */
  sendBlockedReason: string | null;
}

export interface PreparationInput {
  /** From `validateDestination`: the address is present, valid and not the owner. */
  destinationOk: boolean;
  /** From `destinationIsVerified`: true when verification is off or already done. */
  destinationVerified: boolean;
  /** Whether the user has left the verify-first switch on. */
  verifyRequired: boolean;
  /** How many tokens and NFTs are ticked. */
  itemCount: number;
  /** The first unreadable per-token amount, when there is one. */
  amountProblem: string | null;
  /** The recipient the current preview was built for, if there is one. */
  preparedFor: string | null;
  /** What is in the destination field right now. */
  recipient: string;
}

export function resolvePreparationGate(
  input: PreparationInput,
): PreparationGate {
  const destinationReady = input.destinationOk && input.destinationVerified;
  const amountsReadable = input.amountProblem === null;
  const canPrepare =
    destinationReady && input.itemCount > 0 && amountsReadable;

  // A prepared batch belongs to the address it was built for. If the field has
  // moved on, the preview on screen is about a different destination.
  const matchesPlan =
    input.preparedFor !== null && input.preparedFor === input.recipient.trim();
  const canSend = destinationReady && amountsReadable && matchesPlan;

  // Ordered by what the user most likely just did: the amount they typed, then
  // the destination, then what they selected. An empty or invalid address is
  // deliberately *not* listed — the field itself says so, and repeating it below
  // the buttons reads as two different problems.
  let blockedReason: string | null = null;
  if (input.amountProblem) {
    blockedReason = input.amountProblem;
  } else if (input.destinationOk && !input.destinationVerified && input.verifyRequired) {
    blockedReason =
      "This destination is not verified yet — send the test transfer, then check that it arrived.";
  } else if (input.itemCount === 0) {
    blockedReason = "Select at least one token or NFT to send.";
  }

  const sendBlockedReason =
    canSend || blockedReason !== null
      ? null
      : input.preparedFor !== null && !matchesPlan
        ? "The destination changed since this preview was built. Rebuild it before signing."
        : null;

  return {
    destinationReady,
    canPrepare,
    canSend,
    blockedReason,
    sendBlockedReason,
  };
}
