/**
 * One-off: what a transaction did to whose lamports.
 *
 * Written to verify the sweep/sponsor branches from the outside, because the
 * failure that matters is silent: a funded sweep must take **no** sponsor
 * path, a sponsored flow must pay the fee from the sponsor and repay it from
 * the rent it released, and the 1.5% must be charged once. Reading the JSON on
 * Solscan answers all three, slowly and error-prone-ly; this answers them per
 * signature in a line.
 *
 * Usage:
 *   node probes/tmp-sweep-audit.mjs --sig <signature> [more signatures...]
 *   node probes/tmp-sweep-audit.mjs --sponsor [count]     # latest N touching the sponsor
 *
 * Read-only: no signing, no sending. Reads HELIUS_API_KEY and
 * NEXT_PUBLIC_FEE_WALLET from .env.local and prints neither.
 */

import fs from "node:fs";

const ENV_FILE = ".env.local";
const RPC_BASE = "https://mainnet.helius-rpc.com/?api-key=";
const APP_ORIGIN = process.env.APP_ORIGIN ?? "https://spacedust.cc";

function readEnv(name) {
  const text = fs.readFileSync(ENV_FILE, "utf8");
  const match = text.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim() : undefined;
}

const API_KEY = readEnv("HELIUS_API_KEY");
if (!API_KEY) throw new Error("HELIUS_API_KEY missing from .env.local");
const ENDPOINT = RPC_BASE + API_KEY;
const FEE_WALLET = readEnv("NEXT_PUBLIC_FEE_WALLET");

async function rpc(method, params) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status} ${text.slice(0, 160)}`);
  const parsed = JSON.parse(text);
  if (parsed.error) throw new Error(`${method}: ${JSON.stringify(parsed.error)}`);
  return parsed.result;
}

/**
 * Program ids worth naming. Anything else prints as its address, which is the
 * honest default: a guess at an unknown program would hide exactly the sort of
 * instruction this probe exists to catch.
 */
const PROGRAMS = new Map([
  ["11111111111111111111111111111111", "System"],
  ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "Token"],
  ["TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", "Token-2022"],
  ["ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", "AssociatedToken"],
  ["ComputeBudget111111111111111111111111111111", "ComputeBudget"],
  ["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo"],
  ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", "Jupiter v6"],
  ["L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95", "Phantom guard"],
  ["NamesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX", "SNS name service"],
]);

const short = (address) => `${address.slice(0, 4)}…${address.slice(-4)}`;
const sol = (lamports) => (lamports / 1e9).toFixed(6);

async function sponsorAddress() {
  try {
    const response = await fetch(`${APP_ORIGIN}/api/sponsor`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return undefined;
    const body = await response.json();
    return body?.address ?? body?.sponsor ?? undefined;
  } catch {
    return undefined;
  }
}

function instructions(tx) {
  const outer = tx.transaction.message.instructions ?? [];
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((group) => group.instructions ?? []);
  return [...outer, ...inner];
}

async function audit(signature, sponsor) {
  const tx = await rpc("getTransaction", [
    signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
  ]);

  if (!tx) {
    console.log(`${short(signature)} — not found (or older than the node keeps)\n`);
    return;
  }

  const keys = (tx.transaction.message.accountKeys ?? []).map((entry) =>
    typeof entry === "string" ? entry : entry.pubkey,
  );
  const pre = tx.meta?.preBalances ?? [];
  const post = tx.meta?.postBalances ?? [];

  const deltas = keys
    .map((address, index) => ({ address, delta: (post[index] ?? 0) - (pre[index] ?? 0) }))
    .filter((entry) => entry.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const payer = keys[0];
  const sponsorDelta = sponsor ? (deltas.find((d) => d.address === sponsor)?.delta ?? 0) : 0;
  const feeDelta = FEE_WALLET ? (deltas.find((d) => d.address === FEE_WALLET)?.delta ?? 0) : 0;
  const userDelta = keys[1] ? (deltas.find((d) => d.address === keys[1])?.delta ?? 0) : 0;

  console.log(`\n${signature}`);
  console.log(
    `  ${tx.meta?.err ? `FAILED ${JSON.stringify(tx.meta.err)}` : "landed"} · slot ${tx.slot}` +
      `${tx.blockTime ? ` · ${new Date(tx.blockTime * 1000).toISOString()}` : ""}`,
  );
  console.log(`  fee payer: ${short(payer)}${sponsor && payer === sponsor ? "  <- sponsor" : ""}`);
  console.log(`  fee: ${sol(tx.meta?.fee ?? 0)} SOL (${payer === sponsor ? "sponsor" : "user"})`);

  console.log("  instructions:");
  for (const instruction of instructions(tx)) {
    const programId = instruction.programId ?? "?";
    const name = PROGRAMS.get(programId) ?? short(programId);
    const args =
      instruction.parsed?.type ??
      (instruction.accounts ? `${instruction.accounts.length} accounts` : "");
    console.log(`    - ${name.padEnd(18)} ${args}`);
  }

  console.log("  lamport movement:");
  for (const { address, delta } of deltas) {
    const tags = [];
    if (address === sponsor) tags.push("SPONSOR");
    if (address === FEE_WALLET) tags.push("fee wallet");
    if (address === payer && payer !== sponsor) tags.push("payer");
    console.log(
      `    ${short(address).padEnd(11)} ${delta > 0 ? "+" : ""}${sol(delta).padStart(11)} SOL` +
        `${tags.length ? `   ${tags.join(", ")}` : ""}`,
    );
  }

  // The three questions this probe exists to answer, stated plainly. "Netted"
  // is the sponsor's balance change across the whole transaction, which is what
  // proves the model: it pays the fee and is repaid out of the rent it released.
  const verdict = [];
  verdict.push(
    payer !== sponsor && sponsorDelta === 0
      ? "sponsor: absent (funded path — no repayment instruction)"
      : `sponsor: paid fee ${sol(tx.meta?.fee ?? 0)}, netted ${sponsorDelta >= 0 ? "+" : ""}${sol(sponsorDelta)}`,
  );
  if (FEE_WALLET) verdict.push(`fee wallet: ${feeDelta >= 0 ? "+" : ""}${sol(feeDelta)}`);
  verdict.push(`user side: ${userDelta >= 0 ? "+" : ""}${sol(userDelta)}`);
  console.log(`  verdict: ${verdict.join(" · ")}`);
}


const args = process.argv.slice(2);
const sponsor = await sponsorAddress();

if (args[0] === "--sponsor") {
  if (!sponsor) throw new Error("could not read the sponsor address from /api/sponsor");
  const count = Number(args[1] ?? 5);
  const balance = await rpc("getBalance", [sponsor, { commitment: "confirmed" }]);
  console.log(
    `sponsor ${short(sponsor)} — balance ${sol(balance.value)} SOL — last ${count} signatures`,
  );

  const signatures = await rpc("getSignaturesForAddress", [sponsor, { limit: count }]);
  if (!signatures.length) console.log("  none yet");
  for (const entry of signatures) {
    if (entry.err) console.log(`\n${entry.signature}\n  FAILED ${JSON.stringify(entry.err)}`);
    else await audit(entry.signature, sponsor);
  }
} else {
  const signatures = args[0] === "--sig" ? args.slice(1) : args;
  if (!signatures.length) {
    console.log("usage: --sig <signature>... | --sponsor [count]");
    process.exit(1);
  }
  for (const signature of signatures) await audit(signature, sponsor);
}

