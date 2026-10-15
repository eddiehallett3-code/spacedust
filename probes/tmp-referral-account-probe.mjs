/**
 * Temp probe: prove the referral token account derivation, and find *our*
 * referral account.
 *
 * Two questions, both answerable only from chain:
 *
 *   A. Is a referral token account really `ATA(referralAccount, mint)`? If so it
 *      can be derived from one configured address instead of three hand-kept
 *      ones. Checked against the accounts of real `claim_v2` instructions, whose
 *      Anchor account order is fixed in the program source: payer, project,
 *      admin, projectAdminAta, referralAccount, referralTokenAccount, partner,
 *      partnerAta, mint, system, token, ataProgram.
 *
 *   B. Which referral account belongs to us? The program's own `ReferralAccount`
 *      struct puts `partner` at offset 8, so `getProgramAccounts` can be filtered
 *      by the partner wallet. That also yields the real `share_bps` instead of an
 *      assumed 80/20 split, plus a check that the three token accounts we would
 *      pay fees into actually exist.
 *
 * Read-only: no keypair, no signing, no sending.
 */
import { readFileSync, existsSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const env = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
const pick = (name) =>
  ((env.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1] ?? "") ||
    process.env[name] ||
    ""
  )
    .trim()
    .replace(/^["']|["']$/g, "");

const helius = pick("HELIUS_API_KEY");
const rpc = helius
  ? `https://mainnet.helius-rpc.com/?api-key=${helius}`
  : pick("NEXT_PUBLIC_FALLBACK_RPC_URL");
if (!rpc) throw new Error("no RPC endpoint in .env.local");

const FEE_WALLET = pick("NEXT_PUBLIC_FEE_WALLET");
const REFERRAL_PROGRAM_ID = "REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

let id = 0;
async function rpcCall(method, params) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/** ATA of a (possibly off-curve) authority, for both token programs. */
function ataFor(authority, mint) {
  const owner = new PublicKey(authority);
  return {
    legacy: getAssociatedTokenAddressSync(
      new PublicKey(mint),
      owner,
      true,
      new PublicKey(TOKEN_PROGRAM_ID),
    ).toBase58(),
    token2022: getAssociatedTokenAddressSync(
      new PublicKey(mint),
      owner,
      true,
      new PublicKey(TOKEN_2022_PROGRAM_ID),
    ).toBase58(),
  };
}

console.log("── A. is a referral token account the ATA of the referral account? ──\n");

const signatures = await rpcCall("getSignaturesForAddress", [
  REFERRAL_PROGRAM_ID,
  { limit: 40 },
]);

let checked = 0;
for (const { signature, err } of signatures) {
  if (checked >= 4) break;
  const transaction = await rpcCall("getTransaction", [
    signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
  ]);
  if (!transaction || err) continue;

  const instructions = [
    ...(transaction.transaction.message.instructions ?? []),
    ...(transaction.meta?.innerInstructions ?? []).flatMap((g) => g.instructions),
  ].filter((ix) => ix.programId === REFERRAL_PROGRAM_ID);

  for (const instruction of instructions) {
    // claim_v2 only — the account order used below is that instruction's.
    if (!instruction.data?.startsWith("fMtfDSsYr9f")) continue;
    const keys = (instruction.accounts ?? []).map((a) =>
      typeof a === "string" ? a : a.pubkey,
    );
    if (keys.length !== 12) continue;
    checked++;

    const [, , , , referralAccount, referralTokenAccount, , , mint] = keys;
    const derived = ataFor(referralAccount, mint);
    const matchesLegacy = derived.legacy === referralTokenAccount;
    const matches2022 = derived.token2022 === referralTokenAccount;

    console.log(`${signature.slice(0, 12)}…  mint ${mint.slice(0, 6)}…`);
    console.log(`  referral account       ${referralAccount}`);
    console.log(`  referral token account ${referralTokenAccount}`);
    console.log(`  ATA(referral, mint)    ${derived.legacy}`);
    console.log(
      `  => ${
        matchesLegacy
          ? "MATCH (legacy token program)"
          : matches2022
            ? "MATCH (token-2022)"
            : "NO MATCH — derivation differs"
      }\n`,
    );
  }
}

if (checked === 0) console.log("No claim_v2 instruction in the sample.\n");

console.log("── B. our referral account, found by partner wallet ──\n");
console.log(`fee wallet (partner candidate): ${FEE_WALLET || "(not set)"}`);

if (FEE_WALLET) {
  const accounts = await rpcCall("getProgramAccounts", [
    REFERRAL_PROGRAM_ID,
    {
      encoding: "base64",
      commitment: "confirmed",
      // `partner: Pubkey` is the first field after the 8-byte discriminator.
      filters: [{ memcmp: { offset: 8, bytes: FEE_WALLET } }],
    },
  ]);

  console.log(`referral accounts with this partner: ${accounts.length}\n`);

  for (const { pubkey, account } of accounts) {
    const data = Buffer.from(account.data[0], "base64");
    const partner = new PublicKey(data.subarray(8, 40)).toBase58();
    const project = new PublicKey(data.subarray(40, 72)).toBase58();
    const shareBps = data.readUInt16LE(72);
    // Option<String>: 1-byte tag, then a u32 length and the bytes when Some.
    const hasName = data[74] === 1;
    const nameLength = hasName ? data.readUInt32LE(75) : 0;
    const name = hasName
      ? data.subarray(79, 79 + nameLength).toString("utf8")
      : "(none)";

    console.log(`referral account   ${pubkey}`);
    console.log(`  data length      ${data.length} bytes`);
    console.log(`  partner          ${partner}`);
    console.log(`  project          ${project}`);
    console.log(`  name             ${name}`);
    console.log(
      `  share_bps        ${shareBps} => ${(shareBps / 100).toFixed(2)}% to partner, ${((10_000 - shareBps) / 100).toFixed(2)}% to project admin`,
    );

    const derived = [
      ["SOL ", SOL],
      ["USDC", USDC],
      ["JUP ", JUP],
    ].map(([symbol, mint]) => ({ symbol, mint, ...ataFor(pubkey, mint) }));
    const existence = await rpcCall("getMultipleAccounts", [
      derived.map((d) => d.legacy),
      { encoding: "base64", commitment: "confirmed" },
    ]);
    derived.forEach((d, index) => {
      console.log(
        `  ${d.symbol} fee account  ${d.legacy}  ${
          existence.value[index] ? "EXISTS" : "missing"
        }`,
      );
    });
    console.log("");
  }
}

