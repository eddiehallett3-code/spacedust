/**
 * Temp probe: does the Referral Program's claim instruction carry an amount?
 *
 * The question this answers decides where slingshot fees can safely land. The
 * Router path (`/swap/v2/build`) supports `platformFeeBps` + `feeAccount` and
 * ignores referral params, so if we want fees to accumulate in the referral
 * token accounts the user just created, we pay them in as a plain platform fee.
 * That is only safe if the program's claim instruction drains whatever token
 * balance is in the account rather than an amount it recorded itself — a plain
 * deposit is invisible to the program's own accounting.
 *
 * Instruction *data length* answers it without trusting any prose:
 *   8 bytes  → discriminator only, no amount argument, claim drains the balance
 *   16 bytes → discriminator + u64 amount, claim is accrual-tracked
 *
 * Read-only: no keypair, no signing, no sending.
 */
import { readFileSync, existsSync } from "node:fs";

const env = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
const pick = (name) => {
  const fromFile = env.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1] ?? "";
  return (fromFile || process.env[name] || "").trim().replace(/^["']|["']$/g, "");
};

const helius = pick("HELIUS_API_KEY");
const rpc =
  pick("NEXT_PUBLIC_RPC_URL") ||
  (helius ? `https://mainnet.helius-rpc.com/?api-key=${helius}` : "") ||
  pick("NEXT_PUBLIC_FALLBACK_RPC_URL");

if (!rpc) {
  console.error("No RPC endpoint found in .env.local.");
  process.exit(1);
}
console.log(`rpc host: ${new URL(rpc).host}\n`);

const REFERRAL_PROGRAM_ID = "REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3";

let id = 0;
async function rpcCall(method, params) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/** base58 → byte length, without pulling in a dependency for one line. */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Length(text) {
  let value = 0n;
  for (const char of text) {
    const digit = B58.indexOf(char);
    if (digit < 0) return -1;
    value = value * 58n + BigInt(digit);
  }
  let zeroes = 0;
  while (zeroes < text.length && text[zeroes] === "1") zeroes++;
  let bytes = 0;
  for (let v = value; v > 0n; v >>= 8n) bytes++;
  return bytes + zeroes;
}

const signatures = await rpcCall("getSignaturesForAddress", [
  REFERRAL_PROGRAM_ID,
  { limit: 25 },
]);
console.log(`recent transactions touching the program: ${signatures.length}\n`);

/** Every instruction in one transaction, with its data length. */
function describe(transaction) {
  const instructions = (transaction?.transaction?.message?.instructions ?? []).map(
    (ix) => ({
      programId: ix.programId,
      data: ix.data ?? "",
      accounts: (ix.accounts ?? []).length,
      parsedType: ix.parsed?.type,
    }),
  );

  // Inner instructions are where a program's CPI'd fee transfers show up.
  const inner = (transaction?.meta?.innerInstructions ?? []).flatMap((group) =>
    group.instructions.map((ix) => ({
      programId: ix.programId,
      data: ix.data ?? "",
      accounts: (ix.accounts ?? []).length,
      parsedType: ix.parsed?.type,
    })),
  );

  return { instructions, inner };
}

let examined = 0;
for (const { signature, err } of signatures) {
  if (examined >= 8) break;
  const transaction = await rpcCall("getTransaction", [
    signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
  ]);
  if (!transaction || err) continue;
  examined++;

  const { instructions, inner } = describe(transaction);
  const all = [...instructions, ...inner];
  const referral = all.filter((ix) => ix.programId === REFERRAL_PROGRAM_ID);
  if (referral.length === 0) continue;

  const signers = transaction.transaction.message.accountKeys
    .filter((k) => k.signer)
    .map((k) => `${k.pubkey.slice(0, 6)}…`)
    .join(", ");
  const failed = transaction.meta?.err ? " (failed)" : "";

  console.log(`${signature.slice(0, 12)}…${failed}  signers: ${signers}`);
  for (const ix of referral) {
    const bytes = base58Length(ix.data);
    const kind = ix.parsedType ? `${ix.parsedType} ` : "";
    console.log(
      `    ${kind}data ${bytes}B (${ix.data.slice(0, 20)}…)  accounts ${ix.accounts}`,
    );
  }
  // The SPL transfers running alongside it say who paid whom.
  for (const ix of all) {
    if (ix.programId === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" && ix.parsedType) {
      console.log(`    token: ${ix.parsedType}`);
    }
  }
  console.log("");
}

if (examined === 0) {
  console.log("No referral instructions examined — try a larger signature batch.");
}
