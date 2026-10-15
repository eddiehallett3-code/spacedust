import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "node:fs";

/**
 * Temp probe: does `getParsedTokenAccountsByOwner` actually expose `delegate`?
 *
 * Helius refuses a whole-program `getProgramAccounts` on the legacy token
 * program (millions of accounts), so this uses `getProgramAccountsV2` with a
 * small page to find real delegated accounts, then runs the exact call the
 * approvals feature uses and prints what comes back.
 */

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/HELIUS_API_KEY=(.+)/)?.[1]?.trim();
const fallback = env.match(/NEXT_PUBLIC_FALLBACK_RPC_URL=(.+)/)?.[1]?.trim();
const url = key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : fallback;
if (!url) throw new Error("no RPC url");

const connection = new Connection(url, "confirmed");
const PROGRAMS = [
  ["legacy", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"],
  ["token-2022", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"],
];

const DELEGATE_OFFSET = 72;
const delegationFilter = {
  memcmp: {
    offset: DELEGATE_OFFSET,
    bytes: bs58.encode(new Uint8Array([1, 0, 0, 0])),
  },
};

/** One page of delegated accounts, whichever RPC shape this endpoint wants. */
async function findDelegated(programId) {
  const filters = [{ dataSize: 165 }, delegationFilter];

  const shapes = [
    () =>
      rpc("getProgramAccountsV2", [
        { programId, filters, encoding: "jsonParsed", limit: 5 },
      ]),
    () =>
      rpc("getProgramAccountsV2", [
        programId,
        { filters, encoding: "jsonParsed", limit: 5 },
      ]),
    () =>
      rpc("getProgramAccounts", [
        programId,
        { filters, encoding: "jsonParsed" },
      ]),
  ];

  let lastError;
  for (const shape of shapes) {
    try {
      const result = await shape();
      const list = Array.isArray(result) ? result : (result?.accounts ?? []);
      return list;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function rpc(method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${body.error.message}`);
  return body.result;
}

for (const [label, programId] of PROGRAMS) {
  let accounts;
  try {
    accounts = await findDelegated(programId);
  } catch (error) {
    console.log(`\n=== ${label}: could not list (${error.message.slice(0, 90)})`);
    continue;
  }

  console.log(`\n=== ${label}: ${accounts.length} delegated accounts found ===`);

  for (const acc of accounts.slice(0, 4)) {
    const info = acc.account?.data?.parsed?.info;
    console.log(
      " ",
      acc.pubkey.slice(0, 8),
      "owner:", info?.owner?.slice(0, 8),
      "delegate:", info?.delegate?.slice(0, 8),
      "delegatedAmount:", info?.delegatedAmount?.amount,
      "balance:", info?.tokenAmount?.amount,
      "state:", info?.state,
    );
  }

  if (accounts.length === 0) continue;

  // The exact path the feature takes, for the owner of the first hit.
  const owner = new PublicKey(accounts[0].account.data.parsed.info.owner);
  const response = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: new PublicKey(programId),
  });
  const delegated = response.value.filter(
    (entry) => entry.account.data?.parsed?.info?.delegate,
  );
  console.log(
    `  getParsedTokenAccountsByOwner -> ${response.value.length} accounts, ${delegated.length} with a delegate`,
  );
  for (const entry of delegated.slice(0, 3)) {
    const i = entry.account.data.parsed.info;
    console.log(
      "   ->",
      entry.pubkey.toBase58().slice(0, 8),
      "mint:", i.mint.slice(0, 8),
      "delegate:", i.delegate.slice(0, 8),
      "delegatedAmount:", i.delegatedAmount?.amount,
    );
  }
}
