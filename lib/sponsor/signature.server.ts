import "server-only";

import { createPublicKey, verify as verifySignature } from "node:crypto";

/**
 * Verify the wallet's own signature before the sponsor adds its own.
 *
 * `VersionedTransaction.sign` in this web3.js build fills the slots it is given
 * and does not check the ones it is not — measured directly, not assumed. So
 * without this, the sponsor would put its name to a transaction whose wallet
 * signature could be anything, and the only thing standing between that and an
 * on-chain rejection would be preflight.
 *
 * Node's Ed25519 verify, with the RFC 8410 SPKI wrapper around the raw 32-byte
 * key. No dependency, no network call, and it runs on the exact message bytes
 * that will be broadcast.
 */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function isWalletSignatureValid(input: {
  message: Uint8Array;
  signature: Uint8Array;
  publicKey: Uint8Array;
}): boolean {
  try {
    if (input.signature.length !== 64 || input.publicKey.length !== 32) {
      return false;
    }
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(input.publicKey)]),
      format: "der",
      type: "spki",
    });
    return verifySignature(
      null,
      Buffer.from(input.message),
      key,
      Buffer.from(input.signature),
    );
  } catch {
    return false;
  }
}
