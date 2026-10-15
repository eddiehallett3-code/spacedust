import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { createRevokeInstruction } from "@solana/spl-token";
import bs58 from "bs58";
import fs from "node:fs";

/**
 * Temp probe: does a real `Revoke` clear a real delegate on mainnet?
 *
 * Finds a live delegated token account, builds the exact instruction the
 * approvals feature builds, and simulates it with `sigVerify: false`. A null
 * error means the instruction is correct and the account will accept it — which
 * is the same gate the app applies before it offers to sign anything.
 */

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/HELIUS_API_KEY=(.+)/)?.[1]?.trim();
const fallback = env.match(/NEXT_PUBLIC_FALLBACK_RPC_URL=(.+)/)?.[1]?.trim();
const url = key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : fallback;
const payerAddress = env.match(/FEE_WALLET=(.+)/)?.[1]?.trim();
if (!url || !payerAddress) throw new Error("missing env");

const connection = new Connection(url, "confirmed");
const LEGACY = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

async function rpc(method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

const page = await rpc("getProgramAccountsV2", [
  LEGACY.toBase58(),
  {
    encoding: "jsonParsed",
    limit: 1,
    filters: [
      { dataSize: 165 },
      {
        memcmp: {
          offset: 72,
          bytes: bs58.encode(new Uint8Array([1, 0, 0, 0])),
        },
      },
      // State byte at offset 108: 1 = initialized (0 uninitialized, 2 frozen).
      // Revoke on a frozen account is rejected outright with `Custom: 17`, so the
      // positive case has to come from an account that is not frozen.
      { memcmp: { offset: 108, bytes: bs58.encode(new Uint8Array([1])) } },
    ],
  },
]);
const hits = Array.isArray(page) ? page : page.accounts;
if (hits.length === 0) throw new Error("no delegated account found");

const target = hits[0];
const info = target.account.data.parsed.info;
const tokenAccount = new PublicKey(target.pubkey);
const owner = new PublicKey(info.owner);

console.log("token account:", tokenAccount.toBase58());
console.log("owner        :", owner.toBase58());
console.log("delegate     :", info.delegate);
console.log("delegatedAmt :", info.delegatedAmount.amount);
console.log("balance      :", info.tokenAmount.amount, "state:", info.state);

const instruction = createRevokeInstruction(tokenAccount, owner, [], LEGACY);
console.log("\ninstruction programId:", instruction.programId.toBase58());
console.log("instruction data     :", [...instruction.data]);
console.log(
  "instruction keys     :",
  instruction.keys.map(
    (k) => `${k.pubkey.toBase58().slice(0, 6)}${k.isSigner ? ":S" : ""}${
      k.isWritable ? ":W" : ""
    }`,
  ),
);

const { blockhash } = await connection.getLatestBlockhash("confirmed");
const message = new TransactionMessage({
  payerKey: new PublicKey(payerAddress),
  recentBlockhash: blockhash,
  instructions: [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    instruction,
  ],
}).compileToV0Message();

const simulation = await connection.simulateTransaction(
  new VersionedTransaction(message),
  { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" },
);

console.log("\nsimulation err :", simulation.value.err ?? "null (would succeed)");
console.log("unitsConsumed  :", simulation.value.unitsConsumed);
console.log("logs           :");
for (const line of (simulation.value.logs ?? []).slice(-8)) {
  console.log("  ", line);
}
