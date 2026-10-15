import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import {
  createCloseAccountInstruction,
  getOwnerAta,
} from "@/lib/solana/instructions";

/**
 * Sending one asset out of a wallet.
 *
 * Every number here comes from a real simulation against mainnet accounts
 * (`probes/tmp-payload-transfer-probe.mjs`), not from documentation:
 *
 *  - create + transfer + close is **394 bytes and 15,243 CU** and simulates
 *    clean, so the rent reclaim rides along with the send instead of needing a
 *    second approval — which is the whole reason reclaiming rent here is worth
 *    doing at all;
 *  - of those bytes, the recipient-account create is **106** and the close is
 *    **7**. A close is never the reason a batch does not fit;
 *  - a transfer with no create **fails** (`InvalidAccountData`), so the create is
 *    mandatory whenever the recipient has no account for the mint;
 *  - a **self-send** fails on the close with `Custom: 11` (NonNativeHasBalance):
 *    the balance never leaves the account, so there is nothing to close. Callers
 *    refuse a recipient equal to the owner rather than discovering this at a
 *    wallet prompt — see `lib/payload/destination.ts`;
 *  - a frozen source account is refused by the token program, which the Void's
 *    burn flow already reads separately (`frozenTokenAccounts`), because a
 *    frozen account cannot move a balance either.
 *
 * Nothing here signs, sends, or decides what should be sent.
 */

export interface SendRequest {
  /** The wallet sending. It pays every fee and every rent deposit. */
  owner: PublicKey;
  /** The mint being sent. */
  mint: PublicKey;
  /** The token account holding it, exactly as the scan found it. */
  source: PublicKey;
  /** The address receiving. Must differ from `owner`. */
  recipient: PublicKey;
  /** Base units. Sending the whole balance is what makes the reclaim possible. */
  amount: bigint;
  /** The mint's decimals — `transferChecked` requires them. */
  decimals: number;
  /** The mint's own token program: Token-2022 derives a different ATA. */
  tokenProgram: PublicKey;
  /** Create the recipient's account first. Required when it does not exist. */
  createRecipientAccount: boolean;
  /** Close the source account, returning its rent, once it is empty. */
  closeSource: boolean;
}

/** The account at the destination that a send lands in. */
export function recipientTokenAccount(
  recipient: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
): PublicKey {
  return getOwnerAta(recipient, mint, tokenProgram);
}

/**
 * Whether sending this much empties the account — which is what makes the close
 * valid, and what makes the rent reclaimable.
 *
 * A partial send must not be followed by a close: the token program refuses it
 * with the same `Custom: 11` a self-send produces. The two cases are checked
 * separately rather than folded into one "may close" flag, because they need
 * different messages: one is "you are sending part of this", the other is "you
 * are sending it to yourself".
 */
export function sendEmptiesAccount(amount: bigint, balance: bigint): boolean {
  return amount >= balance;
}

/**
 * The instructions for one send, in the only order that works.
 *
 * create → transfer → close, and the close is placed *after* the transfer
 * because the account is only empty once the transfer has run. An idempotent
 * create is used rather than a plain one: the account may have appeared between
 * planning and signing, and failing the whole batch for that would be absurd.
 */
export function buildSend(request: SendRequest): TransactionInstruction[] {
  const {
    owner,
    mint,
    source,
    recipient,
    amount,
    decimals,
    tokenProgram,
    createRecipientAccount,
    closeSource,
  } = request;

  const destination = recipientTokenAccount(recipient, mint, tokenProgram);
  const instructions: TransactionInstruction[] = [];

  if (createRecipientAccount) {
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        owner,
        destination,
        recipient,
        mint,
        tokenProgram,
      ),
    );
  }

  instructions.push(
    createTransferCheckedInstruction(
      source,
      mint,
      destination,
      owner,
      amount,
      decimals,
      [],
      tokenProgram,
    ),
  );

  if (closeSource) {
    instructions.push(createCloseAccountInstruction(source, owner, tokenProgram));
  }

  return instructions;
}
