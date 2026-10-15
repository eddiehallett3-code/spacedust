import fs from "node:fs";

/**
 * Temp probe: why do two burned assets still appear in the scan?
 *
 * `liveNonFungibles` drops an asset when the chain proves it is gone — a missing
 * account, or Core's one-byte husk — but it can only do that for assets that
 * have an account *by nature*, which a cNFT does not. The cNFT path relies on
 * Helius's own `burnt` flag instead. This checks both halves against the two
 * real assets a user reported reappearing.
 */

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/HELIUS_API_KEY=(.+)/)?.[1]?.trim();
if (!key) throw new Error("missing HELIUS_API_KEY");

const RPC = `https://mainnet.helius-rpc.com/?api-key=${key}`;
const OWNER = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
const CORE_ASSET = "3ZEzgjprXx22pTDFTp4QiWakxMx4VsKxbCxT7VrnyXfb";
const CNFT = "HtGMV122gYbh7RknMUe2iaRzxa9W9MBbWcGArWgDZvwe";

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

console.log("── 1. What the chain says about the Core asset account ──");
const account = await rpc("getAccountInfo", [CORE_ASSET, { encoding: "base64" }]);
const value = account?.value;
if (value === null || value === undefined) {
  console.log("  account: null (closed) → the app's check WOULD hide it");
} else {
  const [base64] = value.data ?? [];
  const bytes = Buffer.from(base64 ?? "", "base64");
  const discriminator = bytes[0];
  console.log("  account exists  : yes");
  console.log("  owner program   :", value.owner);
  console.log("  lamports        :", value.lamports);
  console.log("  base64 chars    :", (base64 ?? "").length);
  console.log("  decoded bytes   :", bytes.length);
  console.log("  first 4 bytes   :", [...bytes.slice(0, 4)].join(","));
  console.log(
    "  the app calls it:",
    bytes.length === 1 && discriminator === 0
      ? "a HUSK → would be hidden"
      : `NOT a husk (${bytes.length} bytes, discriminator ${discriminator}${
          discriminator === 1 ? " = Core AssetV1, i.e. a LIVE asset" : ""
        }) → survives the filter`,
  );
}

console.log("\n── 2. What the index says about both ──");
for (const [label, id] of [["Core asset", CORE_ASSET], ["cNFT", CNFT]]) {
  let asset = null;
  for (const params of [[{ id }], [id]]) {
    try {
      asset = await rpc("getAsset", params);
      break;
    } catch (error) {
      console.log(`  (${label}: params ${JSON.stringify(params)} rejected — ${error.message})`);
    }
  }
  if (!asset) continue;
  console.log(
    `  ${label.padEnd(10)} burnt=${JSON.stringify(asset?.burnt)} | interface=${asset?.interface} | compressed=${asset?.compression?.compressed}`,
  );
  console.log(
    `             ownership.owner=${asset?.ownership?.owner} | owner=${asset?.owners?.[0] ?? "?"}`,
  );
}

console.log("\n── 3. Which assets did the wallet actually burn? ──");
const HELIUS_API = "https://api.helius.xyz/v0";
const historyUrl = `${HELIUS_API}/addresses/${OWNER}/transactions?api-key=${key}&limit=100`;
const history = await (await fetch(historyUrl)).json();

const burnSigs = history
  .filter((tx) => /BURN/i.test(String(tx.type ?? "")))
  .map((tx) => tx.signature);
console.log("  burn transactions in the last 100:", burnSigs.length);

const detailResponse = await fetch(`${HELIUS_API}/transactions?api-key=${key}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ transactions: burnSigs }),
});
const detailed = detailResponse.ok ? await detailResponse.json() : [];
console.log("  fetched in detail:", Array.isArray(detailed) ? detailed.length : 0);

/** The compressed asset ids an enhanced transaction burned, if any. */
function burntAssetIdsIn(tx) {
  const found = new Set();
  for (const event of tx?.events?.compressed ?? []) {
    if (event?.assetId) found.add(event.assetId);
  }
  // Helius also reports cNFT burns as an instruction with `compressed` inner
  // events; the type is already known, so fall back to a scan of the raw body.
  const raw = JSON.stringify(tx ?? {});
  if (found.size === 0) {
    for (const match of raw.matchAll(/"(?:asset|assetId|id)":"([1-9A-HJ-NP-Za-km-z]{32,44})"/g)) {
      found.add(match[1]);
    }
  }
  return [...found];
}

for (const tx of Array.isArray(detailed) ? detailed : []) {
  const ids = burntAssetIdsIn(tx);
  console.log(`\n  ${tx.signature.slice(0, 20)}… type=${tx.type}`);
  console.log(`    when: ${new Date((tx.timestamp ?? 0) * 1000).toISOString()}`);
  if (ids.length === 0) console.log("    (no compressed asset id in this transaction)");
  for (const id of ids) {
    const marker =
      id === CNFT
        ? "   ← THE cNFT STILL SHOWING IN THE SCAN"
        : id === CORE_ASSET
          ? "   ← the Core asset still showing"
          : "";
    console.log(`    buried asset: ${id}${marker}`);

console.log("\n── 4. Are the burned ones flagged, and is the shown one alive? ──");
const BURNED = [
  "HsiazTgzZW2wZfRnc7bm9jC1RTLL63bo62KavCVzig5v",
  "HaMH9WrupbzTtc3pT1GVbkJDYoYXTEchWck8J9g4Lir2",
];

for (const [label, id] of [
  ["burned today    ", BURNED[0]],
  ["burned yesterday", BURNED[1]],
  ["SHOWN IN SCAN   ", CNFT],
]) {
  try {
    const asset = await rpc("getAsset", [id]);
    console.log(
      `  ${label}: "${String(asset?.content?.metadata?.name ?? "?").slice(0, 26)}" burnt=${JSON.stringify(asset?.burnt)} owner=${String(asset?.ownership?.owner ?? "?").slice(0, 8)}…`,
    );
  } catch (error) {
    console.log(`  ${label}: getAsset failed — ${error.message.slice(0, 60)}`);
  }
}

console.log("\n  merkle proof for the asset still listed (a live leaf has one):");
try {
  const proof = await rpc("getAssetProof", [CNFT]);
  const nodes = (proof?.proof ?? []).length;

console.log("\n── 5. Chain-level proof: is the burned leaf really gone? ──");
console.log("   A live leaf yields a merkle proof. A burnt leaf has nothing to prove.");
for (const [label, id] of [
  ["burned yesterday", "HaMH9WrupbzTtc3pT1GVbkJDYoYXTEchWck8J9g4Lir2"],
  ["burned today    ", "HsiazTgzZW2wZfRnc7bm9jC1RTLL63bo62KavCVzig5v"],
  ["still owned     ", CNFT],
]) {
  try {
    const proof = await rpc("getAssetProof", [id]);
    const nodes = (proof?.proof ?? []).length;
    console.log(
      `   ${label}: proof nodes=${nodes}${nodes > 0 ? "  → LIVE (this asset exists)" : "  → no proof (burnt)"}`,
    );
  } catch (error) {
    console.log(`   ${label}: getAssetProof refused — ${error.message.slice(0, 70)}`);
  }
}

  console.log(
    "   tree:", String(proof?.tree_id ?? proof?.tree ?? "?").slice(0, 20) + "…",
    "| leafId:", proof?.leaf_id ?? proof?.leafId ?? "?",
    "| proof nodes:", nodes,
    nodes > 0 ? "→ LIVE" : "→ NOT proven live",
  );
} catch (error) {
  console.log("   getAssetProof failed:", error.message.slice(0, 80));
}

  }
}

