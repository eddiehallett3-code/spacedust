import fs from "node:fs";
import { PublicKey } from "@solana/web3.js";

/**
 * What liquidity positions look like in a real wallet, measured.
 *
 * Before any of this can be closed, the first question is what is *there* — and
 * the answer is not one thing. An LP position is one of:
 *
 *  - a balance of a **pool's own LP token** (Raydium V4, Raydium CPMM, Meteora's
 *    DAMM): a plain SPL token, closeable only after the pool gives the deposits
 *    back, and its rent is worth reclaiming once the balance is zero;
 *  - an **NFT that is the position** (Orca Whirlpools, Meteora DLMM): the position
 *    account is reached through a mint, so "closing" means withdrawing, closing
 *    the position, and burning the NFT.
 *
 * Neither is identifiable from the wallet's token list alone, and guessing would
 * mean building a transaction against the wrong program. Two signals are available
 * from a single `getMultipleAccounts`, without an SDK for any AMM:
 *
 *  - **the mint's authority is off the ed25519 curve.** A wallet can be a mint
 *    authority; a program cannot, so an off-curve authority means the mint belongs
 *    to a program — which is what a pool's LP mint and a position NFT both are.
 *  - **the mint names itself.** These protocols give their mints metadata, and
 *    "Raydium LP Token", "Orca Whirlpool position" and "Meteora DLMM Position" are
 *    the cheapest identification there is.
 *
 * Neither is proof. This prints what is measurable and says so; the point is to
 * find out which protocols are actually present before writing a planner for one.
 *
 * The first version of this also treated "a one-of-one with no decimals" as a
 * position. The control run killed that idea: the Incinerator's first 250 mints
 * include 18 such NFTs — ArtPunk, Lunaroid, Frame — and none of them is a pool.
 * Every NFT ever minted looks like that. The authority is the only signal here
 * that means anything, which is why the prevalence of each authority kind is
 * printed: an empty candidate list should read as "none here", not "broken".
 *
 *   node probes/tmp-lp-probe.mjs [wallet]
 */

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/HELIUS_API_KEY=(.+)/)?.[1]?.trim();
const url = key
  ? `https://mainnet.helius-rpc.com/?api-key=${key}`
  : env.match(/NEXT_PUBLIC_FALLBACK_RPC_URL=(.+)/)?.[1]?.trim();
if (!url) throw new Error("no RPC url");

const WALLET = process.argv[2] ?? "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/**
 * Cap on how many of the wallet's token accounts to look up, for wallets that
 * hold everything (the Incinerator, used as a control). 0 means no cap.
 *
 *   node probes/tmp-lp-probe.mjs 1nc1nerator... 300
 */
const LIMIT = Number(process.argv[3] ?? 0);

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

/** Every token account the wallet holds a balance in. */
const holdings = await rpc("getTokenAccountsByOwner", [
  WALLET,
  { programId: TOKEN_PROGRAM },
  { encoding: "jsonParsed" },
]).then((result) => result.value);

const byMint = new Map();
for (const { account } of LIMIT > 0 ? holdings.slice(0, LIMIT) : holdings) {
  const info = account.data.parsed.info;
  const amount = BigInt(info.tokenAmount.amount);
  if (amount === 0n) continue;
  byMint.set(info.mint, {
    mint: info.mint,
    amount,
    ui: info.tokenAmount.uiAmountString,
    decimals: info.tokenAmount.decimals,
  });
}

const mints = [...byMint.keys()];
const parsed = [];
for (let i = 0; i < mints.length; i += 100) {
  const chunk = mints.slice(i, i + 100);
  const result = await rpc("getMultipleAccounts", [
    chunk,
    { encoding: "jsonParsed" },
  ]);
  result.value.forEach((value, index) => {
    parsed.push({ mint: chunk[index], value });
  });
}

const rows = [];
for (const { mint, value } of parsed) {
  const info = value?.data?.parsed?.info;
  const held = byMint.get(mint);
  if (!info) continue;

  const authority = info.mintAuthority?.address ?? null;
  const offCurve = authority
    ? !PublicKey.isOnCurve(new PublicKey(authority).toBytes())
    : false;
  const decimals = info.decimals ?? held.decimals;
  const supply = info.supply ? BigInt(info.supply) : null;

  rows.push({
    ...held,
    decimals,
    supply,
    authority,
    offCurve,
    program: value.owner,
    // MEASURED, and the first version of this got it wrong: "a one-of-one with no
    // decimals" is every NFT in existence — the control run flagged 18 ordinary
    // NFTs (ArtPunk, Lunaroid, Frame) as pool positions. What actually separates a
    // position from a token is that its mint is **program-controlled**: a wallet can
    // be a mint authority, a program cannot, so an authority off the ed25519 curve
    // is a PDA, which is what a pool's LP mint and a position NFT both have.
    candidate: offCurve,
    name: null,
  });
}

/** The signal's prevalence, so an empty result is readable as "none" not "broken". */
const authorities = { none: 0, onCurve: 0, offCurve: 0 };
for (const row of rows) {
  if (!row.authority) authorities.none += 1;
  else if (row.offCurve) authorities.offCurve += 1;
  else authorities.onCurve += 1;
}

/** The protocols name their own mints, so ask the index rather than the chain. */
const candidates = rows.filter((row) => row.candidate);
for (const row of candidates) {
  try {
    const asset = await rpc("getAsset", { id: row.mint });
    row.name = asset?.content?.metadata?.name ?? null;
  } catch {
    row.name = null;
  }
}

console.log(`wallet ${WALLET}`);
console.log(
  `${rows.length} mints held — mint authority: ${authorities.none} revoked, ${authorities.onCurve} a wallet, ${authorities.offCurve} a program (off-curve)\n`,
);

console.log(
  `candidates — mints controlled by a program (${candidates.length}) — these are what an LP mint or a position NFT looks like:`,
);
for (const row of candidates) {
  console.log(
    `  ${row.mint}\n    name: ${JSON.stringify(row.name)}  decimals: ${row.decimals}  supply: ${row.supply}  held: ${row.ui}\n    mint authority: ${row.authority ?? "none"}  off-curve: ${row.offCurve}  mint program: ${row.program}`,
  );
}

const rest = rows.filter((row) => !row.candidate);
console.log(`\nother ${rest.length} mints held (neither signal fired):`);
for (const row of rest.slice(0, 20)) {
  console.log(`  ${row.mint}  decimals: ${row.decimals}  held: ${row.ui}`);
}
if (rest.length > 20) console.log(`  … and ${rest.length - 20} more`);

console.log(
  "\nAn off-curve mint authority is not proof of a pool: a program-owned mint\n" +
    "could be anything. It is a shortlist, and the name is what identifies it.",
);
