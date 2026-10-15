// probes/tmp-fee-wallet-ata-probe.mjs
//
// Can the fee wallet receive a swap fee for each output asset *today*?
//
// A direct platform fee needs ATA(feeWallet, mint) to exist and be unfrozen —
// Jupiter does not check, and a swap whose fee has nowhere to land fails on
// chain for every user. So: derive them, ask mainnet, print what is actually
// there. Compares against the Jupiter referral accounts, so the two destinations
// can be seen side by side before choosing one.
import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

const env = fs.readFileSync(".env.local", "utf8");
const read = (name) => env.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].trim();

const helius = read("HELIUS_API_KEY");
const feeWallet = read("NEXT_PUBLIC_FEE_WALLET");
const referral = read("REFERRAL_ACCOUNT");

const connection = new Connection(
  `https://mainnet.helius-rpc.com/?api-key=${helius}`,
  "confirmed",
);

const ASSETS = [
  ["SOL (wrapped)", "So11111111111111111111111111111111111111112"],
  ["USDC", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  ["JUP", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
];

const ata = (owner, mint, program = TOKEN_PROGRAM_ID) =>
  getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, program);

const rows = ASSETS.map(([symbol, mint]) => ({
  symbol,
  mint,
  fee: ata(feeWallet, mint).toBase58(),
  fee2022: ata(feeWallet, mint, TOKEN_2022_PROGRAM_ID).toBase58(),
  referral: ata(referral, mint).toBase58(),
}));

const addresses = rows.flatMap((row) => [row.fee, row.referral]);
const infos = await connection.getMultipleAccountsInfo(
  addresses.map((address) => new PublicKey(address)),
);

/** What an account lookup says, in one line: missing, or its owner + state byte. */
const describe = (info) => {
  if (!info) return "MISSING";
  const owner = info.owner.toBase58();
  const short = owner === TOKEN_PROGRAM_ID.toBase58()
    ? "token"
    : owner === TOKEN_2022_PROGRAM_ID.toBase58()
      ? "token2022"
      : `${owner.slice(0, 8)}…`;
  // Byte 108 of an SPL token account: 2 means frozen, so a transfer cannot land.
  const state = info.data.length > 108 ? info.data[108] : "?";
  return `${short} state=${state === 2 ? "FROZEN" : state}`;
};

console.log(`fee wallet : ${feeWallet}`);
console.log(`referral   : ${referral}\n`);

rows.forEach((row, index) => {
  const feeInfo = infos[index * 2];
  const referralInfo = infos[index * 2 + 1];
  console.log(`${row.symbol}`);
  console.log(`  fee wallet ATA : ${row.fee}`);
  console.log(`                   ${describe(feeInfo)}`);
  console.log(`  referral ATA   : ${row.referral}`);
  console.log(`                   ${describe(referralInfo)}`);
});
