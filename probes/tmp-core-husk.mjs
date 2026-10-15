import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import fs from "node:fs";

/**
 * Temp probe: what does a Core burn actually leave behind?
 *
 * The codebase contains two contradictory claims about this, which is why the
 * probe exists:
 *
 *  - `lib/solana/core-burn.ts` says the program "closes the asset itself and
 *    returns its rent to the owner".
 *  - `lib/solana/rent.ts` and `lib/solana/liveness.ts` say Core "shrinks the
 *    account to one zero byte instead of closing it", and go to the trouble of
 *    pricing and filtering that husk.
 *
 * Only one can be right, and it matters: if a burn closes the account, a burned
 * Core asset disappears from every wallet and there is nothing left to reclaim.
 * If it leaves a husk, the account — and its rent — are stranded forever, and
 * any wallet whose index does not check the byte will keep showing the asset.
 *
 * The test settles it by simulating a real burn on a real live asset and reading
 * the account **after** the simulated transaction. Nothing is signed and nothing
 * is sent: `simulateTransaction` cannot change state.
 */

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/HELIUS_API_KEY=(.+)/)?.[1]?.trim();
const fallback = env.match(/NEXT_PUBLIC_FALLBACK_RPC_URL=(.+)/)?.[1]?.trim();
const url = key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : fallback;
const payer = env.match(/FEE_WALLET=(.+)/)?.[1]?.trim();
if (!url || !payer) throw new Error("missing env");

const connection = new Connection(url, "confirmed");

/** The wallet that owns the asset — the authority that has to sign a burn. */
const OWNER = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
/** A live Core asset this wallet owns ("Pandas On Sol #28"). */
const ASSET = "3ZEzgjprXx22pTDFTp4QiWakxMx4VsKxbCxT7VrnyXfb";
/**
 * Its collection. Core requires the collection account when the asset has one,
 * and omitting it is a failed burn rather than a slightly different one — which
 * is what the first run of this probe actually measured.
 */
const COLLECTION = "ChYxd9WMMPEgfbafUcMhCVMgzQhHaj2SBUfEB2D2b81f";

console.log("\n── 2. Build the exact instruction the app builds ──");
const [umi, core, adapters] = await Promise.all([
  import("@metaplex-foundation/umi"),
  import("@metaplex-foundation/mpl-core"),
  import("@metaplex-foundation/umi-web3js-adapters"),
]);

const context = umi.createUmi();
// The same shim the app uses: mpl-core resolves its program id through the
// repository, asking with the address as its own fallback.
context.programs = {
  add: () => {},
  getPublicKey: (name, fallbackAddress) => {
    if (!fallbackAddress) throw new Error(`no address for umi program "${name}"`);
    return fallbackAddress;
  },
};
context.use(core.mplCore());

const owner = umi.createNoopSigner(umi.publicKey(OWNER));
const builder = core.burnV1(context, {
  asset: umi.publicKey(ASSET),
  collection: umi.publicKey(COLLECTION),
  authority: owner,
  payer: owner,
});
const [umiInstruction] = builder.getInstructions();
if (!umiInstruction) throw new Error("mpl-core built no instruction");
const instruction = adapters.toWeb3JsInstruction(umiInstruction);

console.log("  program :", instruction.programId.toBase58());
console.log("  data    :", [...instruction.data].slice(0, 12).join(","), "(8-byte discriminator + args)");
console.log("  keys    :");
for (const key of instruction.keys) {
  console.log(
    `    ${key.pubkey.toBase58()} ${key.isSigner ? "SIGNER " : ""}${key.isWritable ? "writable" : ""}`,
  );
}

console.log("\n── 3. Simulate it and read the account AFTERWARDS ──");
const { blockhash } = await connection.getLatestBlockhash("confirmed");
const message = new TransactionMessage({
  payerKey: new PublicKey(payer),
  recentBlockhash: blockhash,
  instructions: [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    instruction,
  ],
}).compileToV0Message();

const simulation = await connection.simulateTransaction(
  new VersionedTransaction(message),
  {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
    // The point of the probe: the RPC returns these accounts as they would be
    // *after* the transaction.
    accounts: { addresses: [ASSET], encoding: "base64" },
  },
);

console.log("  simulation err :", simulation.value.err ?? "null (the burn would succeed)");
console.log("  units          :", simulation.value.unitsConsumed);

const after = simulation.value.accounts?.[0];

// A failed simulation changes nothing, so its "after" state says nothing. The
// first run of this probe read a null result there as "the account was closed"
// — which is the opposite of what it meant.
if (simulation.value.err !== null && simulation.value.err !== undefined) {
  console.log(
    "  asset account  : UNREADABLE — the burn failed, so no state changed.",
  );
} else if (after === null || after === undefined) {
  console.log("  asset account  : GONE → the burn closes it. Rent is returned.");
} else {
  const bytes = Buffer.from(after.data?.[0] ?? "", "base64");
  console.log("  asset account  : still exists");
  console.log("  lamports after :", after.lamports);
  console.log("  data length    :", bytes.length, `bytes [${[...bytes.slice(0, 4)]}]`);
  if (bytes.length === 1 && bytes[0] === 0) {
    console.log("  → A HUSK: the account survives as one zero byte, rent and all.");
  } else if (bytes.length === 0) {
    console.log("  → emptied but not closed.");
  } else {
    console.log("  → unchanged shape — the simulation did not burn it.");
  }
}

const CORE_PROGRAM = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";

async function rpc(method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

console.log("── 1. Do husks exist on mainnet at all? ──");
const page = await rpc("getProgramAccountsV2", [
  CORE_PROGRAM,
  { encoding: "base64", limit: 8, filters: [{ dataSize: 1 }] },
]);
const husks = Array.isArray(page) ? page : (page.accounts ?? []);
console.log("  one-byte accounts owned by the Core program:", husks.length);
for (const husk of husks.slice(0, 3)) {
  const [base64] = husk.account?.data ?? [];
  const bytes = Buffer.from(base64 ?? "", "base64");
  console.log(
    `   - ${husk.pubkey} lamports=${husk.account?.lamports} bytes=[${[...bytes]}]`,
  );
}

console.log("\n── What does the chain charge to keep one byte alive? ──");
for (const [size, label] of [
  [1, "the husk"],
  [165, "one SPL token account"],
]) {
  const rent = await rpc("getMinimumBalanceForRentExemption", [size]);
  const perByte = Math.round(rent / (size + 128));
  console.log(
    `  rent-exempt for ${String(size).padStart(3)} bytes (${label}): ${rent} lamports  → ${perByte} per byte`,
  );
}
console.log(
  "  The husk held 655,320 = 129 x 5,080, and a 165-byte token account is\n" +
    "  1,488,440 = 293 x 5,080 — one rate for both. The 6,960-per-byte figure used\n" +
    "  by older write-ups gives 897,840 for 129 bytes, which is where the widely\n" +
    "  quoted ~0.0009 SOL residual comes from. On today's rate it is ~0.000655 SOL.",
);

