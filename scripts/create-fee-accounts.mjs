// scripts/create-fee-accounts.mjs
//
// One-time setup: create the fee wallet's token account for each output asset, so
// a swap fee has somewhere to land.
//
// Why this exists as a script rather than a sentence in the README: two of the
// three accounts need a token operation a wallet UI cannot perform. Sending JUP to
// the fee wallet *would* create its account as a side effect, but nothing in
// Phantom wraps SOL into somebody else's wrapped-SOL account. The alternatives are
// `cargo install spl-token-cli` (which wants Rust) or this — and the dependencies
// for this are already in package.json.
//
// The ATA's *owner* is the fee wallet; the *payer* is the keypair you pass, and it
// is the only signature required. So any funded wallet works and the fee wallet's
// private key is never needed. The accounts only have to exist and be unfrozen to
// receive a fee — no balance, no wrapping, which is why every mint is handled the
// same way here.
//
// Safe by default: it derives, builds, simulates and prints, and sends nothing.
// Add --send when the simulation looks right.
//
//   node scripts/create-fee-accounts.mjs --keypair ~/.config/solana/id.json
//   node scripts/create-fee-accounts.mjs --keypair ~/.config/solana/id.json --send
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const send = flag("--send");
const keypairPath = value("--keypair") ?? path.join(os.homedir(), ".config/solana/id.json");

const read = (name) => {
  if (!fs.existsSync(".env.local")) return undefined;
  const env = fs.readFileSync(".env.local", "utf8");
  return env.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].trim();
};

const feeWallet = read("NEXT_PUBLIC_FEE_WALLET");
if (!feeWallet) {
  console.error("NEXT_PUBLIC_FEE_WALLET is not set — there is no fee wallet to set up.");
  process.exit(1);
}

if (!fs.existsSync(keypairPath)) {
  console.error(
    `No keypair at ${keypairPath}.\n` +
      "Pass one that holds a little SOL to cover the rent:\n" +
      "  --keypair /path/to/keypair.json\n" +
      "The keypair only pays; it is not the fee wallet and is not stored anywhere.",
  );
  process.exit(1);
}

const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8"))),
);

const helius = read("HELIUS_API_KEY");
const connection = new Connection(
  helius
    ? `https://mainnet.helius-rpc.com/?api-key=${helius}`
    : "https://api.mainnet-beta.solana.com",
  "confirmed",
);

const ASSETS = [
  ["SOL (wrapped)", "So11111111111111111111111111111111111111112"],
  ["USDC", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  ["JUP", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
];

const owner = new PublicKey(feeWallet);
const accounts = ASSETS.map(([symbol, mint]) => ({
  symbol,
  mint: new PublicKey(mint),
  address: getAssociatedTokenAddressSync(new PublicKey(mint), owner, true, TOKEN_PROGRAM_ID),
}));

const existing = await connection.getMultipleAccountsInfo(accounts.map((a) => a.address));
const missing = accounts.filter((_, index) => existing[index] === null);

console.log(`fee wallet : ${feeWallet}`);
console.log(`payer      : ${payer.publicKey.toBase58()}\n`);
for (const [index, account] of accounts.entries()) {
  console.log(`${existing[index] ? "exists " : "MISSING"}  ${account.symbol}`);
  console.log(`         ${account.address.toBase58()}`);
}

if (missing.length === 0) {
  console.log("\nAll accounts exist. Nothing to do.");
  process.exit(0);
}

// Idempotent, so re-running after a partial failure is harmless — and the same
// instruction the app's own composer uses, rather than a second way to do it.
const transaction = new Transaction();
for (const account of missing) {
  transaction.add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      account.address,
      owner,
      account.mint,
    ),
  );
}

transaction.feePayer = payer.publicKey;
transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

console.log(`\n${missing.length} to create: ${missing.map((a) => a.symbol).join(", ")}`);

// 165 bytes: the fixed size of an SPL token account, as in
// `TOKEN_ACCOUNT_SIZE_BYTES`. Read from chain rather than remembered, because this
// is a number somebody is about to spend.
const rentPerAccount = await connection.getMinimumBalanceForRentExemption(165);
const needed = rentPerAccount * missing.length;
const balance = await connection.getBalance(payer.publicKey);

if (balance < needed) {
  // Checked up front rather than inferred from the simulation. An unfunded payer
  // makes the simulation fail with `AccountNotFound` — the account has never
  // existed — and reporting that as "the instructions would not land" would be both
  // alarming and wrong: the instructions are fine, the payer is empty.
  console.log(
    `\nThe payer holds ${(balance / 1e9).toFixed(5)} SOL, and rent for ` +
      `${missing.length} account${missing.length === 1 ? "" : "s"} is ` +
      `~${(needed / 1e9).toFixed(5)} SOL.`,
  );
  console.log(`Send SOL to ${payer.publicKey.toBase58()}, then re-run.`);
  console.log("Skipped the simulation: with an empty payer it can only report that.");
  process.exit(1);
}

// Simulated before anything is signed, including on a dry run, so what gets printed
// is what would actually happen rather than what the instructions look like they do.
const simulation = await connection.simulateTransaction(transaction);
if (simulation.value.err) {
  console.error(`\nSimulation failed: ${JSON.stringify(simulation.value.err)}`);
  console.error("The instructions would not land. Not sending.");
  process.exit(1);
}
console.log(`\nSimulation OK. Compute units: ${simulation.value.unitsConsumed ?? "unknown"}`);

if (!send) {
  console.log("\nDry run — nothing sent. Re-run with --send to create them.");
  process.exit(0);
}

const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);
console.log(`\nCreated. Signature: ${signature}`);
console.log("Re-run this script, or /api/health, to confirm all three read as active.");
