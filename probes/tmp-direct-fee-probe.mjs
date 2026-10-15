// probes/tmp-direct-fee-probe.mjs
//
// Should the swap fee go to the fee wallet's own token account, or through
// Jupiter's Referral Program?
//
// Both are charged identically — a `platformFeeBps` platform fee on `/build` —
// but they pay out differently: a referral token account is claimed through the
// program, which pays the account's `share_bps` to the partner and the rest to
// the project. Ours reads 8000, so 20% of the fee would go to Jupiter. Paying
// the fee wallet directly should keep all of it.
//
// Two things are measured, both read-only:
//
//   A. Does `ATA(feeWallet, mint)` match what chain actually holds? The
//      derivation is worthless if it disagrees with the accounts a wallet really
//      has, so every token account the fee wallet owns is checked against it.
//
//   B. Does `/build` honour a platform fee pointed at the fee wallet's own ATA?
//      The same swap is asked for twice — once plain, once with the fee — and
//      the output is diffed. The fee account need not exist for that question to
//      be answerable: as elsewhere, Jupiter does not check.
import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

const env = fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "";
const read = (name) =>
  (env.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1] ?? process.env[name] ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");

const helius = read("HELIUS_API_KEY");
const jupiterKey = read("JUPITER_API_KEY");
const feeWallet = read("NEXT_PUBLIC_FEE_WALLET");

const connection = new Connection(
  helius
    ? `https://mainnet.helius-rpc.com/?api-key=${helius}`
    : read("NEXT_PUBLIC_FALLBACK_RPC_URL"),
  "confirmed",
);

const BASE = "https://api.jup.ag/swap/v2/build";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WSOL = "So11111111111111111111111111111111111111112";
// The probe's own taker, as in probes/tmp-fee-delta-probe.mjs: quoting never needs a
// signature, and a fixed taker keeps the two routes comparable.
const TAKER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

const ata = (owner, mint, program = TOKEN_PROGRAM_ID) =>
  getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, program);

console.log(`fee wallet: ${feeWallet}`);

// ── A. Does the derivation match the accounts the wallet actually holds? ─────
const { value: holdings } = await connection.getTokenAccountsByOwner(
  new PublicKey(feeWallet),
  { programId: TOKEN_PROGRAM_ID },
);

console.log(`\nA. derivation vs chain — ${holdings.length} token account(s) held`);

let mismatches = 0;
for (const { pubkey, account } of holdings) {
  const mint = new PublicKey(account.data.subarray(0, 32)).toBase58();
  const agrees = ata(feeWallet, mint).toBase58() === pubkey.toBase58();
  if (!agrees) mismatches += 1;
  console.log(`   ${agrees ? "ok   " : "WRONG"} ${mint} → ${pubkey.toBase58()}`);
}
if (holdings.length === 0) {
  console.log("   (none held — nothing to compare against; see the assets below)");
} else {
  console.log(
    `   ${mismatches === 0 ? "every account matches ATA(feeWallet, mint)" : `${mismatches} MISMATCH(ES)`}`,
  );
}

// The three output assets, and whether a fee could land in each today.
const ASSETS = [
  ["SOL (wrapped)", WSOL],
  ["USDC", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  ["JUP", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
];

console.log("\n   output assets:");
const infos = await connection.getMultipleAccountsInfo(
  ASSETS.map(([, mint]) => ata(feeWallet, mint)),
);
ASSETS.forEach(([symbol, mint], index) => {
  const info = infos[index];
  const derived = ata(feeWallet, mint).toBase58();
  const state = !info ? "MISSING" : info.data[108] === 2 ? "FROZEN" : "usable";
  console.log(`   ${symbol.padEnd(14)} ${derived}  ${state}`);
  console.log(
    `   ${"".padEnd(14)} legacy ≠ token2022: ${derived !== ata(feeWallet, mint, TOKEN_2022_PROGRAM_ID).toBase58()}`,
  );
});

// ── B. Does /build honour a platform fee pointed at that account? ────────────
async function quote(label, feeAccount) {
  const query = new URLSearchParams({
    inputMint: BONK,
    outputMint: WSOL,
    amount: "10000000000", // 10,000 BONK — large enough for 50 bps to be visible
    slippageBps: "50",
    taker: TAKER,
    maxAccounts: "32",
  });
  if (feeAccount) {
    query.set("platformFeeBps", "50");
    query.set("feeAccount", feeAccount);
  }

  const response = await fetch(`${BASE}?${query}`, {
    headers: {
      Accept: "application/json",
      ...(jupiterKey ? { "x-api-key": jupiterKey } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    console.log(`${label}: HTTP ${response.status} — ${text.slice(0, 200)}`);
    return null;
  }

  const data = JSON.parse(text);
  const out = Number(data.outputAmount ?? data.outAmount ?? 0);
  const instructions = [
    ...(data.setupInstructions ?? []),
    data.swapInstruction,
    ...(data.otherInstructions ?? []),
    ...(data.cleanupInstruction ? [data.cleanupInstruction] : []),
  ].filter(Boolean);
  const accounts = instructions.flatMap((ix) => ix.accounts ?? []);

  console.log(`\nB. ${label}`);
  console.log(`   outAmount  : ${out.toLocaleString()}`);
  console.log(`   feeBps echo: ${JSON.stringify(data.platformFeeBps)}`);
  if (feeAccount) {
    const entry = accounts.find((account) => account.pubkey === feeAccount);
    console.log(
      `   fee account named in instructions: ${entry ? `yes (writable=${entry.isWritable})` : "no"}`,
    );
  }
  return out;
}

const feeAccount = ata(feeWallet, WSOL).toBase58();
const withoutFee = await quote("no fee", null);
await new Promise((resolve) => setTimeout(resolve, 1500));
const withFee = await quote("platformFeeBps → the fee wallet's own wSOL account", feeAccount);

if (withoutFee && withFee) {
  const delta = withoutFee - withFee;
  console.log(
    `\nfee taken: ${delta.toLocaleString()} of ${withoutFee.toLocaleString()} lamports = ` +
      `${((delta / withoutFee) * 10_000).toFixed(2)} bps`,
  );
}
