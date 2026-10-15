import { isValidSolanaAddress } from "@/lib/utils/sanitize";

/**
 * Where a Payload batch is going.
 *
 * This file is deliberately pure: every rule here is checkable without a
 * network, so it can be tested, and so the UI can answer "may I send this?"
 * without a round trip.
 *
 * The rules come from measurement, not intuition
 * (`probes/tmp-payload-transfer-probe.mjs`):
 *
 *  - **Sending to your own wallet does not work.** The transfer leaves the
 *    balance in the same account, so the close that reclaims the rent is refused
 *    with `Custom: 11` (NonNativeHasBalance). Proof that an address is a wallet
 *    is not enough; it has to be someone else's.
 *  - **Receiving costs the sender money.** Sending to a wallet that has never
 *    held the mint creates a token account for it, and the sender pays that
 *    account's rent-exempt minimum — 1,488,440 lamports (165 bytes) when
 *    measured, which is more than most dust is worth. Surfaced, never absorbed.
 *
 * An address is a consent, so it has a state as well as a shape. Those states
 * exist to make one mistake impossible: sending a batch to an address that was
 * verified earlier, after the field has been changed to a different one.
 */

/** Why an address cannot be used. */
export type DestinationProblem =
  | "empty"
  | "invalid"
  | "self"
  /** On-chain shape problems, which only a reader can add: see the planner. */
  | "mint"
  | "token-account";

export interface DestinationCheck {
  ok: boolean;
  /** The address, when it parses. */
  address: string | null;
  problem?: DestinationProblem;
  /** What the user is told. Written here so the UI never invents its own. */
  message?: string;
}

/**
 * The offline half of validating a destination: is it an address at all, and is
 * it somebody else's?
 *
 * The on-chain half — "this is a mint, not a wallet" or "this is a token
 * account" — needs an RPC read and lives in the planner, which adds the same
 * `problem` values rather than inventing new copy.
 */
export function validateDestination(
  value: string,
  owner: string | null,
): DestinationCheck {
  const address = value.trim();

  if (address.length === 0) {
    return { ok: false, address: null, problem: "empty" };
  }

  if (!isValidSolanaAddress(address)) {
    return {
      ok: false,
      address: null,
      problem: "invalid",
      message: "That is not a valid Solana address.",
    };
  }

  if (owner !== null && address === owner) {
    return {
      ok: false,
      address,
      problem: "self",
      message:
        "That is the wallet you are sending from. A send to yourself cannot be completed, and it would create no rent to reclaim.",
    };
  }

  return { ok: true, address };
}

/**
 * What a scanned QR code means.
 *
 * A code in the Solana ecosystem holds one of a few things, in rough order of how
 * often they turn up:
 *
 *  - **a bare address** — what a wallet's own "receive" code shows;
 *  - **a payment request**, `solana:<address>?amount=…&spl-token=…`;
 *  - **a block-explorer link**, `https://solscan.io/account/<address>`;
 *  - **something else entirely**, including addresses on other chains.
 *
 * The job is to end with an address or a *reason*, never a guess. A QR code is
 * opaque until it is decoded, so "that didn't work" would leave the user unable
 * to tell whether the code was wrong, the camera was wrong, or the app was.
 *
 * One thing this deliberately does not do: treat a scan as *verification*. A
 * scannable code is as easy to print as a paste is to intercept, so a scanned
 * address runs through exactly the same checks as a typed one — the grouping a
 * human reads, and the test transfer if it is switched on. Scanning is a faster
 * way to fill the field, not a shorter path past it.
 */
export type ScannedDestination =
  | {
      ok: true;
      address: string;
      /** What the code actually held, so the UI can say where the address came from. */
      source: "address" | "payment" | "link";
    }
  | { ok: false; problem: string };

export function parseScannedDestination(text: string): ScannedDestination {
  const raw = text.trim();

  if (raw.length === 0) {
    return { ok: false, problem: "That code was empty." };
  }
  if (raw.length > 512) {
    return {
      ok: false,
      problem:
        "That code is far longer than any address or payment link, so nothing was filled in.",
    };
  }

  // 1. A bare address.
  if (isValidSolanaAddress(raw)) {
    return { ok: true, address: raw, source: "address" };
  }

  // 2. A Solana Pay request. The parameters are dropped on purpose: this field
  // is a destination, and an amount inside the code is not a decision we get to
  // make on the user's behalf.
  const payment = /^solana:([1-9A-HJ-NP-Za-km-z]{32,44})(?:[?#].*)?$/.exec(raw);
  if (payment?.[1] && isValidSolanaAddress(payment[1])) {
    return { ok: true, address: payment[1], source: "payment" };
  }

  // 3. A link. Only the *last path segment* is considered, and only when it is
  // the whole of that segment — so a URL cannot carry one address in its path
  // and another in its query and have us guess which was meant.
  const url = asUrl(raw);
  if (url) {
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && isValidSolanaAddress(last)) {
      return { ok: true, address: last, source: "link" };
    }
  }

  // Name the one mistake worth naming: a code from another chain.
  if (/^(ethereum:|bitcoin:|litecoin:|0x[0-9a-f]{40})/i.test(raw)) {
    return {
      ok: false,
      problem:
        "That code is for a different chain, not a Solana address. Nothing was filled in.",
    };
  }

  return {
    ok: false,
    problem:
      "That code did not contain a Solana address, a Solana Pay request or an explorer link. Keep scanning, or paste the address instead.",
  };
}

/** A URL from text that may or may not carry a scheme. */
function asUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    // `solscan.io/account/X` is what a person would paste, and what some codes
    // hold. Try it with a scheme before giving up.
  }
  try {
    return new URL(`https://${raw}`);
  } catch {
    return null;
  }
}


/**
 * The test transfer, in lamports.
 *
 * 0.001 SOL: enough to be visible in the receiving wallet's history, small
 * enough that a mistake stays a mistake.
 *
 * **It is not a loss.** The lamports arrive at the address the user asked for,
 * which is where the batch was going anyway — a test transfer is the first send,
 * made on its own so it can be confirmed before the rest follows. It only
 * becomes a loss if that address is not the one intended, and that is precisely
 * the mistake it exists to catch.
 *
 * What it proves, and what it cannot: a wrong address that happens to be a real
 * wallet still receives the test, so arrival confirms the address **can**
 * receive — it never confirms that the intended person owns it. A clipboard swap
 * aimed at an attacker's address passes this check. That is why the page shows
 * the address for a human to compare instead of treating verification as a
 * substitute for looking.
 *
 * It is deliberately not a token amount: every wallet can receive SOL and it
 * needs no account created at the destination, so the only costs are the network
 * fee and this amount.
 */
export const TEST_TRANSFER_LAMPORTS = 1_000_000;

/** A test transfer that has been sent, and whether it landed. */
export interface Verification {
  /** The address the test was sent to. This is what gets locked in. */
  address: string;
  /** The test's signature, once it has been signed and sent. */
  signature: string | null;
  /** What the test carried, in lamports. */
  lamports: number;
  /**
   * True once the arrival has been seen on chain.
   *
   * Read from the recipient's own balance, which works whether or not the user
   * controls that wallet — a balance is public. It proves the *address* can
   * receive; it cannot prove who owns it, and the page says so instead of
   * implying otherwise.
   */
  arrived: boolean;
}

/**
 * Whether a send may proceed.
 *
 * When verification is switched off the destination simply has to be valid,
 * which `validateDestination` has already established. When it is switched on,
 * the batch may only be built against the address that was verified — a
 * different address is not a warning to display beside a send that happens
 * anyway, it is a refusal.
 */
export function destinationIsVerified(
  verification: Verification | null,
  address: string,
  required: boolean,
): boolean {
  if (!required) return true;
  return verification !== null && verification.address === address;
}

/**
 * How the address on screen differs from the one that was verified.
 *
 * Returned as two addresses and a sentence rather than a boolean, because the
 * only useful warning is one that names both: "the destination changed" leaves
 * the user to guess which change, and the whole risk being guarded against is a
 * clipboard swap they did not notice.
 */
export function destinationDrift(
  verification: Verification | null,
  address: string,
): {
  drifted: boolean;
  /** The address that was verified. */
  from: string | null;
  /** The address on screen now. */
  to: string | null;
  message: string | null;
} {
  const candidate = address.trim();
  const from = verification?.address ?? null;

  if (verification === null || candidate === "") {
    return { drifted: false, from, to: candidate || null, message: null };
  }

  if (verification.address === candidate) {
    return { drifted: false, from, to: candidate, message: null };
  }

  return {
    drifted: true,
    from,
    to: candidate,
    message:
      "The destination changed after it was verified. The batch will not be built until this address is verified in its own right.",
  };
}
