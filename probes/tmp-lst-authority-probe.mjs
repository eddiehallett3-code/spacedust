// probes/tmp-lst-authority-probe.mjs
//
// Are the well-known liquid-staking tokens already caught by the existing
// `isPoolLikeMint` heuristic (mint authority sits off the ed25519 curve)? If so,
// they already land in the "In a liquidity pool" card under the wrong label —
// which decides whether this feature is a new section or a correction.
// Read-only. Fine to delete.
import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/^HELIUS_API_KEY=(.*)$/m)?.[1].trim();
const conn = new Connection(
  `https://mainnet.helius-rpc.com/?api-key=${key}`,
  "confirmed",
);

const LSTS = [
  ["mSOL", "Marinade", "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"],
  ["jupSOL", "Jupiter", "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v"],
  ["JitoSOL", "Jito", "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"],
  ["bSOL", "BlazeStake", "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1"],
  ["INF", "Sanctum", "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm"],
  ["stSOL", "Lido", "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj"],
];

for (const [symbol, protocol, mint] of LSTS) {
  try {
    const info = await conn.getAccountInfo(new PublicKey(mint));
    if (!info) {
      console.log(`${symbol.padEnd(8)} ${protocol.padEnd(11)} MISSING`);
      continue;
    }
    // MintLayout: 4-byte COption tag, then 32-byte authority (if Some).
    const tag = info.data.readUInt32LE(0);
    const authority =
      tag === 1 ? new PublicKey(info.data.subarray(4, 36)) : null;
    const offCurve = authority
      ? !PublicKey.isOnCurve(authority.toBytes())
      : false;
    console.log(
      `${symbol.padEnd(8)} ${protocol.padEnd(11)} authority=${authority ? authority.toBase58() : "REVOKED"}` +
        `  offCurve=${offCurve}  => isPoolLikeMint=${authority ? offCurve : false}`,
    );
  } catch (error) {
    console.log(`${symbol.padEnd(8)} error: ${error.message}`);
  }
}
