import fs from "node:fs";
import { createRequire } from "node:module";
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

/**
 * What a .sol domain's rent actually is, and what "closing" one really does.
 *
 * Two questions, and neither can be answered from the documentation alone:
 *
 *  1. **How much rent is in a name account?** SNS describes the name registry as
 *     a header plus *arbitrary data whose length is set at registration* — so
 *     unlike a token account, the deposit is not one number. Reading it per domain
 *     is the only way to price a reclaim honestly, which is the same rule this
 *     project has already had to learn twice (a hardcoded rent once made The
 *     Void's 1.5% charge 2.06%).
 *  2. **What does the delete instruction require?** SNS publishes the instruction
 *     and warns that deletion is irreversible, that subdomains and records go with
 *     it, and that the name returns to the open namespace for anyone to register.
 *     It does not say whether a *tokenized* domain must have its NFT burned first
 *     — which is a question only a simulation answers.
 *
 * The empty-token-account half of this tool needs no new measurement: that flow
 * already exists (`lib/solana/close-accounts.ts`) and its rules were settled
 * against mainnet by `probes/tmp-empty-accounts.mjs`.
 *
 * Usage: node probes/tmp-sol-rent-probe.mjs
 */

// The SNS SDK is CommonJS, so its named exports are not visible to Node's ESM
// interop. `createRequire` is how a probe reaches them — and the names are not
// the ones the published snippets use (`getSnsDomainKeySync`, not
// `getDomainKeySync`), which is worth knowing before writing any of this.
//
// This manual probe is the only thing that ever used the SNS SDK, and the app
// no longer deletes .sol names, so it is not a dependency. Install it ad hoc
// before running this file:
//   npm install --no-save @bonfida/spl-name-service
const require = createRequire(import.meta.url);
let sns;
try {
  sns = require("@bonfida/spl-name-service");
} catch {
  throw new Error(
    "Install the SNS SDK first: npm install --no-save @bonfida/spl-name-service",
  );
}

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/HELIUS_API_KEY=(.+)/)?.[1]?.trim();
const url = key
  ? `https://mainnet.helius-rpc.com/?api-key=${key}`
  : env.match(/NEXT_PUBLIC_FALLBACK_RPC_URL=(.+)/)?.[1]?.trim();
if (!url) throw new Error("no RPC url");

const connection = new Connection(url, "confirmed");
const report = (label, pass, detail = "") =>
  console.log(`${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);

/**
 * The owner stored in a name registry's header.
 *
 * Layout is parent(32) · owner(32) · class(32), then the domain's own data — so
 * the owner is bytes 32 to 64. Read by offset rather than through a deserialiser
 * because this probe must not depend on layout code passing it anything.
 */
function ownerOf(data) {
  if (!data || data.length < 64) return null;
  try {
    return new PublicKey(data.subarray(32, 64)).toBase58();
  } catch {
    return null;
  }
}

async function simulate(instructions, payer) {
  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const result = await connection.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  return {
    bytes: tx.serialize().length,
    err: result.value.err,
    cu: result.value.unitsConsumed,
  };
}

// ── 1. Find name accounts that exist, from the chain rather than by derivation ─
// Deriving an address is not the same as finding an account. Every well-known name
// tried by derivation (`bonfida.sol`, `solana.sol`, `toly.sol`, …) came back with
// no account at all, while `solana.sol` certainly exists — so the derived keys are
// wrong for SNS V2 and this asks the chain instead. `getAllSnsDomains` filters on
// the root parent, so everything it returns is a real, live name account.
console.log("=== live name accounts, straight from the chain ===");
const allDomains = await sns.getAllSnsDomains(connection);
console.log(`  getAllSnsDomains returned ${allDomains.length} accounts`);

const sample = [];
for (const entry of allDomains.slice(0, 40)) {
  const info = await connection.getAccountInfo(entry.pubkey);
  if (info) sample.push({ account: entry.pubkey, info });
}
console.log(`  ${sample.length} of the first 40 still exist on chain`);

let knownKey = null;
let knownInfo = null;
let knownOwner = null;

for (const { account, info } of sample.slice(0, 5)) {
  const owner = ownerOf(info.data);
  console.log(
    `    ${account.toBase58()}  ${String(info.data.length).padStart(6)} bytes  ${String(info.lamports).padStart(9)} lamports  owner ${owner?.slice(0, 6) ?? "?"}…`,
  );
  if (knownInfo === null) {
    knownKey = account;
    knownInfo = info;
    knownOwner = owner;
  }
}

if (knownInfo === null) {
  throw new Error("no live name account found — nothing to measure");
}

const reverseKey = sns.getReverseKeySync(knownKey.toBase58());
const reverseInfo = await connection.getAccountInfo(reverseKey);
// `getDomainMint` takes the *name account* and derives the tokenizer's mint for
// it — an address that exists only if this domain has been wrapped as an NFT.
const domainMint = sns.getDomainMint(knownKey);
const mintInfo = await connection.getAccountInfo(domainMint);

console.log(`\n=== the first one, read properly ===`);
report(
  "owned by the SNS program",
  knownInfo.owner.toBase58() === sns.NAME_PROGRAM_ID.toBase58(),
  knownInfo.owner.toBase58(),
);
console.log(`  name account    ${knownKey.toBase58()}`);
console.log(`  data length     ${knownInfo.data.length} bytes`);
console.log(`  rent held       ${knownInfo.lamports} lamports`);
console.log(`  owner           ${knownOwner ?? "—"}`);
console.log(
  `  reverse lookup  ${reverseKey.toBase58()} — ${reverseInfo?.lamports ?? 0} lamports`,
);
console.log(
  `  tokenized       ${mintInfo ? `yes — mint ${domainMint.toBase58()}` : "no (no tokenizer mint)"}`,
);

// ── 2. The delete instruction, simulated ────────────────────────────────────
// Refund target = the owner, as SNS's own example does. Nothing is signed and
// nothing is sent: `sigVerify: false` treats the owner's slot as signed.
if (knownInfo && knownOwner) {
  const owner = new PublicKey(knownOwner);
  const result = await simulate(
    [sns.deleteInstruction(sns.NAME_PROGRAM_ID, knownKey, owner, owner)],
    owner,
  );
  console.log(`\n=== deleting it, simulated ===`);
  report(
    "deleteInstruction simulates clean",
    result.err === null,
    `${result.bytes} bytes, ${result.cu ?? "?"} CU`,
  );
  if (result.err) console.log(`    err: ${JSON.stringify(result.err)}`);
  console.log(
    `  the refund is the name account's own rent: ${knownInfo.lamports} lamports`,
  );
  console.log(
    "  and SNS's own warning applies: the name returns to the open namespace for anyone to take.",
  );

  // ── 3. The listing path, and whether the rent varies per domain ──────────
  console.log(`\n=== the domains that wallet owns ===`);
  const domains = await sns.getSnsDomainsForOwner(connection, owner);
  console.log(`  ${domains.length} domain(s) for ${knownOwner}`);
  // The listing returns objects, not names — and deriving the name account from a
  // name string is what produced "no account" for domains that plainly exist, so
  // the keys it hands back are used directly instead.
  console.log(`  entry shape: ${JSON.stringify(domains[0])?.slice(0, 120)}`);
  for (const entry of domains.slice(0, 12)) {
    const key = entry.account ?? entry.key ?? entry.domain ?? entry;
    const info = await connection.getAccountInfo(key);
    const tokenized = (await connection.getAccountInfo(sns.getDomainMint(key))) !== null;
    console.log(
      `    ${key.toBase58()}  ${String(info?.data.length ?? 0).padStart(6)} bytes  ${String(info?.lamports ?? 0).padStart(9)} lamports${tokenized ? "  tokenized" : ""}`,
    );
  }
  console.log(
    "  (the byte column is the point: the deposit is set by the name's length at registration, so it is not one number)",
  );

  // ── 4. A tokenized domain: does its NFT have to be burned first? ─────────
  const tokenized = [];
  for (const entry of domains) {
    const key = entry.account ?? entry.key ?? entry.domain ?? entry;
    if ((await connection.getAccountInfo(sns.getDomainMint(key))) !== null) {
      tokenized.push({ key, mint: sns.getDomainMint(key) });
    }
  }

  console.log(`\n=== deleting a tokenized domain ===`);
  if (tokenized.length === 0) {
    console.log("  none of this wallet's domains is tokenized, so unmeasured");
  } else {
    const subject = tokenized[0];
    const info = await connection.getAccountInfo(subject.key);
    const result = await simulate(
      [
        sns.deleteInstruction(
          sns.NAME_PROGRAM_ID,
          subject.key,
          owner,
          owner,
        ),
      ],
      owner,
    );
    report(
      `${subject.key.toBase58()}`,
      result.err === null,
      `rent ${info?.lamports ?? 0} lamports, ${result.cu ?? "?"} CU`,
    );
    if (result.err) {
      console.log(
        `    err: ${JSON.stringify(result.err)} — the tokenized NFT must be dealt with first`,
      );
    }
  }
}

