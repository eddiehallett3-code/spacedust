import fs from "node:fs";

/**
 * Temp probe: what did one burn transaction actually do, and what is left?
 *
 * Prints the instructions that ran, then the **current** state of every account
 * the transaction touched. A closed account reads as zero lamports and zero
 * bytes, so this shows directly whether the metadata and master edition were
 * closed or left behind — the difference between an asset that vanishes from a
 * wallet and one that keeps being listed.
 */

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/HELIUS_API_KEY=(.+)/)?.[1]?.trim();
const url = key
  ? `https://mainnet.helius-rpc.com/?api-key=${key}`
  : env.match(/NEXT_PUBLIC_FALLBACK_RPC_URL=(.+)/)?.[1]?.trim();
if (!url) throw new Error("no RPC url");

const SIGNATURE =
  process.argv[2] ??
  "2kHxgCoErYTBcQcL2U4s3Re2gtsPMXJXA26DpbncCe2defurCjZiprSm7exDqL1zP39yKK3VMEq17q2RNoTr6y5j";

const PROGRAMS = {
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: "Token Metadata",
  CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d: "mpl-core",
  BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY: "Bubblegum",
  cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK: "Account Compression",
  ComputeBudget111111111111111111111111111111: "ComputeBudget",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token",
  "11111111111111111111111111111111": "System",
  SysvarRent111111111111111111111111111111111: "Sysvar Rent",
  Sysvar1nstructions1111111111111111111111111: "Sysvar Instructions",
};

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

const tx = await rpc("getTransaction", [
  SIGNATURE,
  {
    encoding: "jsonParsed",
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  },
]);
if (!tx) throw new Error("transaction not found");

console.log("── The transaction ──");
console.log("  slot     :", tx.slot);
console.log("  error    :", tx.meta?.err ?? "null (it succeeded)");
console.log("  fee      :", tx.meta?.fee, "lamports");
console.log("  log lines:", (tx.meta?.logMessages ?? []).length);

console.log("\n  programs invoked:");
const message = tx.transaction.message;
const accountKeys = (message.accountKeys ?? []).map((entry) =>
  typeof entry === "string" ? entry : entry.pubkey,
);
for (const ix of message.instructions ?? []) {
  const program = accountKeys[ix.programIdIndex] ?? ix.programId ?? "?";
  const label = PROGRAMS[program] ?? program;
  console.log(
    `   - ${label}${ix.parsed ? ` :: ${typeof ix.parsed === "string" ? ix.parsed : ix.parsed.type}` : ""}`,
  );
}
for (const inner of tx.meta?.innerInstructions ?? []) {
  for (const ix of inner.instructions ?? []) {
    const program = ix.programId ?? accountKeys[ix.programIdIndex] ?? "?";
    console.log(`   - (inner) ${PROGRAMS[program] ?? program}`);
  }
}

console.log("\n── What is left of every account it touched ──");
const infos = await rpc("getMultipleAccounts", [
  accountKeys,
  { encoding: "base64" },
]);
const labels = accountKeys.map((address, index) => {
  const info = infos.value?.[index];
  const size = info?.data?.[0] ? Buffer.from(info.data[0], "base64").length : 0;
  const lamports = info?.lamports ?? 0;
  const owner = info?.owner ? (PROGRAMS[info.owner] ?? info.owner.slice(0, 8)) : "—";
  const closed = lamports === 0 && size === 0;
  return {
    address,
    line: `  ${closed ? "CLOSED " : "exists "} ${String(size).padStart(4)} bytes ${String(lamports).padStart(9)} lamports  ${owner.padEnd(14)} ${address}`,
    closed,
  };
});
for (const { line } of labels) console.log(line);

const closed = labels.filter((entry) => entry.closed).map((entry) => entry.address);
console.log(`\n  closed accounts: ${closed.length}`);


console.log("\n── Where did the lamports actually go? ──");
const pre = tx.meta?.preBalances ?? [];
const post = tx.meta?.postBalances ?? [];
const deltas = accountKeys.map((address, index) => ({
  address,
  delta: (post[index] ?? 0) - (pre[index] ?? 0),
}));
for (const { address, delta } of deltas) {
  if (delta === 0) continue;
  const label = PROGRAMS[address] ?? "account";
  console.log(
    `  ${delta > 0 ? "+" : ""}${String(delta).padStart(10)} lamports  ${label.padEnd(14)} ${address}`,
  );
}
const walletDelta = deltas.find(
  (entry) => entry.address === "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi",
)?.delta;
console.log(
  `\n  the burner's own wallet: ${walletDelta !== undefined && walletDelta > 0 ? "GAINED" : walletDelta === 0 ? "unchanged" : "LOST"} ${walletDelta ?? 0} lamports (fee was ${tx.meta?.fee ?? "?"})`,
);

console.log("\n── What does the index say about that asset now? ──");
const husk = labels.find(
  (entry) =>
    !entry.closed &&
    entry.line.includes("mpl-core") &&
    entry.line.includes("1 bytes"),
);
const assetId = husk?.address ?? accountKeys[1];

let asset = null;
try {
  asset = await rpc("getAsset", [assetId]);
} catch (error) {
  console.log("  getAsset:", error.message.slice(0, 80));
}
if (asset) {
  console.log("  id       :", asset.id);
  console.log("  interface:", asset.interface);
  console.log("  burnt    :", JSON.stringify(asset.burnt));
  console.log("  owner    :", asset.ownership?.owner ?? "?");
  console.log(
    "  name     :",
    JSON.stringify(String(asset.content?.metadata?.name ?? "").slice(0, 30)),
  );
}

const owner = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
const listing = await rpc("getAssetsByOwner", {
  ownerAddress: owner,
  page: 1,
  limit: 1000,
  options: { showFungible: false, showZeroBalance: false },
});
const items = listing?.items ?? [];
const stillListed = items.find((item) => item.id === assetId);
console.log("\n  does the wallet's own asset list still return it?");
console.log(
  "   total items:",
  items.length,
  "| present:",
  stillListed ? "YES" : "no",
  stillListed ? `| burnt=${JSON.stringify(stillListed.burnt)}` : "",
);
