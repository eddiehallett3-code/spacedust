import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import fs from "node:fs";

/**
 * Temp probe: can a real, already-empty token account actually be closed?
 *
 * Neither scanner in this app returns a zero-balance holding — both drop
 * `amount === "0"` — so these accounts are invisible today and their rent is
 * unreachable. This probe finds real ones on mainnet and answers the questions
 * that decide whether a "reclaim rent" flow can promise anything:
 *
 *   1. Does a plain empty account close? (the happy path)
 *   2. Does a **frozen** empty account close? The Void found that a frozen
 *      account rejects `Revoke` with `Custom: 17`; close may behave differently.
 *   3. Does an account with a **live delegate**, or a **foreign close
 *      authority**, still close when the *owner* signs? We always pass the owner
 *      as the authority.
 *   4. Does a Token-2022 account with a **withheld transfer fee** close? If it
 *      does not, those rows must be excluded rather than promised.
 *
 * Each is answered by building the exact instruction shape the app builds and
 * simulating it with `sigVerify: false` — the same gate the app applies before
 * offering to sign.
 */

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/HELIUS_API_KEY=(.+)/)?.[1]?.trim();
const fallback = env.match(/NEXT_PUBLIC_FALLBACK_RPC_URL=(.+)/)?.[1]?.trim();
const url = key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : fallback;
const payerAddress = env.match(/FEE_WALLET=(.+)/)?.[1]?.trim();
if (!url || !payerAddress) throw new Error("missing env");

const connection = new Connection(url, "confirmed");
const LEGACY = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

async function rpc(method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

/**
 * SPL token account layout — identical for Token and Token-2022, before
 * extensions:
 *
 *   mint 0·32 · owner 32·64 · amount 64·72 (u64 LE) · delegate COption 72·108
 *   state 108 · isNative COption 109·121 · delegatedAmount 121·129
 *   closeAuthority COption 129·165
 *
 * State byte: 0 uninitialized, 1 initialized, 2 frozen.
 */
const OFF_AMOUNT = 64;
const OFF_STATE = 108;

const ZERO_U64 = bs58.encode(new Uint8Array(8));

/** The COption tag for "some" on a delegate / close-authority field. */
const COPTION_SOME = bs58.encode(new Uint8Array([1, 0, 0, 0]));
const OFF_DELEGATE_TAG = 72;
const OFF_CLOSE_AUTH_TAG = 129;

/**
 * Page through empty (amount === 0) accounts for one program, in one state.
 *
 * `extra` adds a memcmp filter (used to hunt specific shapes — a live delegate,
 * a set close authority). `keep` filters the page client-side, which is the only
 * way to find a *withheld transfer fee*: that amount lives in an extension whose
 * offset depends on which extensions precede it, so it cannot be matched with a
 * memcmp.
 */
async function findEmpty(programId, state, { extra = [], pages = 1, keep } = {}) {
  const found = [];
  let paginationKey;

  for (let page = 0; page < pages; page += 1) {
    const result = await rpc("getProgramAccountsV2", [
      programId,
      {
        encoding: "jsonParsed",
        limit: 100,
        ...(paginationKey ? { paginationKey } : {}),
        filters: [
          { memcmp: { offset: OFF_AMOUNT, bytes: ZERO_U64 } },
          {
            memcmp: {
              offset: OFF_STATE,
              bytes: bs58.encode(new Uint8Array([state])),
            },
          },
          ...extra,
        ],
      },
    ]);

    const hits = Array.isArray(result) ? result : (result.accounts ?? []);
    paginationKey = Array.isArray(result) ? null : result.paginationKey;

    for (const hit of hits) {
      const account = {
        address: hit.pubkey,
        lamports: hit.account?.lamports ?? 0,
        programId,
        ...(hit.account?.data?.parsed?.info ?? {}),
      };
      if (!keep || keep(account)) found.push(account);
    }

    if (!paginationKey || hits.length === 0) break;
  }

  return found;
}

/** Build + simulate `closeAccount`, exactly as the app does. */
async function simulateClose(account) {
  const tokenAccount = new PublicKey(account.address);
  const owner = new PublicKey(account.owner);
  const program = new PublicKey(account.programId);

  // Index 9 on both programs; keys are [account (w), owner (w), owner (signer)]
  // — the same shape `lib/solana/instructions.ts` builds by hand.
  const instruction = {
    programId: program,
    keys: [
      { pubkey: tokenAccount, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([9]),
  };

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: new PublicKey(payerAddress),
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      instruction,
    ],
  }).compileToV0Message();

  const simulation = await connection.simulateTransaction(
    new VersionedTransaction(message),
    { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" },
  );

  return {
    err: simulation.value.err,
    units: simulation.value.unitsConsumed,
    logs: (simulation.value.logs ?? []).slice(-3),
  };
}

/** Print one bucket: what these accounts are, and whether closing works. */
async function report(label, accounts, pick) {
  console.log(`\n${"─".repeat(72)}\n${label} — ${accounts.length} found\n`);
  if (accounts.length === 0) {
    console.log("  none found in this page");
    return;
  }

  const chosen = (pick ? accounts.find(pick) : null) ?? accounts[0];
  const extensions = chosen.extensions
    ?.map((e) => e.extension)
    .filter(Boolean)
    .join(", ");

  console.log("  account       :", chosen.address);
  console.log("  owner         :", chosen.owner);
  console.log(
    "  lamports      :",
    chosen.lamports,
    `(${(chosen.lamports / 1e9).toFixed(8)} SOL)`,
  );
  console.log("  amount        :", chosen.tokenAmount?.amount ?? "0");
  console.log("  state         :", chosen.state);
  console.log("  delegate      :", chosen.delegate ?? "none");
  console.log("  closeAuthority:", chosen.closeAuthority ?? "none");
  console.log("  isNative      :", chosen.isNative ?? false);
  console.log("  extensions    :", extensions || "none");

  const withheld = chosen.extensions?.find(
    (e) => e.extension === "transferFeeAmount",
  )?.state?.withheldAmount;
  if (withheld != null) console.log("  withheldFee   :", withheld);

  const result = await simulateClose(chosen);
  console.log("  → simulation  :", result.err ?? "null (would succeed)");
  console.log("  → units       :", result.units);
  for (const line of result.logs) console.log("   ", line);
}

const legacyEmpty = await findEmpty(LEGACY, 1);
const legacyFrozen = await findEmpty(LEGACY, 2);
const legacyDelegated = await findEmpty(LEGACY, 1, {
  extra: [{ memcmp: { offset: OFF_DELEGATE_TAG, bytes: COPTION_SOME } }],
  // A delegate must be the *only* variable. An empty delegated account that also
  // has a foreign close authority fails for that reason instead, which would
  // answer the wrong question.
  keep: (a) => a.delegate && (!a.closeAuthority || a.closeAuthority === a.owner),
});
const legacyForeignClose = await findEmpty(LEGACY, 1, {
  extra: [{ memcmp: { offset: OFF_CLOSE_AUTH_TAG, bytes: COPTION_SOME } }],
  // Only the ones where the close authority is somebody *else*. When it is the
  // owner, closing is indistinguishable from the plain case.
  keep: (a) => a.closeAuthority && a.closeAuthority !== a.owner,
});
const t22Empty = await findEmpty(TOKEN_2022, 1);
const t22Frozen = await findEmpty(TOKEN_2022, 2, { pages: 12 });
const t22ForeignClose = await findEmpty(TOKEN_2022, 1, {
  extra: [{ memcmp: { offset: OFF_CLOSE_AUTH_TAG, bytes: COPTION_SOME } }],
  keep: (a) => a.closeAuthority && a.closeAuthority !== a.owner,
});
const t22Withheld = await findEmpty(TOKEN_2022, 1, {
  pages: 4,
  keep: (a) => {
    const withheld = a.extensions?.find(
      (e) => e.extension === "transferFeeAmount",
    )?.state?.withheldAmount;
    // Same isolation rule as the delegate bucket: the withheld amount has to be
    // the only thing that could make the close fail.
    const authorityIsOurs = !a.closeAuthority || a.closeAuthority === a.owner;
    // `withheldAmount` parses as a *number*, not a string — comparing it to "0"
    // filters nothing at all, which is how the first run of this probe ended up
    // reporting a withheld fee of zero as if it were the interesting case.
    return Number(withheld) > 0 && authorityIsOurs;
  },
});

console.log("\nfound:");
console.log("  legacy  empty            :", legacyEmpty.length);
console.log("  legacy  frozen           :", legacyFrozen.length);
console.log("  legacy  delegated        :", legacyDelegated.length);
console.log("  legacy  foreign close    :", legacyForeignClose.length);
console.log("  t22     empty            :", t22Empty.length);
console.log("  t22     frozen           :", t22Frozen.length);
console.log("  t22     foreign close    :", t22ForeignClose.length);
console.log("  t22     withheld fee > 0 :", t22Withheld.length);

await report("LEGACY · empty, initialized", legacyEmpty);
await report("LEGACY · frozen", legacyFrozen);
await report("LEGACY · live delegate", legacyDelegated);
await report("LEGACY · foreign close authority", legacyForeignClose);
await report("TOKEN-2022 · empty, initialized", t22Empty);
await report("TOKEN-2022 · frozen", t22Frozen);
await report("TOKEN-2022 · foreign close authority", t22ForeignClose);
await report("TOKEN-2022 · withheld transfer fee > 0", t22Withheld);

