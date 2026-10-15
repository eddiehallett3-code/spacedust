// probes/tmp-ata-history.mjs
//
// Did the fee wallet ever hold the output-asset ATAs, and does it hold them now?
// Read-only. Answers "do I need to recreate them, or are the earlier ones still
// there?" — ATA(owner, mint) is deterministic, so the address is fixed; only
// existence can differ.
import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

const env = fs.readFileSync(".env.local", "utf8");
const read = (n) => env.match(new RegExp(`^${n}=(.*)$`, "m"))?.[1].trim();
const key = read("HELIUS_API_KEY");
const feeWallet = read("NEXT_PUBLIC_FEE_WALLET");
const referral = read("REFERRAL_ACCOUNT");
const conn = new Connection(
  `https://mainnet.helius-rpc.com/?api-key=${key}`,
  "confirmed",
);
const OWNER = new PublicKey(feeWallet);
const ASSETS = [
  ["SOL (wrapped)", "So11111111111111111111111111111111111111112"],
  ["USDC", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  ["JUP", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
];

console.log(`fee wallet: ${feeWallet}`);
console.log(`referral  : ${referral}\n`);

// 1. Every token account the fee wallet currently owns, both programs.
for (const [label, pid] of [
  ["legacy", TOKEN_PROGRAM_ID],
  ["token2022", TOKEN_2022_PROGRAM_ID],
]) {
  const res = await conn.getTokenAccountsByOwner(OWNER, { programId: pid });
  console.log(`current ${label} token accounts owned: ${res.value.length}`);
  for (const a of res.value) {
    console.log(`  ${a.pubkey.toBase58()}`);
  }
}

// 2. The specific ATAs the swap fee needs, present or not.
console.log("");
for (const [symbol, mint] of ASSETS) {
  const ata = getAssociatedTokenAddressSync(
    new PublicKey(mint),
    OWNER,
    true,
    TOKEN_PROGRAM_ID,
  );
  const info = await conn.getAccountInfo(ata);
  console.log(`${symbol}: ${ata.toBase58()} → ${info ? "EXISTS" : "MISSING"}`);
}

// 3. Recent activity, so a closed-and-recreated history is visible.
console.log("\nrecent signatures for fee wallet:");
const sigs = await conn.getSignaturesForAddress(OWNER, { limit: 25 });
console.log(`  count: ${sigs.length}`);
for (const s of sigs) {
  console.log(
    `  ${s.signature.slice(0, 16)}… slot=${s.slot} err=${s.err ? "FAILED" : "ok"} blockTime=${s.blockTime ? new Date(s.blockTime * 1000).toISOString() : "?"}`,
  );
}
