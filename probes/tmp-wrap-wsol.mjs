/**
 * Wrap SOL into wSOL for a test wallet.
 *
 * Not part of the app — a one-off utility, in the same spirit as the other
 * `probes/tmp-*` scripts. Exists because Jupiter's UI (and therefore Phantom's
 * swap) collapses the wSOL mint into native SOL, so there is no way to leave a
 * wSOL account behind from a normal swap screen.
 *
 * Usage:
 *   node probes/tmp-wrap-wsol.mjs <keypair.json|-> [amountInSol]
 *
 * The key can be the 64-number JSON that `solana-keygen` writes, the base58
 * string a wallet exports, or `-` to read it from stdin — which is the option to
 * prefer, because then it never touches the disk or the shell history:
 *
 *   read -s PK && printf '%s' "$PK" | node probes/tmp-wrap-wsol.mjs - 0.01 && unset PK
 *
 * Use a throwaway wallet, and delete the file afterwards if you used one.
 * Nothing here is imported by the app.
 */
import fs from "node:fs";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

const [, , keyfile, amountArg] = process.argv;
if (!keyfile) {
  console.error("usage: node probes/tmp-wrap-wsol.mjs <keypair.json> [amountInSol]");
  process.exit(1);
}

const amountSol = Number(amountArg ?? "0.01");
if (!Number.isFinite(amountSol) || amountSol <= 0) {
  console.error("amountInSol must be a positive number");
  process.exit(1);
}
const lamports = Math.round(amountSol * 1e9);

const TOKEN_PROGRAM = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ATA_PROGRAM = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

const secret = (() => {
  const raw = (
    keyfile === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(keyfile, "utf8")
  ).trim();
  if (raw.length === 0) {
    throw new Error("no key provided");
  }
  // Both export formats: the JSON array solana-keygen writes, and the base58
  // string a wallet shows.
  return raw.startsWith("[")
    ? Uint8Array.from(JSON.parse(raw))
    : bs58.decode(raw);
})();
const owner = Keypair.fromSecretKey(secret);

const [ata] = PublicKey.findProgramAddressSync(
  [owner.publicKey.toBuffer(), TOKEN_PROGRAM.toBuffer(), WSOL_MINT.toBuffer()],
  ATA_PROGRAM,
);

const connection = new Connection(
  process.env.RPC ?? "https://api.mainnet-beta.solana.com",
  "confirmed",
);

const balance = await connection.getBalance(owner.publicKey, "confirmed");
console.log("wallet :", owner.publicKey.toBase58());
console.log("wSOL   :", ata.toBase58());
console.log("balance:", balance, "lamports");

if (balance < lamports + 20_000) {
  console.error(
    `not enough SOL: need about ${lamports + 20_000} for ${lamports} wrapped plus fees`,
  );
  process.exit(1);
}

// Associated Token Account: CreateIdempotent (discriminator 1). Safe whether or
// not the account already exists, which is why a second run is harmless.
const createIdempotent = new TransactionInstruction({
  programId: ATA_PROGRAM,
  keys: [
    { pubkey: owner.publicKey, isSigner: true, isWritable: true },
    { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: owner.publicKey, isSigner: false, isWritable: false },
    { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
  ],
  data: Buffer.from([1]),
});

// SPL Token: SyncNative (17). Required — a plain lamport transfer into a wSOL
// account does not update its token amount, which is exactly the trap this
// script exists to avoid.
const syncNative = new TransactionInstruction({
  programId: TOKEN_PROGRAM,
  keys: [{ pubkey: ata, isSigner: false, isWritable: true }],
  data: Buffer.from([17]),
});

const { blockhash, lastValidBlockHeight } =
  await connection.getLatestBlockhash("confirmed");

const message = new TransactionMessage({
  payerKey: owner.publicKey,
  recentBlockhash: blockhash,
  instructions: [
    createIdempotent,
    SystemProgram.transfer({
      fromPubkey: owner.publicKey,
      toPubkey: ata,
      lamports,
    }),
    syncNative,
  ],
}).compileToV0Message();

const transaction = new VersionedTransaction(message);
transaction.sign([owner]);

const signature = await connection.sendRawTransaction(transaction.serialize(), {
  skipPreflight: false,
});
await connection.confirmTransaction(
  { signature, blockhash, lastValidBlockHeight },
  "confirmed",
);

console.log(`wrapped ${amountSol} SOL -> ${signature}`);
console.log(`https://solscan.io/tx/${signature}`);
