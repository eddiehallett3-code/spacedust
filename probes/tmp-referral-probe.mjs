/**
 * Temp probe: which fee parameter does Swap V2 `/build` actually honour?
 *
 * The question the design hangs on. The docs say the Referral Program is
 * required for Ultra and Trigger, and that Metis/Build takes `platformFeeBps` +
 * `feeAccount` instead — but our app calls `/swap/v2/build`, and the user has
 * just set up Referral Program accounts. If `/build` silently ignores
 * `referralAccount` + `referralFee`, the fee simply is not collected and nothing
 * anywhere says so. So: ask, and read the instructions that come back.
 *
 * Every request here is read-only — nothing is signed, nothing is sent.
 */
import { readFileSync, existsSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";

const env = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
const apiKey =
  (env.match(/^JUPITER_API_KEY=(.+)$/m)?.[1] ?? process.env.JUPITER_API_KEY ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");

const BASE = "https://api.jup.ag/swap/v2/build";
const SOL = "So11111111111111111111111111111111111111112";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

// A stand-in referral account. Deterministic, and the probe never needs it to
// exist on chain — Jupiter is stateless; we are only asking whether the field
// survives as far as the returned instructions.
const REFERRAL_ACCOUNT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const REFERRAL_PROGRAM_ID = "REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3";

// The documented derivation, so we can recognise the account in a response.
const [referralTokenAccount] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("referral_ata"),
    new PublicKey(REFERRAL_ACCOUNT).toBuffer(),
    new PublicKey(SOL).toBuffer(),
  ],
  new PublicKey(REFERRAL_PROGRAM_ID),
);

console.log(`referral account        ${REFERRAL_ACCOUNT}`);
console.log(`its referral token acct ${referralTokenAccount.toBase58()} (SOL)\n`);

/** Build one quote-style request and report what came back. */
async function probe(label, extraParams) {
  const query = new URLSearchParams({
    inputMint: BONK,
    outputMint: SOL,
    amount: "1000000",
    slippageBps: "100",
    taker: REFERRAL_ACCOUNT,
    ...extraParams,
  });
  const url = `${BASE}?${query.toString()}`;

  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    console.log(`${label}: request failed — ${error.message}\n`);
    return null;
  }

  const text = await response.text();
  if (!response.ok) {
    console.log(`${label}: HTTP ${response.status} — ${text.slice(0, 300)}\n`);
    return null;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.log(`${label}: non-JSON response\n`);
    return null;
  }

  const instructions = [
    ...(data.setupInstructions ?? []),
    data.swapInstruction,
    ...(data.otherInstructions ?? []),
    ...(data.cleanupInstruction ? [data.cleanupInstruction] : []),
  ].filter(Boolean);

  const accounts = instructions.flatMap((ix) =>
    (ix.accounts ?? []).map((a) => a.pubkey),
  );
  const programs = Array.from(
    new Set(instructions.map((ix) => ix.programId)),
  );

  console.log(`${label}`);
  console.log(`  platformFeeBps echoed : ${JSON.stringify(data.platformFeeBps)}`);
  console.log(`  route                : ${data.routePlan?.map((s) => s.swapInfo?.label).join(" → ")}`);
  console.log(`  instruction programs : ${programs.join(", ")}`);
  console.log(`  instruction accounts : ${accounts.length}`);
  console.log(
    `  carries referral acct: ${accounts.includes(REFERRAL_ACCOUNT)}`,
  );
  console.log(
    `  carries referral ata : ${accounts.includes(referralTokenAccount.toBase58())}`,
  );
  console.log("");
  return { data, accounts };
}

const control = await probe("A. control — no fee parameters", {});

await new Promise((r) => setTimeout(r, 1200));
const platform = await probe("B. platformFeeBps + feeAccount (what the app does now)", {
  platformFeeBps: "50",
  feeAccount: referralTokenAccount.toBase58(),
});

await new Promise((r) => setTimeout(r, 1200));
const referral = await probe("C. referralAccount + referralFee", {
  referralAccount: REFERRAL_ACCOUNT,
  referralFee: "50",
});

// The discriminator: if B or C added an account that the control did not carry,
// that parameter reached the instructions. If neither did, the fee is not being
// collected at all.
if (control) {
  const before = new Set(control.accounts);
  for (const [label, result] of [
    ["B (platformFeeBps)", platform],
    ["C (referralAccount)", referral],
  ]) {
    if (!result) continue;
    const added = result.accounts.filter((a) => !before.has(a));
    console.log(
      `${label}: ${added.length} account(s) not present in the control` +
        (added.length ? ` → ${added.join(", ")}` : ""),
    );
  }
}
