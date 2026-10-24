import { describe, expect, it } from "vitest";
import { Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createComputeBudgetInstructions } from "@/lib/solana/instructions";
import { isWalletSignatureValid } from "./signature.server";

/**
 * The signature check is the only thing between "the wallet authorised this" and
 * "the sponsor paid for something nobody signed" — web3's `sign()` does not
 * check signatures it is not given, so this cannot be assumed either.
 */
function signedBytes(signer: Keypair) {
  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: createComputeBudgetInstructions(20_000),
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([signer]);
  return {
    message: message.serialize(),
    signature: transaction.signatures[0]!,
    publicKey: signer.publicKey.toBytes(),
  };
}

describe("isWalletSignatureValid", () => {
  it("accepts a real signature over the exact message", () => {
    const signer = Keypair.generate();
    expect(isWalletSignatureValid(signedBytes(signer))).toBe(true);
  });

  it("refuses the same signature over a changed message", () => {
    const signer = Keypair.generate();
    const signed = signedBytes(signer);
    const tampered = Uint8Array.from(signed.message);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! ^ 0xff) & 0xff;

    expect(isWalletSignatureValid({ ...signed, message: tampered })).toBe(false);
  });

  it("refuses a signature from a different key", () => {
    const signer = Keypair.generate();
    const impostor = Keypair.generate();

    expect(
      isWalletSignatureValid({
        ...signedBytes(signer),
        publicKey: impostor.publicKey.toBytes(),
      }),
    ).toBe(false);
  });

  it("refuses malformed lengths instead of throwing", () => {
    expect(
      isWalletSignatureValid({
        message: new Uint8Array([1, 2, 3]),
        signature: new Uint8Array([4, 5]),
        publicKey: new Uint8Array([6, 7]),
      }),
    ).toBe(false);
  });
});
