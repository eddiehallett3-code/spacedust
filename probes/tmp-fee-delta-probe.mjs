/**
 * Temp probe: does `platformFeeBps` actually reduce what the user receives?
 *
 * Ask Jupiter for the same swap twice — once with no fee, once with a 0.5% fee
 * pointed at a real token account — and compare the quoted output. If the fee is
 * real, the quoted `outAmount` should drop by roughly 50 bps; if Jupiter ignores
 * the parameter, the two quotes will be identical and the app's "0.5% fee" copy
 * would be a claim it cannot back.
 *
 * The fee account deliberately has no relationship to the swap: it only needs to
 * exist on chain. Quoting is read-only — nothing is signed or sent.
 */
import { readFileSync, existsSync } from "node:fs";

const env = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
const apiKey = (env.match(/^JUPITER_API_KEY=(.+)$/m)?.[1] ?? "")
  .trim()
  .replace(/^["']|["']$/g, "");

const BASE = "https://api.jup.ag/swap/v2/build";
const SOL = "So11111111111111111111111111111111111111112";
// The probe's own wallet, so the fee account is a real, existing token account.
// Any valid token account would do — that is the point of the parameter.
const TAKER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
// A known, high-liquidity input so the route is deterministic between calls.
const INPUT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"; // BONK
const AMOUNT = "10000000000"; // 10,000 BONK — large enough that 50 bps is visible

async function quote(label, feeAccount) {
  const query = new URLSearchParams({
    inputMint: INPUT,
    outputMint: SOL,
    amount: AMOUNT,
    slippageBps: "50",
    taker: TAKER,
    maxAccounts: "32",
  });
  if (feeAccount) {
    query.set("platformFeeBps", "50");
    query.set("feeAccount", feeAccount);
  }

  const response = await fetch(`${BASE}?${query.toString()}`, {
    headers: {
      Accept: "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    console.log(`${label}: HTTP ${response.status} — ${text.slice(0, 200)}`);
    return null;
  }
  const data = JSON.parse(text);
  const out = Number(data.outputAmount ?? data.outAmount ?? 0);
  console.log(
    `${label}: outAmount ${out.toLocaleString()}  threshold ${Number(
      data.otherAmountThreshold ?? 0,
    ).toLocaleString()}  feeBps echoed ${JSON.stringify(data.platformFeeBps)}`,
  );
  return out;
}

const feeAccount = process.argv[2];
if (!feeAccount) {
  console.error("usage: node probes/tmp-fee-delta-probe.mjs <existing token account>");
  process.exit(1);
}

const withoutFee = await quote("no fee       ", null);
await new Promise((r) => setTimeout(r, 1500));
const withFee = await quote("platformFeeBps", feeAccount);

if (withoutFee && withFee) {
  const delta = withoutFee - withFee;
  const bps = (delta / withoutFee) * 10_000;
  console.log(
    `\nfee actually taken: ${delta.toLocaleString()} lamports of ${withoutFee.toLocaleString()} = ${bps.toFixed(2)} bps`,
  );
}
