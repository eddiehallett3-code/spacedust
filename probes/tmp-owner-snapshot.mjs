import fs from "node:fs";

/**
 * A snapshot of what the index returns for one wallet, right now.
 *
 * Taken before a Phantom reinstall so the comparison afterwards is honest. The
 * question the reinstall answers is which layer was showing burned assets:
 *
 *  - If they disappear from a fresh install, Phantom's own cache was holding
 *    them, and its index genuinely filters burned assets.
 *  - If they come back, Phantom lists them regardless of the `burnt` flag, and no
 *    amount of reinstalling changes it — only Phantom's own hide control would.
 *
 * Either way the chain has not moved, so this file is the control.
 */

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/HELIUS_API_KEY=(.+)/)?.[1]?.trim();
const url = key
  ? `https://mainnet.helius-rpc.com/?api-key=${key}`
  : env.match(/NEXT_PUBLIC_FALLBACK_RPC_URL=(.+)/)?.[1]?.trim();
if (!url) throw new Error("no RPC url");

const WALLET = process.argv[2] ?? "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";

const listings = [];
for (let page = 1; page <= 5; page += 1) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "getAssetsByOwner",
      params: {
        ownerAddress: WALLET,
        page,
        limit: 1000,
        options: { showFungible: false, showZeroBalance: false },
      },
    }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  const items = body.result?.items ?? [];
  listings.push(...items);
  if (items.length === 0) break;
}

const burned = listings.filter((item) => item.burnt === true);
console.log(`wallet: ${WALLET}`);
console.log(`the index returns ${listings.length} assets, of which ${burned.length} are flagged burnt:\n`);

for (const item of listings) {
  const size = item.compression?.compressed ? "cNFT" : "account";
  console.log(
    `  ${item.burnt === true ? "BURNT " : "live  "} ${size.padEnd(8)} ${String(item.interface).padEnd(16)} ${item.id}  ${JSON.stringify(String(item.content?.metadata?.name ?? "").slice(0, 24))}`,
  );
}

console.log(
  "\nThis is the control for the reinstall test: any asset above that is still\n" +
    "listed after a fresh install is being shown by Phantom itself, not cached.",
);
