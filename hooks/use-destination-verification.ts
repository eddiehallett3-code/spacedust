"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import {
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getConnection } from "@/lib/solana/connection";
import { settleTransaction } from "@/lib/solana/submit";
import {
  TEST_TRANSFER_LAMPORTS,
  type Verification,
} from "@/lib/payload/destination";

/**
 * Proving a destination can receive, before a batch is sent to it.
 *
 * The test transfer is the first send, made on its own so it can be confirmed
 * before the rest follows. It is not a loss — the lamports arrive at the address
 * the user asked for, which is where the batch was going anyway.
 *
 * Confirmation reads the *transaction*, not the recipient's balance. A balance
 * cannot prove anything: the recipient may already hold SOL, and a number cannot
 * say when it arrived. Reading the test's own transaction and comparing the
 * recipient's lamports before and after is evidence — and it works for any
 * address, whether or not the user controls it, because all of this is public.
 *
 * What it proves is that the address **can receive**. It cannot prove who owns
 * it: a wrong address that happens to be a real wallet still receives the test.
 * That limit is why the field shows the address for a human to compare rather
 * than treating verification as a substitute for looking.
 */
export function useDestinationVerification() {
  const { publicKey, signTransaction } = useWallet();
  const connection = getConnection();

  const [verification, setVerification] = useState<Verification | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Send the test. Returns true when it was signed, sent and confirmed. */
  const sendTest = useCallback(
    async (address: string): Promise<boolean> => {
      if (!publicKey || !signTransaction) {
        setError("Connect a wallet that can sign before sending a test.");
        return false;
      }

      setError(null);
      setIsSending(true);
      try {
        const recipient = new PublicKey(address);
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");

        const message = new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: blockhash,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: publicKey,
              toPubkey: recipient,
              lamports: TEST_TRANSFER_LAMPORTS,
            }),
          ],
        }).compileToV0Message();

        const signed = await signTransaction(new VersionedTransaction(message));
        const signatureBytes = signed.signatures[0];
        if (!signatureBytes) {
          setError("The wallet did not sign the test transfer.");
          return false;
        }

        // The signature is known *before* the send is attempted, which is what
        // lets a rejected send still be checked against the chain: an RPC can
        // refuse a transaction it has already accepted, and reporting failure for
        // something that landed is exactly the bug this path is fixing.
        const signature = bs58.encode(signatureBytes);

        try {
          await connection.sendRawTransaction(signed.serialize(), {
            skipPreflight: false,
            maxRetries: 3,
          });
        } catch (sendError) {
          const verdict = await settleTransaction(
            connection,
            signature,
            lastValidBlockHeight,
            { timeoutMs: 6_000 },
          );
          // Only a signature the chain knows nothing about is a real send
          // failure. Anything else and the "error" was describing the RPC's
          // opinion, not the transaction.
          if (verdict.kind !== "confirmed") throw sendError;
        }

        const verdict = await settleTransaction(
          connection,
          signature,
          lastValidBlockHeight,
        );

        if (verdict.kind === "failed") {
          setError(
            "The test transfer was included but failed on chain, so the destination did not receive it. Send another test.",
          );
          return false;
        }

        if (verdict.kind === "not-included") {
          // Deliberately *not* a failure claim: nothing has been seen on chain
          // either way. Letting a stale blockhash be reported as "failed" is what
          // told a user their transfer had not happened when it had been
          // finalized.
          setError(
            `The test transfer was sent but has not been seen on chain yet, so the destination is not verified. Check it on Solscan (${signature}) before sending another test — it may still land.`,
          );
          return false;
        }

        // `arrived: false` even though the send confirmed: "arrived" means
        // something the user can see, so it is only set once the transaction has
        // been read back and the lamports are found at the destination.
        setVerification({
          address,
          signature,
          lamports: TEST_TRANSFER_LAMPORTS,
          arrived: false,
        });
        return true;
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "The test transfer did not go through.",
        );
        return false;
      } finally {
        setIsSending(false);
      }
    },
    [connection, publicKey, signTransaction],
  );

  /**
   * Read the test's transaction back and look for the lamports at the other end.
   *
   * The recipient's index in the account keys is found by address rather than
   * assumed to be a fixed slot, and the delta is compared against the amount the
   * test carried — so a transaction that landed but did not credit this address
   * is never mistaken for a success.
   */
  const checkArrival = useCallback(async (): Promise<boolean> => {
    if (!verification?.signature) {
      setError("Send the test first.");
      return false;
    }

    setError(null);
    setIsChecking(true);
    try {
      const transaction = await connection.getTransaction(
        verification.signature,
        { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      );

      if (!transaction) {
        setError(
          "That test transaction is not visible yet. Give it a moment, then check again.",
        );
        return false;
      }
      if (transaction.meta?.err) {
        setError("The test transaction failed on chain. Send another one.");
        return false;
      }

      const meta = transaction.meta;
      const keys = transaction.transaction.message.getAccountKeys({
        accountKeysFromLookups: meta?.loadedAddresses,
      });

      let index = -1;
      for (let position = 0; position < keys.length; position += 1) {
        if (keys.get(position)?.toBase58() === verification.address) {
          index = position;
          break;
        }
      }

      const delta =
        index >= 0 && meta
          ? (meta.postBalances[index] ?? 0) - (meta.preBalances[index] ?? 0)
          : 0;

      if (delta < verification.lamports) {
        setError(
          "The test transaction landed, but this address was not credited by it. Do not send a batch here.",
        );
        return false;
      }

      setVerification({ ...verification, arrived: true });
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not read the test back.",
      );
      return false;
    } finally {
      setIsChecking(false);
    }
  }, [connection, verification]);

  /**
   * The user has looked in the receiving wallet themselves.
   *
   * A real path rather than a fallback, because for a wallet the user controls
   * this is the strongest confirmation available: a person can see the arrival in
   * a place the chain cannot speak for.
   */
  const confirmManually = useCallback((): void => {
    setVerification((current) =>
      current ? { ...current, arrived: true } : current,
    );
  }, []);

  /** Forget the verification entirely — used when the address changes under it. */
  const clear = useCallback((): void => {
    setVerification(null);
    setError(null);
  }, []);

  return {
    verification,
    isSending,
    isChecking,
    error,
    sendTest,
    checkArrival,
    confirmManually,
    clear,
  };
}
