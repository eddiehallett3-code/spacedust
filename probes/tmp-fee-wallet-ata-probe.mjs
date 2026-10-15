// probes/tmp-fee-wallet-ata-probe.mjs
//
// Can the fee wallet receive a swap fee for each output asset *today*?
//
// A direct platform fee is charged in the output mint, so it needs
// ATA(feeWallet, mint) to exist and be unfrozen. **Jupiter does not check that** —
// a swap whose fee has nowhere to land fails on chain for every user — so
// `app/api/plan` refuses to attach the fee until this same lookup says the account
// is usable. The consequence of a missing account is therefore not a broken swap
// but a fee-free one, which stays invisible unless something asks.
//
// This is that something, and it answers the same question `/api/health` does
// without a running server: derive the three accounts, ask mainnet, print what is
// actually there, and give the `spl-token` command for anything missing.
//
// The fee-payer in those commands is the only signer, so **any funded wallet can
// create them** — the fee wallet's key is not needed in order to receive a fee.
//
// The referral comparison this probe used to run went with `REFERRAL_ACCOUNT`:
// that decision was made (a Jupiter referral account keeps only `share_bps` on
// claim and hands the rest over, so 20% of the fee would not be ours — see
// `lib/solana/fee-account.ts`), and a probe reading a variable the app no longer
// has does not check anything, it just throws.
//
// The mints are written out rather than imported: these scripts run under plain
// Node with no build step, so they cannot read `lib/utils/constants.ts`. If an
// output asset is ever added this list has to be updated by hand — the trade-off
// every file in this directory makes.
import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const read = (name) => {
  if (!fs.existsSync(".env.local")) return undefined;
  const env = fs.readFileSync(".env.local", "utf8");
  return env.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].trim();
};

const helius = read("HELIUS_API_KEY");
const feeWallet = read("NEXT_PUBLIC_FEE_WALLET");

if (!feeWallet) {
  console.log("NEXT_PUBLIC_FEE_WALLET is not set — swaps run fee-free by design.");
  process.exit(0);
}

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

/** The same derivation the app uses: legacy token program, wallet as owner. */
const ata = (owner, mint) =>
  getAssociatedTokenAddressSync(
    new PublicKey(mint),
    new PublicKey(owner),
    true,
    TOKEN_PROGRAM_ID,
  );

const rows = ASSETS.map(([symbol, mint]) => ({
  symbol,
  mint,
  account: ata(feeWallet, mint).toBase58(),
}));

const infos = await connection.getMultipleAccountsInfo(
  rows.map((row) => new PublicKey(row.account)),
);

/** What an account lookup says, in one line: missing, or its owner + state byte. */
const describe = (info) => {
  if (!info) return "MISSING";
  const owner = info.owner.toBase58();
  const program = owner === TOKEN_PROGRAM_ID.toBase58() ? "token" : `${owner.slice(0, 8)}…`;
  // Byte 108 of an SPL token account: 2 means frozen, so a transfer cannot land.
  const state = info.data.length > 108 ? info.data[108] : "?";
  return `${program} state=${state === 2 ? "FROZEN — a fee cannot land" : state}`;
};

console.log(`fee wallet : ${feeWallet}\n`);

const missing = [];
rows.forEach((row, index) => {
  const state = describe(infos[index]);
  const usable = state === "token state=1";
  if (!usable) missing.push(row);
  console.log(`${usable ? "READY  " : "MISSING"}  ${row.symbol.padEnd(14)} ${state}`);
  console.log(`         ${row.account}`);
});

console.log();
if (missing.length === 0) {
  console.log(`All ${rows.length} output assets can receive the fee. Nothing to do.`);
} else {
  console.log(`${missing.length} of ${rows.length} output assets run fee-free until created.`);
  console.log("The fee-payer is the only signer — any funded wallet works:\n");
  for (const row of missing) {
    console.log(
      `  spl-token create-account ${row.mint} --owner ${feeWallet} \\\n` +
        "    --fee-payer <YOUR WALLET> -u mainnet-beta",
    );
  }
}
