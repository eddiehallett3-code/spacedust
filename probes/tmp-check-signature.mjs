/**
 * One-off: what actually happened to a specific signature, and when.
 *
 * Asked through the app's own RPC proxy, so it uses the same path the browser
 * does. Prints the slot, block time, error, and the instruction list — enough to
 * tell "landed" from "never landed", and to compare the landing slot against the
 * blockhash the batch was built with.
 */

const SIGNATURE =
  "3Bwppb9v3PxCZfgeiU3pKDUUxB2KzPHjMEtDMU9P3ydG9XTuKkJHyhNmtM9yZRRkjQcW2HHRtij3kAEScB2jCdcL";

const ENDPOINT = process.env.RPC_PROXY ?? "http://localhost:3000/api/rpc";

async function rpc(method, params) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status} ${text.slice(0, 200)}`);
  const parsed = JSON.parse(text);
  if (parsed.error) throw new Error(`${method}: ${JSON.stringify(parsed.error)}`);
  return parsed.result;
}

const height = await rpc("getBlockHeight", [{ commitment: "confirmed" }]);
console.log("current block height:", height);

const status = await rpc("getSignatureStatuses", [
  [SIGNATURE],
  { searchTransactionHistory: true },
]);
console.log("status:", JSON.stringify(status.value[0]));

const tx = await rpc("getTransaction", [
  SIGNATURE,
  {
    encoding: "jsonParsed",
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  },
]);

if (!tx) {
  console.log("getTransaction: NOT FOUND (may be older than the RPC's history)");
} else {
  console.log("slot:", tx.slot, "| blockTime:", tx.blockTime);
  console.log("err:", JSON.stringify(tx.meta?.err));
  console.log("fee:", tx.meta?.fee);
  const instructions = tx.transaction.message.instructions ?? [];
  console.log("instructions:", instructions.length);
  for (const ix of instructions) {
    const detail =
      ix.parsed?.type ??
      ix.parsed?.info?.instruction ??
      (ix.data ? `data:${String(ix.data).slice(0, 12)}` : "?");
    console.log("   -", ix.programId, detail);
  }
  const keys = tx.transaction.message.accountKeys ?? [];
  console.log("accounts and lamport deltas:");
  keys.forEach((key, index) => {
    const before = tx.meta?.preBalances?.[index] ?? 0;
    const after = tx.meta?.postBalances?.[index] ?? 0;
    const delta = after - before;
    if (delta !== 0) {
      console.log(
        `   ${key.pubkey ?? key} ${delta > 0 ? "+" : ""}${delta} lamports`,
      );
    }
  });
}
