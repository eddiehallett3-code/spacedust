import fs from "node:fs";
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

/**
 * What a Payload send actually costs, measured rather than assumed.
 *
 * A "batch send" is a claim about four things, and none of them can be read off
 * documentation:
 *
 *  1. that a transfer, an idempotent recipient-account create and the source
 *     account's close can live in **one** transaction — which is what makes the
 *     rent reclaim part of the send rather than a second approval;
 *  2. how many bytes one unit takes, and therefore how many ride together under
 *     the 1232-byte cap;
 *  3. what the recipient's account costs the *sender* when it has to be created,
 *     since that is a real cost a preview has to show;
 *  4. which accounts the token program refuses to move at all.
 *
 * Sizes come from serialising real messages, signature slots included.
 * Correctness comes from simulating with `sigVerify: false`, which the runtime
 * treats as "every required signer signed" — so an owner-gated transfer can be
 * exercised without holding anyone's key.
 *
 * The size ladder deliberately repeats one unit: it measures bytes, not
 * validity, and inventing twenty distinct holdings to count bytes would prove
 * nothing extra. The simulations are the correctness evidence, one scenario at a
 * time.
 *
 * Usage: node probes/tmp-payload-transfer-probe.mjs [wallet]
 */

const MAX_TX_SIZE = 1232;

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/HELIUS_API_KEY=(.+)/)?.[1]?.trim();
const url = key
  ? `https://mainnet.helius-rpc.com/?api-key=${key}`
  : env.match(/NEXT_PUBLIC_FALLBACK_RPC_URL=(.+)/)?.[1]?.trim();
if (!url) throw new Error("no RPC url");

const OWNER = process.argv[2] ?? "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
/**
 * A recipient that is deliberately *not* the wallet being measured.
 *
 * The configured fee wallet is not used: in this environment it is set to the
 * operator's own wallet, which turned every "send" into a self-send. That is a
 * real finding rather than a nuisance — a self-send cannot close the account it
 * never emptied, measured as `Custom: 11` (NonNativeHasBalance) — so it gets its
 * own scenario below instead of being the default here.
 */
const RECIPIENT = process.argv[3] ?? "1nc1nerator11111111111111111111111111111111";

const connection = new Connection(url, "confirmed");
const owner = new PublicKey(OWNER);
const recipient = new PublicKey(RECIPIENT);

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/** Build a v0 message and simulate it unsigned, reporting its real size. */
async function simulate(instructions, label, payer = owner) {
  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const bytes = new VersionedTransaction(message).serialize().length;

  const result = await connection.simulateTransaction(
    new VersionedTransaction(message),
    { sigVerify: false, replaceRecentBlockhash: true },
  );

  return { label, bytes, err: result.value.err, cu: result.value.unitsConsumed };
}

/**
 * One send unit: create the recipient's account if missing, transfer, close.
 *
 * All three in one message is the whole point — the close is only valid *after*
 * the transfer has emptied the source, and paying a second signature for it
 * would make the reclaim not worth claiming.
 *
 * `create`, `payer` and `recipientOwner` are parameters because the only way to
 * price the account create is to build the same message without it. The first
 * version of this probe always included it, so "the create costs 0 bytes" was
 * the difference between two identical messages.
 */
function sendUnit({
  mint,
  source,
  decimals,
  amount,
  programId,
  recipientAta,
  close,
  create = true,
  payer = owner,
  recipientOwner = recipient,
}) {
  const mintKey = new PublicKey(mint);
  const instructions = [];

  if (create) {
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        recipientAta,
        recipientOwner,
        mintKey,
        programId,
      ),
    );
  }

  instructions.push(
    createTransferCheckedInstruction(
      source,
      mintKey,
      recipientAta,
      payer,
      amount,
      decimals,
      [],
      programId,
    ),
  );

  if (close) {
    instructions.push(
      createCloseAccountInstruction(source, payer, payer, [], programId),
    );
  }

  return instructions;
}

const tokenProgramOf = (programId) =>
  programId === TOKEN_2022_PROGRAM_ID.toBase58()
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;

const report = (label, pass, detail = "") =>
  console.log(`${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);

console.log(`wallet:    ${OWNER}`);
console.log(`recipient: ${RECIPIENT}`);

/** Every fungible the wallet holds, from both token programs. */
async function fungibles() {
  const found = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const response = await connection.getParsedTokenAccountsByOwner(owner, {
        programId,
      });
      for (const { pubkey, account } of response.value) {
        const info = account.data.parsed.info;
        found.push({
          tokenAccount: pubkey,
          mint: info.mint,
          decimals: info.tokenAmount.decimals,
          amount: BigInt(info.tokenAmount.amount),
          state: info.state,
          programId,
        });
      }
    } catch (error) {
      console.log(`  (could not list one token program: ${error.message})`);
    }
  }
  return found;
}

/** Uncompressed SPL-backed NFTs, with the token account DAS actually fills. */
async function nfts() {
  const result = await rpc("getAssetsByOwner", {
    ownerAddress: OWNER,
    page: 1,
    limit: 1000,
    options: { showFungible: false, showZeroBalance: false },
  });
  return (result.items ?? []).filter(
    (item) =>
      !item.compression?.compressed &&
      ["V1_NFT", "LEGACY_NFT"].includes(item.interface) &&
      item.token_info?.associated_token_address,
  );
}

const holdings = await fungibles();
const nftHoldings = await nfts();
console.log(
  `\nholdings: ${holdings.length} fungible accounts, ${nftHoldings.length} uncompressed NFTs`,
);

const liquid = holdings.filter((h) => h.amount > 0n && h.state === "initialized");

console.log("\n=== the unit a Payload send is made of ===");
if (liquid.length === 0) {
  console.log("  no funded, unfrozen token account here — nothing to measure");
} else {
  const token = liquid[0];
  const programId = tokenProgramOf(token.programId.toBase58());
  const mint = new PublicKey(token.mint);
  const freshAta = getAssociatedTokenAddressSync(mint, recipient, true, programId);
  const ownAta = getAssociatedTokenAddressSync(mint, owner, true, programId);
  const base = {
    mint: token.mint,
    source: token.tokenAccount,
    decimals: token.decimals,
    amount: token.amount,
    programId,
  };

  const withClose = await simulate(
    sendUnit({ ...base, recipientAta: freshAta, close: true }),
    "create + transfer + close, to a wallet with no account for it",
  );
  report(
    withClose.label,
    withClose.err === null,
    `${withClose.bytes} bytes, ${withClose.cu ?? "?"} CU`,
  );
  if (withClose.err) console.log(`    err: ${JSON.stringify(withClose.err)}`);

  const noCreate = await simulate(
    sendUnit({ ...base, recipientAta: freshAta, close: true, create: false }),
    "transfer + close, when the recipient's account already exists",
  );
  console.log(
    `  (size only — without the create there is no account at the destination, so this arm is meant to fail: ${JSON.stringify(noCreate.err)})`,
  );

  const noClose = await simulate(
    sendUnit({ ...base, recipientAta: freshAta, close: false }),
    "create + transfer, no close (rent left behind)",
  );
  report(
    noClose.label,
    noClose.err === null,
    `${noClose.bytes} bytes, ${noClose.cu ?? "?"} CU`,
  );

  console.log(
    `  the account create costs ${withClose.bytes - noCreate.bytes} bytes; the close ${withClose.bytes - noClose.bytes}`,
  );

  // The rule this probe found the hard way, when the fee wallet in .env.local
  // turned out to be the operator's own address.
  const selfSend = await simulate(
    sendUnit({ ...base, recipientAta: ownAta, close: true, recipientOwner: owner }),
    "sending to your own wallet",
  );
  console.log(
    `  self-send: ${JSON.stringify(selfSend.err)} — the balance never leaves the account, so the close has nothing to close`,
  );

  const sourceInfo = await connection.getAccountInfo(token.tokenAccount);
  const ataRent = await connection.getMinimumBalanceForRentExemption(165);
  const rent = sourceInfo?.lamports ?? 0;
  const feeLamports = Math.floor((rent * 150) / 10_000);
  const recipientAtaExists = await connection.getAccountInfo(freshAta);

  console.log("\n=== the money, priced from the account's own balance ===");
  console.log(`  the source account holds   ${rent} lamports — this is the reclaim`);
  console.log(`  1.5% of that                ${feeLamports} lamports`);
  console.log(`  a recipient token account   ${ataRent} lamports (165 bytes, rent-exempt minimum)`);
  console.log(
    `  the recipient already has one: ${recipientAtaExists ? "yes" : "no — the sender pays for it"}`,
  );
  console.log(
    `  net when it has to be created: ${rent - feeLamports - ataRent} lamports  (negative means sending dust costs more than the rent frees)`,
  );
}

console.log("\n=== an NFT transfer ===");
// Nothing in this wallet is an SPL NFT, so find one to measure against: the
// transfer is the same shape as a fungible's, but "the same shape" is an
// assumption until it is run against a real asset.
let nftCase = nftHoldings[0] ?? null;
let nftOwner = OWNER;
if (!nftCase) {
  // `tokenType` cannot be used without an owner address here — Helius's index
  // rejects the combination the DAS spec allows — so this asks by `interface`,
  // then traces who holds the result through plain RPC. `searchAssets` does not
  // return token_info, which is why the token account has to be looked up rather
  // than read off the asset.
  for (const iface of ["V1_NFT", "LEGACY_NFT"]) {
    const found = await rpc("searchAssets", {
      interface: iface,
      compressed: false,
      limit: 20,
      page: 1,
    });
    for (const item of found.items ?? []) {
      const largest = await rpc("getTokenLargestAccounts", [item.id]);
      const holder = (largest.value ?? []).find((entry) => Number(entry.amount) > 0);
      if (!holder) continue;
      const info = await rpc("getAccountInfo", [
        holder.address,
        { encoding: "jsonParsed" },
      ]);
      const data = info?.value?.data;
      const parsed =
        data && typeof data === "object" && "parsed" in data
          ? data.parsed?.info
          : null;
      if (!parsed?.owner) continue;
      nftCase = {
        id: item.id,
        token_info: {
          associated_token_address: holder.address,
          token_program: info.value.owner,
        },
      };
      nftOwner = parsed.owner;
      break;
    }
    if (nftCase) break;
  }
}

if (!nftCase) {
  console.log("  no uncompressed NFT found to measure against — unmeasured");
} else {
  const nftPayer = new PublicKey(nftOwner);
  const foreign = nftOwner !== OWNER;
  const nftProgram = tokenProgramOf(
    nftCase.token_info?.token_program ?? TOKEN_PROGRAM_ID.toBase58(),
  );
  const nftResult = await simulate(
    sendUnit({
      mint: nftCase.id,
      source: new PublicKey(nftCase.token_info.associated_token_address),
      // One indivisible unit: decimals 0, amount 1.
      decimals: 0,
      amount: 1n,
      programId: nftProgram,
      recipientAta: getAssociatedTokenAddressSync(
        new PublicKey(nftCase.id),
        recipient,
        true,
        nftProgram,
      ),
      close: true,
      payer: nftPayer,
    }),
    foreign
      ? `create + transfer + close, a real NFT held by ${nftOwner.slice(0, 4)}…${nftOwner.slice(-4)}`
      : "create + transfer + close, an NFT",
    nftPayer,
  );
  report(
    nftResult.label,
    nftResult.err === null,
    `${nftResult.bytes} bytes, ${nftResult.cu ?? "?"} CU`,
  );
  if (nftResult.err) console.log(`    err: ${JSON.stringify(nftResult.err)}`);
  console.log(
    "  the recipient's account is a fresh rent deposit per NFT, and the sender pays it",
  );
}

console.log("\n=== how many sends ride in one transaction ===");
if (liquid.length === 0) {
  console.log("  nothing to measure");
} else {
  const token = liquid[0];
  const programId = tokenProgramOf(token.programId.toBase58());
  const mint = new PublicKey(token.mint);
  const recipientAta = getAssociatedTokenAddressSync(mint, recipient, true, programId);
  const unit = () => ({
    mint: token.mint,
    source: token.tokenAccount,
    decimals: token.decimals,
    amount: token.amount,
    programId,
    recipientAta,
    close: true,
  });

  const measure = async (instructions) => {
    const { blockhash } = await connection.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: owner,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    return new VersionedTransaction(message).serialize().length;
  };

  for (const count of [1, 2, 4, 8, 12]) {
    const instructions = [];
    for (let index = 0; index < count; index += 1) {
      instructions.push(...sendUnit(unit()));
    }
    const bytes = await measure(instructions);
    console.log(
      `  ${String(count).padStart(2)} units  ${String(bytes).padStart(4)} bytes  ${bytes <= MAX_TX_SIZE ? "fits" : "over " + MAX_TX_SIZE}`,
    );
  }
  console.log("  (the same unit repeated: this measures bytes, not validity)");

  // The number that matters for a distribution: sends to *different* wallets each
  // bring their own accounts with them, so a unit costs more than it does in the
  // repeated case above. Any 32 bytes is a valid address for this purpose — these
  // do not need to be real wallets, only distinct, because a message size is all
  // that is being measured here.
  for (const count of [1, 2, 4, 6, 8]) {
    const instructions = [];
    for (let index = 0; index < count; index += 1) {
      const other = new PublicKey(Buffer.alloc(32, index + 1));
      instructions.push(
        ...sendUnit({
          ...unit(),
          recipientAta: getAssociatedTokenAddressSync(mint, other, true, programId),
          recipientOwner: other,
        }),
      );
    }
    const bytes = await measure(instructions);
    console.log(
      `  ${String(count).padStart(2)} distinct destinations  ${String(bytes).padStart(4)} bytes  ${bytes <= MAX_TX_SIZE ? "fits" : `over ${MAX_TX_SIZE}`}`,
    );
  }

  // The mixed batch the app actually aims for: one NFT plus as many token sends
  // as still fit alongside it.
  if (nftCase) {
    const nftProgram = tokenProgramOf(
      nftCase.token_info?.token_program ?? TOKEN_PROGRAM_ID.toBase58(),
    );
    const nftInstructions = sendUnit({
      mint: nftCase.id,
      source: new PublicKey(nftCase.token_info.associated_token_address),
      decimals: 0,
      amount: 1n,
      programId: nftProgram,
      recipientAta: getAssociatedTokenAddressSync(
        new PublicKey(nftCase.id),
        recipient,
        true,
        nftProgram,
      ),
      close: true,
    });
    for (const count of [6, 4, 2, 0]) {
      const instructions = [...nftInstructions];
      for (let index = 0; index < count; index += 1) {
        instructions.push(...sendUnit(unit()));
      }
      const bytes = await measure(instructions);
      if (bytes <= MAX_TX_SIZE) {
        console.log(`  one NFT + ${count} token sends  ${bytes} bytes  fits`);
        break;
      }
      console.log(
        `  one NFT + ${count} token sends  ${bytes} bytes  over the limit`,
      );
    }
  }

  console.log(
    "  these ladders reuse one mint; a batch of *distinct* mints brings a new mint and",
  );
  console.log(
    "  a new token account per item, which is why the distinct-destination rows above",
  );
  console.log("  are the honest estimate to build the planner around");
}


