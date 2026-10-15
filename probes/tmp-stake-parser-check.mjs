// probes/tmp-stake-parser-check.mjs
//
// Freeze a real mainnet stake account as a test fixture: dump its bytes, derive
// the expected fields, and confirm the voter really is a vote account. The hex
// and the values go into `native-stake.test.ts`. Read-only. Delete after.
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
const addr = page[0].pubkey;
const info = await conn.getAccountInfo(addr);
const d = info.data;

// Freeze the first 200 bytes as a hex literal for the test.
console.log(`account ${addr.toBase58()}`);
console.log(`size ${d.length}`);
console.log(`HEX:\n${Buffer.from(d).toString("hex")}`);

const b58 = (off) => new PublicKey(d.subarray(off, off + 32)).toBase58();
const voter = b58(124);
const voterInfo = await conn.getAccountInfo(new PublicKey(voter));

console.log(
  JSON.stringify(
    {
      withdrawer: b58(44),
      voter,
      voterIsVoteAccount: voterInfo?.owner.toBase58() ===
        "Vote111111111111111111111111111111111111111",
      stake: d.readBigUInt64LE(156).toString(),
      activation: Number(d.readBigUInt64LE(164)),
      deactivationRaw: d.readBigUInt64LE(172).toString(),
      tag: d.readUInt32LE(0),
    },
    null,
    2,
  ),
);
