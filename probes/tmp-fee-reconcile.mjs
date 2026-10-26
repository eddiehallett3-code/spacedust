/**
 * Reconcile a sweep: rent released by the closes, fee paid, and what the
 * owner kept. Throwaway: /tmp.
 *
 * The fee is computed per account and rounded down, so dividing the fee by
 * 1.5% is an estimate, not a measurement. This reads each closed account's
 * pre-balance instead.
 */
import fs from "node:fs";

const env = fs.readFileSync(".env.local", "utf8");
const key = (env.match(/^HELIUS_API_KEY=(.*)$/m) || [])[1].trim();
const FEE_WALLET = (env.match(/^NEXT_PUBLIC_FEE_WALLET=(.*)$/m) || [])[1].trim();
const signatures = process.argv.slice(2);

async function rpc(method, params) {
  const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}

let totalRent = 0;
let totalFee = 0;

for (const signature of signatures) {
  const tx = await rpc("getTransaction", [
    signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
  ]);

  const keys = tx.transaction.message.accountKeys.map((entry) =>
    typeof entry === "string" ? entry : entry.pubkey,
  );
  const pre = tx.meta.preBalances;

  const instructions = [
    ...(tx.transaction.message.instructions ?? []),
    ...(tx.meta.innerInstructions ?? []).flatMap((group) => group.instructions ?? []),
  ];

  let rent = 0;
  let fee = 0;
  const closed = [];

  for (const ix of instructions) {
    const info = ix.parsed?.info;
    if (!info) continue;

    if (ix.parsed.type === "closeAccount") {
      const index = keys.indexOf(info.account);
      if (index > -1) {
        const released = pre[index];
        rent += released;
        closed.push({ account: info.account, released });
      }
    }

    if (ix.parsed.type === "transfer" && info.lamports !== undefined && info.destination === FEE_WALLET) {
      fee += info.lamports;
    }
  }

  totalRent += rent;
  totalFee += fee;

  console.log(`${signature.slice(0, 12)}…  rent ${(rent / 1e9).toFixed(9)} · fee ${fee} lamports · kept ${((rent - fee) / 1e9).toFixed(9)}`);
  for (const entry of closed) {
    console.log(`   closed ${entry.account.slice(0, 6)}… released ${(entry.released / 1e9).toFixed(9)}`);
  }
}

console.log(
  `\nTOTAL rent ${(totalRent / 1e9).toFixed(9)} SOL · fee ${(totalFee / 1e9).toFixed(9)} SOL (${totalFee} lamports) · kept ${((totalRent - totalFee) / 1e9).toFixed(9)} SOL`,
);
console.log(`1.5% of rent = ${((totalRent * 0.015) / 1e9).toFixed(9)} SOL`);
