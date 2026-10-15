// probes/tmp-stake-layout.mjs
//
// Dump one delegated stake account as hex and locate the fields we know by
// their values, rather than assuming the borsh layout. Read-only. Delete after.
import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/^HELIUS_API_KEY=(.*)$/m)?.[1].trim();
const conn = new Connection(
  `https://mainnet.helius-rpc.com/?api-key=${key}`,
  "confirmed",
);

const STAKE_PROGRAM = new PublicKey(
  "Stake11111111111111111111111111111111111111",
);
const page = await conn.getProgramAccounts(STAKE_PROGRAM, {
  filters: [{ dataSize: 200 }],
  dataSlice: { offset: 0, length: 0 },
});
const info = await conn.getAccountInfo(page[0].pubkey);
const d = info.data;

console.log(`account ${page[0].pubkey.toBase58()}  len=${d.length}`);

// Hex, 32 bytes per row.
for (let off = 0; off < d.length; off += 32) {
  const row = d.subarray(off, off + 32);
  console.log(
    `${String(off).padStart(3)}  ${Buffer.from(row).toString("hex").match(/.{2}/g).join(" ")}`,
  );
}

// Where is rent_exempt_reserve (2282880 = 0x22D6C0)?
const rentHex = Buffer.from([0xc0, 0xd6, 0x22, 0x00, 0x00, 0x00, 0x00, 0x00]);
console.log(`\nrent bytes present at: ${d.indexOf(rentHex)}`);
// And the 2_282_880 variant as u64 anywhere.
for (let off = 0; off + 8 <= 64; off += 4) {
  console.log(`  u64 @${off} = ${Number(d.readBigUInt64LE(off))}`);
}
