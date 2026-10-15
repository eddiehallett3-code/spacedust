/**
 * Blockhash lifetime helpers.
 *
 * A transaction's blockhash is valid for only ~150 slots (roughly a minute).
 * Past that the cluster rejects it outright and wallets refuse to sign, each
 * reporting it in their own words — Phantom says "Simulation failed …
 * Blockhash not found". It reads as a random failure, and the app's own preview
 * simulation cannot catch it, because that runs with `replaceRecentBlockhash`
 * and therefore passes no matter how stale the real blockhash is.
 *
 * This lives in its own module, free of any `"use client"` directive, so both
 * the React hooks and the plain submission pipeline can share it.
 */

import type { Connection } from "@solana/web3.js";

/**
 * Slots of headroom we insist on before sending anything.
 *
 * A transaction sent with a second or two of blockhash life left is worse than
 * useless. The RPC accepts it (preflight passes, because the blockhash *is*
 * still valid at that instant), no leader then includes it in time, and it is
 * silently dropped — leaving the user told "we could not confirm this" with
 * their tokens still in the wallet. Observed exactly that on mainnet with three
 * queued transactions.
 *
 * 30 slots is roughly 12 seconds, which is far more than a send needs while
 * still leaving ~120 slots of a fresh 150-slot window for the user to approve.
 */
export const BLOCKHASH_SEND_MARGIN_SLOTS = 30;

/**
 * Headroom a *signature prompt* must have before we ask a human to approve.
 *
 * Deliberately separate from, and much larger than, `BLOCKHASH_SEND_MARGIN_SLOTS`.
 * That one answers "can this still land?" at the instant of sending. This one
 * answers "will it still be sendable *after* someone has read their wallet and
 * pressed approve?" — and a person takes seconds, not milliseconds.
 *
 * The failure this prevents, observed on mainnet: a preview sat open while the
 * user looked at it, the blockhash aged, the transaction was broadcast with a
 * sliver of window left, the RPC accepted it, and no leader ever included it.
 * The user was told "accepted by the network but never included", which is
 * accurate and useless. Rebuilding the blockhash *before* the prompt rather
 * than after means they always start signing with a full window ahead.
 *
 * 75 slots is roughly 30 seconds: comfortably longer than approving takes,
 * while still leaving most of the ~150-slot window for the send itself.
 */
export const BLOCKHASH_APPROVAL_MARGIN_SLOTS = 75;

/**
 * Has this blockhash aged out of the cluster's recent-blockhash window?
 *
 * `marginSlots` is the headroom demanded: pass 0 for the bare question "can
 * this still land at all?", which is what you want when deciding whether an
 * unconfirmed transaction is definitively dead.
 *
 * Unknown counts as "no": a failed height lookup must never block a user.
 */
export async function isBlockhashExpired(
  connection: Connection,
  lastValidBlockHeight: number,
  marginSlots: number = BLOCKHASH_SEND_MARGIN_SLOTS,
): Promise<boolean> {
  try {
    const height = await connection.getBlockHeight("confirmed");
    return height + marginSlots > lastValidBlockHeight;
  } catch {
    return false;
  }
}

/** What we tell a user when a transaction is dropped for a stale blockhash. */
export const BLOCKHASH_EXPIRED_MESSAGE =
  "This transaction's blockhash expired before it could be sent, so it was not submitted. Nothing was lost — run the preview again and sign promptly.";
