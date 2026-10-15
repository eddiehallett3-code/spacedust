import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import fs from "node:fs";

/**
 * Temp probe: can a Core husk be reassigned and drained, as one plan proposes?
 *
 * The proposal is to "reassign the account owner to the Solana System Program
 * and transfer the entire lamport balance out to the user's wallet in the exact
 * same transaction block" instead of "leaving the 1-byte runtime husk".
 *
 * A husk is a real account, owned by the Core program, holding 655,320 lamports
 * after a Core burn. This builds exactly that transaction and simulates it.
 * Nothing is signed or sent.
 */

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/HELIUS_API_KEY=(.+)/)?.[1]?.trim();
const url = key
  ? `https://mainnet.helius-rpc.com/?api-key=${key}`
  : env.match(/NEXT_PUBLIC_FALLBACK_RPC_URL=(.+)/)?.[1]?.trim();
const payer = env.match(/FEE_WALLET=(.+)/)?.[1]?.trim();
if (!url || !payer) throw new Error("missing env");

/** The husk left by the burn of "RMK #1594". */
const HUSK = "BqoDQj1Rs4h4kZjDTpPM1oCwum5vhz63MWFeyQnet5iY";
/** The wallet that used to own it — the destination the plan wants. */
const OWNER = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
/** The Core program that owns the husk. */
const CORE_PROGRAM = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";

const connection = new Connection(url, "confirmed");

const huskInfo = await connection.getAccountInfo(new PublicKey(HUSK));
console.log("── The husk as it stands ──");
console.log("  lamports      :", huskInfo?.lamports);
console.log("  data length    :", huskInfo?.data.length);
console.log("  owned by       :", huskInfo?.owner.toBase58());
console.log(
  "  transferable?  :",
  huskInfo?.owner.toBase58() === OWNER || huskInfo?.owner.toBase58() === payer
    ? "the owner is a wallet, so yes"
    : "NO — only the owning program may debit it",
);

console.log("\n── Simulate exactly what the plan asks for ──");
const { blockhash } = await connection.getLatestBlockhash("confirmed");
const message = new TransactionMessage({
  payerKey: new PublicKey(payer),
  recentBlockhash: blockhash,
  instructions: [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    // Step 3 of the plan, second half: move the whole balance to the user's
    // wallet. (The `assign` that has to precede it was simulated first and was
    // rejected by the runtime as `ModifiedProgramId`.)
    SystemProgram.transfer({
      fromPubkey: new PublicKey(HUSK),
      toPubkey: new PublicKey(OWNER),
      lamports: huskInfo?.lamports ?? 0,
    }),
  ],
}).compileToV0Message();

const simulation = await connection.simulateTransaction(
  new VersionedTransaction(message),
  { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" },
);

console.log("  err  :", simulation.value.err ?? "null (it would succeed)");
console.log("  units:", simulation.value.unitsConsumed);
for (const line of simulation.value.logs ?? []) console.log("   ", line);

console.log("\n  Core program id, for reference:", CORE_PROGRAM);
