/**
 * The Turtle-holder waiver.
 *
 * Hold ten of the collection and the rent-recovery fee is zero while you hold
 * them. This module is the single piece of session state that carries that
 * decision, and it exists rather than a parameter because the fee is priced in
 * thirteen places — nine of them display, four of them transaction builders — and
 * a preview that shows 1.5% next to a transaction that charges 0 is worse than
 * either number on its own.
 *
 * HOW IT IS SET: only by `useHolderWaiver` in the browser, after the server has
 * answered whether the connected wallet qualifies. It is never set during a
 * server render, and it starts false everywhere, so the failure mode is a fee
 * that is charged when it should not be — never one that goes missing.
 *
 * WHY A MODULE FLAG AND NOT AN ARGUMENT: the alternative is threading a boolean
 * through every panel, hook and builder that touches rent. That is a large,
 * mechanical diff whose failure mode is a single call site forgetting the flag,
 * which shows up as a fee charged to a holder in one flow and nowhere else. One
 * flag cannot be forgotten by half the call sites.
 *
 * The cost of that choice is honest to state: this is process-wide, so a browser
 * running two wallets in two tabs would share it. One wallet per tab is the
 * assumption the rest of the app already makes.
 */

let waived = false;

/** Called by the entitlement hook when the answer for the connected wallet changes. */
export function setHolderWaiver(next: boolean): void {
  waived = next;
}

/** Read by the fee helpers. False on the server, and false until asked. */
export function isHolderWaived(): boolean {
  return waived;
}

/**
 * Clear it. Used when a wallet disconnects or is switched, and by tests, so a
 * previous answer cannot be inherited by the next wallet.
 */
export function resetHolderWaiver(): void {
  waived = false;
}
