// probes/tmp-fee-wallet-history.mjs
//
// What has the fee wallet actually been doing? Read-only. Answers whether the
// output-asset ATAs were ever created (and later closed), and where the SOL it
// holds came from. Fine to delete.
import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";

const env = fs.readFileSync(".env.local", "utf8");
const read = (n) => env.match(new RegExp(`^${n}=(.*)$`, "m"))?.[1].trim();
const key = read("HELIUS_API_KEY");
const feeWallet = read("NEXT_PUBLIC_FEE_WALLET");
const conn = new Connection(
  `https://mainnet.helius-rpc.com/?api-key=${key}`,
  "confirmed",
);
const OWNER = new PublicKey(feeWallet);

const sigs = await conn.getSignaturesForAddress(OWNER, { limit: 25 });
console.log(`fee wallet: ${feeWallet}`);
console.log(`examining ${sigs.length} signatures\n`);

const txs = await conn.getParsedTransactions(
  sigs.map((s) => s.signature),
  { maxSupportedTransactionVersion: 0, commitment: "confirmed" },
);

for (let i = 0; i < txs.length; i++) {
  const tx = txs[i];
  const sig = sigs[i];
  if (!tx) {
    console.log(`${sig.signature.slice(0, 12)}… <unavailable>`);
    continue;
  }
  const keys = tx.transaction.message.accountKeys;
  const idx = keys.findIndex((k) => k.pubkey.toBase58() === feeWallet);
  const pre = tx.meta?.preBalances[idx] ?? 0;
  const post = tx.meta?.postBalances[idx] ?? 0;
  const delta = (post - pre) / 1e9;

  // Instruction program ids touched, so an ATA create/close is visible.
  const programs = new Set();
  for (const ix of tx.transaction.message.instructions) {
    const pid = "programId" in ix ? ix.programId.toBase58() : "?";
    const name =
      pid === "11111111111111111111111111111111"
        ? "system"
        : pid === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
          ? "token"
          : pid === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
            ? "ata"
            : pid === "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
              ? "jupiter"
              : pid === "ComputeBudget111111111111111111111111111111"
                ? "compute"
                : `${pid.slice(0, 8)}…`;
    programs.add(name);
  }

  // Token balance changes involving the fee wallet, if any.
  const tokenNotes = [];
  const preTok = tx.meta?.preTokenBalances ?? [];
  const postTok = tx.meta?.postTokenBalances ?? [];
  for (const p of postTok) {
    const before = preTok.find(
      (b) =>
        b.accountIndex === p.accountIndex &&
        b.mint === p.mint,
    );
    if (p.owner === feeWallet) {
      const d =
        Number(p.uiTokenAmount.uiAmountString) -
        Number(before?.uiTokenAmount.uiAmountString ?? 0);
      tokenNotes.push(`${p.mint.slice(0, 4)}… Δ${d > 0 ? "+" : ""}${d}`);
    }
  }

  console.log(
    `${sig.signature.slice(0, 12)}… ${new Date((sig.blockTime ?? 0) * 1000).toISOString()}`,
  );
  console.log(
    `  SOL Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(9)}  [${[...programs].join(", ")}]${tokenNotes.length ? ` token: ${tokenNotes.join(", ")}` : ""}`,
  );
}
