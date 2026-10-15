import fs from "node:fs";

/**
 * Temp probe: how does a burner make an asset disappear from a wallet?
 *
 * A dApp cannot reach into a wallet's asset list, so the only way a burn can
 * make something vanish "instantly" is by changing what the wallet's index
 * attributes to the address. Burning does that by destroying the asset; the
 * other way is *transferring it away* to a burn address, which leaves the asset
 * alive but owned by nobody.
 *
 * Sol Incinerator's well-known destination address is used to tell the two
 * apart: if it holds a pile of NFTs, that tool's "burn" is a transfer.
 *
 * Params are sent as an **object**, which is the DAS convention — sending an
 * array is what made an earlier version of this probe fail with "invalid type:
 * map, expected a string", which reads like a server problem and was not one.
 */

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/HELIUS_API_KEY=(.+)/)?.[1]?.trim();
const url = key
  ? `https://mainnet.helius-rpc.com/?api-key=${key}`
  : env.match(/NEXT_PUBLIC_FALLBACK_RPC_URL=(.+)/)?.[1]?.trim();
if (!url) throw new Error("no RPC url");

const INCINERATOR = "1nc1nerator11111111111111111111111111111111";
const WALLET = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
const BURNED = [
  "HaMH9WrupbzTtc3pT1GVbkJDYoYXTEchWck8J9g4Lir2",
  "HsiazTgzZW2wZfRnc7bm9jC1RTLL63bo62KavCVzig5v",
];

async function assetsOf(owner, page = 1) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "getAssetsByOwner",
      params: {
        ownerAddress: owner,
        page,
        limit: 1000,
        options: { showFungible: true, showZeroBalance: false },
      },
    }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

console.log("── Does the incinerator address hold assets? ──");
const incinerator = await assetsOf(INCINERATOR);
const items = incinerator?.items ?? [];
console.log("  total items reported:", incinerator?.total ?? items.length);
const byInterface = {};
for (const item of items) {
  byInterface[item.interface ?? "?"] = (byInterface[item.interface ?? "?"] ?? 0) + 1;
}
console.log("  on page 1:", JSON.stringify(byInterface));
for (const item of items.slice(0, 4)) {
  console.log(
    `   - ${String(item.id).slice(0, 14)}… ${item.interface} "${String(item.content?.metadata?.name ?? "").slice(0, 20)}" burnt=${JSON.stringify(item.burnt)}`,
  );
}

console.log("\n── Are any of them compressed (cNFTs)? ──");
const compressed = items.filter((item) => item.compression?.compressed === true);
const uncompressed = items.filter((item) => item.compression?.compressed === false);
console.log("  compressed (cNFT leaves) :", compressed.length);
console.log("  uncompressed (accounts)  :", uncompressed.length);
for (const item of compressed.slice(0, 4)) {
  console.log(
    `   - cNFT ${String(item.id).slice(0, 14)}… tree=${String(item.compression?.tree ?? "?").slice(0, 12)}… leaf=${item.compression?.leaf_id ?? "?"} burnt=${JSON.stringify(item.burnt)}`,
  );
}

const mine = await assetsOf(WALLET);
const myItems = mine?.items ?? [];
console.log("  items:", myItems.length);
for (const id of BURNED) {
  const found = myItems.find((item) => item.id === id);
  console.log(
    `  ${id.slice(0, 12)}… present=${found ? "YES" : "no"}${found ? ` burnt=${JSON.stringify(found.burnt)}` : ""}`,
  );
}

console.log("\n── What do the parked assets still hold? ──");
const parkedCore = items.filter((item) => item.interface === "MplCoreAsset");
console.log("  Core assets parked there:", parkedCore.length);
if (parkedCore.length > 0) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "getMultipleAccounts",
      params: [
        parkedCore.map((item) => item.id),
        { encoding: "base64" },
      ],
    }),
  });
  const body = await response.json();
  const accounts = body.result;
  parkedCore.forEach((item, index) => {
    const info = accounts?.value?.[index];
    const size = info?.data?.[0]
      ? Buffer.from(info.data[0], "base64").length
      : 0;
    console.log(
      `   - ${String(item.id).slice(0, 16)}… ${String(size).padStart(4)} bytes ${String(info?.lamports ?? 0).padStart(9)} lamports  "${String(item.content?.metadata?.name ?? "").slice(0, 20)}"`,
    );
  });
  console.log(
    "  None of that is recoverable: the address has no key, so nothing there can\n" +
      "  sign a burn. A parked Core asset is frozen with its rent inside it.",
  );
}

