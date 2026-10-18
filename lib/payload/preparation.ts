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

/**
 * A stable description of the request a preview was built for.
 *
 * `execute()` signs the batch that was prepared, not whatever is ticked when the
 * button is finally pressed. So every input that changes what that batch would
 * contain — the destination, the selected tokens, a typed amount, the SOL
 * switch — has to change this key, which lets the component discard a preview
 * the moment its request moves. The same rule the sweep and the two burn flows
 * apply (`lib/sweep/preview.ts`); Payload used to re-check only the destination,
 * which meant unticking a token after previewing still sent it.
 *
 * Order-independent on purpose. The scanner's token order is not a property of
 * the request, and a rescan that merely reorders the same holdings must not
 * throw away a preview the user is reading.
 *
 * The separators are safe because a mint and an asset id are base58 (no `:`,
 * `,` or `|`) and an amount is digits. A missing SOL amount is spelled
 * `invalid` rather than left empty, so "SOL selected with a bad amount" cannot
 * collide with "SOL not selected".
 */
export function payloadRequestKey(input: {
  /** The address field, as it stands now. */
  recipient: string;
  /** The effective token list, with any partial amount already applied. */
  tokens: readonly { mint: string; rawAmount: string }[];
  /** Selected NFT / cNFT ids. */
  assets: readonly string[];
  /** The SOL amount to send, or null when SOL is not part of the batch. */
  solLamports: string | null;
  /** Whether the SOL row is ticked at all. */
  solSelected: boolean;
}): string {
  const tokens = input.tokens
    .map((token) => `${token.mint}:${token.rawAmount}`)
    .sort()
    .join(",");
  const assets = [...input.assets].sort().join(",");
  const sol = input.solSelected
    ? `sol:${input.solLamports ?? "invalid"}`
    : "";

  return [input.recipient.trim(), tokens, assets, sol].join("|");
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
