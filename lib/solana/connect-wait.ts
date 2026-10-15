/**
 * When to stop waiting for a wallet to finish connecting.
 *
 * Kept pure, and separate from the adapter that polls it, because getting this
 * wrong is not a cosmetic bug: the first version of this app's WalletConnect
 * support used an adapter that decided "the wallet is not coming" from a **stale**
 * reading of AppKit's state. It threw `AppKit adapter closed` about half a second
 * after opening the wallet list — before the user could possibly have picked
 * anything — so that adapter could never connect, with any wallet, on any device.
 *
 * The rule here is written so that reading the state *freshly* is the only way to
 * satisfy it:
 *
 *   - an account means connected, immediately and always;
 *   - a closed modal is only "the user said no" after it has stayed closed and
 *     idle — a handshake that has moved to the wallet app closes the modal first,
 *     and the account arrives seconds later;
 *   - and patience runs out eventually, because "no answer yet" and "no answer
 *     ever" must not look the same to the person waiting.
 */

/** What AppKit says about the connection, read live. */
export interface ConnectWaitState {
  /** The connected account, or null while there is none. */
  address: string | null;
  /** Whether AppKit's wallet list is open right now. */
  modalOpen: boolean;
  /** Whether AppKit is mid-handshake rather than idle. */
  loading: boolean;
}

export type ConnectWaitStep = "connected" | "wait" | "dismissed" | "timeout";

/**
 * How long a person may take to pick a wallet and approve it in another app.
 *
 * Generous on purpose. On a phone this includes finding the wallet app, unlocking
 * it, reading what is being signed and coming back — the point of the limit is to
 * notice that nothing will ever arrive, not to rush a human.
 */
export const CONNECT_WAIT_MS = 180_000;

/**
 * How long a closed, idle modal must stay closed before it counts as a refusal.
 *
 * Not zero, and that is the whole lesson: AppKit closes its list the moment a
 * wallet is chosen, while the session is still being established in the wallet
 * app. Judging on the first closed reading would abandon every real connection.
 */
export const DISMISS_GRACE_MS = 10_000;

export function nextConnectStep(input: {
  state: ConnectWaitState;
  /** Total time waited so far, in ms. */
  waitedMs: number;
  /** How long the modal has been closed *and* idle, in ms; 0 while open or busy. */
  idleClosedMs: number;
}): ConnectWaitStep {
  if (input.state.address) return "connected";
  if (input.waitedMs >= CONNECT_WAIT_MS) return "timeout";
  // Both conditions, not just the timer: a caller that forgets to reset
  // `idleClosedMs` must not be able to turn a handshake in progress into a
  // refusal. The state is the authority; the timer only supplies patience.
  if (
    !input.state.modalOpen &&
    !input.state.loading &&
    input.idleClosedMs >= DISMISS_GRACE_MS
  ) {
    return "dismissed";
  }
  return "wait";
}
