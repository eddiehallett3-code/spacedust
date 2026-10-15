import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import fs from "node:fs";

/**
 * Temp probe: does Token Metadata's own burn wipe an NFT out entirely?
 *
 * This app burns a plain NFT with the SPL Token program — burn the amount, then
 * close the token account — which returns the token account's rent and leaves
 * the **mint**, the **metadata account** and the **master edition** alive. Those
 * are three more accounts, holding more rent than the token account did, and a
 * wallet's index can keep describing the asset from them.
 *
 * Token Metadata's SDK also exposes `burnNft`, documented as closing the mint,
 * metadata and edition once the supply reaches zero. If that is true, this app
 * is both leaving rent behind and telling users something false: the NFT panel
 * currently says those accounts "are not reclaimable — Metaplex exposes no way
 * to close them".
 *
 * The test builds the instruction against a real mainnet NFT and reads the
 * accounts **after** the simulated transaction. Nothing is signed or sent.
 */

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/HELIUS_API_KEY=(.+)/)?.[1]?.trim();
const url = key
  ? `https://mainnet.helius-rpc.com/?api-key=${key}`
  : env.match(/NEXT_PUBLIC_FALLBACK_RPC_URL=(.+)/)?.[1]?.trim();
const payer = env.match(/FEE_WALLET=(.+)/)?.[1]?.trim();
if (!url || !payer) throw new Error("missing env");

const connection = new Connection(url, "confirmed");
const TOKEN_METADATA = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

/** A wallet holding plain NFTs to test against. */
const HOLDER = "1nc1nerator11111111111111111111111111111111";

async function rpc(method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/** The metadata and master-edition PDAs for a mint. */
function pdasFor(mint) {
  const program = new PublicKey(TOKEN_METADATA);
  const mintKey = new PublicKey(mint);
  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), program.toBuffer(), mintKey.toBuffer()],
    program,
  );
  const [edition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      program.toBuffer(),
      mintKey.toBuffer(),
      Buffer.from("edition"),
    ],
    program,
  );
  return { metadata, edition };
}

const listing = await rpc("getAssetsByOwner", {
  ownerAddress: HOLDER,
  page: 1,
  limit: 1000,
  options: { showFungible: false, showZeroBalance: false },
});
const plain = (listing?.items ?? []).find(
  (item) =>
    item.interface === "V1_NFT" &&
    item.compression?.compressed === false &&
    // A collection-less NFT takes a different branch: the collection slot is
    // left to the SDK, which marks it absent with the program id rather than
    // omitting it — the same sentinel that made Core's burn look malformed until
    // it was actually simulated. The collection case is verified; this checks the
    // other one, because spam NFTs mostly have no collection.
    !item.grouping?.length,
);
if (!plain) throw new Error("no plain V1_NFT in that listing");

const mint = plain.id;
const { metadata, edition } = pdasFor(mint);
// A collection NFT's burn also has to name the collection's metadata account —
// without it the program refuses, which is how this probe first measured
// `Custom: 103` rather than an answer.
const collectionMint =
  plain.grouping?.find((group) => group.group_key === "collection")?.group_value ??
  null;
const collectionMetadata = collectionMint ? pdasFor(collectionMint).metadata : null;
const largest = await rpc("getTokenLargestAccounts", [mint]);
const tokenAccount = largest?.value?.[0]?.address;


console.log("\n── Build Token Metadata's own burnNft ──");
const [umi, tm, adapters] = await Promise.all([
  import("@metaplex-foundation/umi"),
  import("@metaplex-foundation/mpl-token-metadata"),
  import("@metaplex-foundation/umi-web3js-adapters"),
]);

/** The program names a Metaplex builder may resolve, with their real addresses. */
const PROGRAMS = {
  tokenMetadata: TOKEN_METADATA,
  splToken: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  splToken2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  splSystem: "11111111111111111111111111111111",
  splAssociatedToken: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  splNoop: "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV",
};

const context = umi.createUmi();
context.programs = {
  add: () => {},
  getPublicKey: (name, fallbackAddress) => {
    const resolved = PROGRAMS[name] ?? fallbackAddress;
    if (!resolved) throw new Error(`no address for umi program "${name}"`);
    return resolved;
  },
};
context.use(tm.mplTokenMetadata());

const holder = umi.publicKey(HOLDER);
let instruction = null;
let builtAs = null;
for (const [label, build] of [
  [
    "burnNft",
    () =>
      tm.burnNft(context, {
        metadata: umi.publicKey(metadata.toBase58()),
        // A noop signer, not a plain key: `burnNft` requires the owner's
        // signature, and without a signer slot the simulation refuses it —
        // which the first run of this probe measured as `MissingRequiredSignature`.
        owner: umi.createNoopSigner(holder),
        mint: umi.publicKey(mint),
        tokenAccount: umi.publicKey(tokenAccount),
        masterEditionAccount: umi.publicKey(edition.toBase58()),
        splTokenProgram: umi.publicKey(PROGRAMS.splToken),
        ...(collectionMetadata
          ? { collectionMetadata: umi.publicKey(collectionMetadata.toBase58()) }
          : {}),
      }),
  ],
  [
    "burnV1",
    () =>
      tm.burnV1(context, {
        authority: umi.createNoopSigner(holder),
        metadata: umi.publicKey(metadata.toBase58()),
        mint: umi.publicKey(mint),
        tokenOwner: holder,
        tokenAccount: umi.publicKey(tokenAccount),
        masterEditionAccount: umi.publicKey(edition.toBase58()),
        amount: 1n,
      }),
  ],
]) {
  try {
    const [built] = build().getInstructions();
    instruction = adapters.toWeb3JsInstruction(built);
    builtAs = label;
    break;
  } catch (error) {
    console.log(`  ${label} could not be built: ${error.message.slice(0, 90)}`);
  }
}
if (!instruction) throw new Error("neither builder produced an instruction");

console.log("  built as :", builtAs);
console.log("  program  :", instruction.programId.toBase58());
console.log("  writable keys:");
for (const account of instruction.keys.filter((k) => k.isWritable)) {
  console.log(
    `    ${account.pubkey.toBase58()}${account.pubkey.toBase58() === metadata.toBase58() ? "  ← metadata" : account.pubkey.toBase58() === edition.toBase58() ? "  ← edition" : account.pubkey.toBase58() === mint ? "  ← mint" : ""}`,
  );
}

console.log("\n── Simulate: what is left? ──");
const { blockhash } = await connection.getLatestBlockhash("confirmed");
const message = new TransactionMessage({
  payerKey: new PublicKey(payer),
  recentBlockhash: blockhash,
  instructions: [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    instruction,
  ],
}).compileToV0Message();

const watched = [mint, metadata.toBase58(), edition.toBase58(), tokenAccount];
const simulation = await connection.simulateTransaction(
  new VersionedTransaction(message),
  {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
    accounts: { addresses: watched, encoding: "base64" },
  },
);

console.log("  simulation err :", simulation.value.err ?? "null (the burn would succeed)");
console.log("  units          :", simulation.value.unitsConsumed);
if (simulation.value.err) {
  console.log(
    "  (a failed simulation changes nothing, so the accounts below prove nothing)",
  );
}
const labels = ["mint", "metadata", "edition", "token account"];
watched.forEach((address, index) => {
  const after = simulation.value.accounts?.[index];
  if (after === null || after === undefined) {
    console.log(`  ${labels[index].padEnd(13)}: GONE`);
  } else {
    const bytes = Buffer.from(after.data?.[0] ?? "", "base64");
    console.log(
      `  ${labels[index].padEnd(13)}: exists, ${bytes.length} bytes, ${after.lamports} lamports`,
    );
  }
});

console.log("── The NFT under test ──");
console.log("  name          :", String(plain.content?.metadata?.name ?? "").slice(0, 30));
console.log("  mint          :", mint);
console.log("  metadata pda  :", metadata.toBase58());
console.log("  edition pda   :", edition.toBase58());
console.log("  token account :", tokenAccount);
console.log("  collection    :", plain.grouping?.length ? JSON.stringify(plain.grouping) : "none");

console.log("\n── What rent is on this NFT right now? ──");
const before = await rpc("getMultipleAccounts", [
  [mint, metadata.toBase58(), edition.toBase58(), tokenAccount],
  { encoding: "base64" },
]);
let total = 0;
["mint", "metadata", "edition", "token account"].forEach((label, index) => {
  const account = before?.value?.[index];
  const lamports = account?.lamports ?? 0;
  total += lamports;
  const bytes = account?.data?.[0]
    ? Buffer.from(account.data[0], "base64").length
    : 0;
  console.log(
    `  ${label.padEnd(13)}: ${String(bytes).padStart(4)} bytes, ${String(lamports).padStart(8)} lamports (${(lamports / 1e9).toFixed(9)} SOL)`,
  );
});
console.log(
  `  TOTAL        : ${total} lamports = ${(total / 1e9).toFixed(9)} SOL`,
);
console.log(
  "  the metadata and edition are the reclaimable part an SPL burn misses: it\n" +
    "  closes the token account alone, where Token Metadata's burn closes three.",
);

