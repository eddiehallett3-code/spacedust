/**
 * Measure a sponsored unwrap, deriving rent from the wSOL account itself.
 *
 * The closed account's pre-balance is principal + rent, and the wSOL token
 * balance in the same transaction is the principal — so rent is the difference,
 * not a constant. That matters here: a freshly wrapped account holds the current
 * 2,039,280-lamport deposit, while the older accounts on this wallet hold 1,488,440.
 */
import fs from "node:fs";

const env = fs.readFileSync(".env.local", "utf8");
const key = (env.match(/^HELIUS_API_KEY=(.*)$/m) || [])[1].trim();
const FEE_WALLET = (env.match(/^NEXT_PUBLIC_FEE_WALLET=(.*)$/m) || [])[1].trim();
const SPONSOR = (await (await fetch("https://spacedust.cc/api/sponsor")).json()).sponsor;
const WSOL = "So11111111111111111111111111111111111111112";

async function rpc(method, params) {
  const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}

const entries = await rpc("getSignaturesForAddress", [SPONSOR, { limit: 4 }]);

for (const entry of entries) {
  const tx = await rpc("getTransaction", [
    entry.signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
  ]);
  if (!tx?.meta) continue;

  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
  const instructions = [
    ...(tx.transaction.message.instructions ?? []),
    ...(tx.meta.innerInstructions ?? []).flatMap((g) => g.instructions ?? []),
  ];

  const wsolAccounts = new Set(
    (tx.meta.preTokenBalances ?? []).filter((b) => b.mint === WSOL).map((b) => keys[b.accountIndex]),
  );
  const unwrap = instructions.find(
    (ix) => ix.parsed?.type === "closeAccount" && wsolAccounts.has(ix.parsed.info.account),
  );
  if (!unwrap) continue;

  const closedIndex = keys.indexOf(unwrap.parsed.info.account);
  const released = tx.meta.preBalances[closedIndex];
  const principalBalance = (tx.meta.preTokenBalances ?? []).find(
    (b) => keys[b.accountIndex] === unwrap.parsed.info.account,
  );
  const principal = Math.round((principalBalance?.uiTokenAmount.uiAmount ?? 0) * 1e9);
  const rent = released - principal;

  const feePaid = instructions
    .filter((ix) => ix.parsed?.type === "transfer" && ix.parsed.info.destination === FEE_WALLET)
    .reduce((sum, ix) => sum + (ix.parsed.info.lamports ?? 0), 0);
  const toSponsor = instructions
    .filter((ix) => ix.parsed?.type === "transfer" && ix.parsed.info.destination === SPONSOR)
    .reduce((sum, ix) => sum + (ix.parsed.info.lamports ?? 0), 0);

  const user = tx.transaction.message.accountKeys.find(
    (k) => k.signer && k.pubkey !== SPONSOR && k.pubkey !== FEE_WALLET,
  )?.pubkey;
  const userIndex = user ? keys.indexOf(user) : -1;
  const sponsorIndex = keys.indexOf(SPONSOR);
  const userDelta =
    userIndex > -1 ? tx.meta.postBalances[userIndex] - tx.meta.preBalances[userIndex] : null;
  const sponsorDelta = tx.meta.postBalances[sponsorIndex] - tx.meta.preBalances[sponsorIndex];

  console.log(`\n${entry.signature}`);
  console.log(`  ${new Date(entry.blockTime * 1000).toISOString()} · network fee ${tx.meta.fee} (paid by sponsor)`);
  console.log(`  user ${user}`);
  console.log(`  released ${released} = principal ${principal} + rent ${rent}`);
  console.log(`  platform fee ${feePaid} = ${((feePaid / rent) * 100).toFixed(3)}% of rent`);
  console.log(`  repayment to sponsor ${toSponsor} (sponsor net ${sponsorDelta >= 0 ? "+" : ""}${sponsorDelta})`);
  console.log(
    `  user delta ${userDelta} · expected principal + rent − fee − repayment = ${principal + rent - feePaid - toSponsor}`,
  );
}
