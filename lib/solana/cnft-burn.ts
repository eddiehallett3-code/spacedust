import bs58 from "bs58";
import type { TransactionInstruction } from "@solana/web3.js";
import { programRepositoryShim } from "@/lib/solana/umi-program-repository";

/**
 * Burning a compressed NFT.
 *
 * A cNFT is not an account. It is a leaf in a concurrent merkle tree, so there
 * is no token account to burn and nothing to close — which is why burning one
 * reclaims no rent, and why the only reason to do it is to be rid of the thing.
 * The leaf can only be destroyed by the Bubblegum program, which verifies the
 * leaf's inclusion in the tree against the tree's *current* root.
 *
 * That proof is not something we can compute: it needs every other leaf in the
 * tree, so it comes from the indexer (`getAssetProof`, alongside the leaf's
 * hashes from the scan). The consequence is a race we cannot engineer away — if
 * the tree gains a leaf between fetching the proof and the transaction landing,
 * the root moves and the burn is rejected. That is why the proof is fetched at
 * plan time rather than carried around from the scan.
 *
 * Like the Core route, the distinguishing bytes are never written by hand: they
 * come from mpl-bubblegum's own `burn` builder, and the failure mode of getting
 * a discriminator wrong is not "the burn fails" but "the bytes mean something
 * else". Both packages are imported dynamically, so a user who never burns a
 * cNFT never downloads them.
 *
 * One structural limit belongs here rather than in a caller: the proof is a list
 * of accounts — one per node — so a tree whose proof is long makes a transaction
 * that cannot fit. Measured against mainnet, a burn costs about 33 bytes per
 * proof node: 1052 bytes at 14 nodes, 1151 at 17, and 1250 at 20, against a
 * 1232-byte protocol limit. Metaplex's own tree guidance pairs a depth-20 tree
 * with canopy 13, i.e. a 7-node proof, which fits with room to spare.
 *
 * The caller handles the two cases that do not fit. If the tree has a canopy,
 * the indexer's full proof is truncated to the non-canopy tail before it gets
 * here (see `lib/solana/canopy.ts`). If the tree genuinely has no canopy, the
 * planner marks the leaf as pending and the executor builds an address lookup
 * table for its proof; this builder still sees the full remaining proof and
 * does not need to know which path produced it.
 */
export interface CnftBurnRequest {
  /** The leaf's asset id (DAS `id`). Only used for error messages. */
  asset: string;
  /**
   * Which Bubblegum instruction this leaf needs.
   *
   * A V2 leaf commits to two things a V1 leaf does not (the asset's own data
   * hash and a flags word) and is destroyed by `burnV2`. That is a different
   * instruction rather than a variation of `burn` — the discriminator, the
   * account list and the argument encoding all differ.
   */
  variant: "v1" | "v2";
  /** The merkle tree holding the leaf. */
  tree: string;
  /** The wallet that owns the leaf and will sign. */
  owner: string;
  /** The leaf delegate, when the asset is delegated. */
  delegate: string | null;
  /** The leaf's collection, when it has one. V2 needs it for Core collections. */
  collection: string | null;
  /** The leaf's index within the tree (DAS `compression.leaf_id`). */
  leafId: number;
  /** The leaf's own hashes, as the indexer reported them. */
  dataHash: string;
  creatorHash: string;
  /**
   * V2 only: the hash of the asset's own data (`compression.asset_data_hash`).
   *
   * `null` for a V1 leaf, which does not commit to it. A V2 leaf without this
   * cannot be burned — the program checks it against the leaf — so callers must
   * treat its absence as a refusal, never as a default.
   */
  assetDataHash: string | null;
  /** V2 only: the leaf's flags word (`compression.flags`), or `null`. */
  flags: number | null;
  /** The tree's current root, and this leaf's inclusion proof. */
  root: string;
  proof: string[];
  /**
   * The leaf's index within the tree, again — this is what `burn` calls `index`.
   *
   * Deliberately **not** the indexer's `node_index`, which is a different number:
   * that is the leaf's position in the tree's *node array*, and for a full tree
   * it measures `capacity + leafId` (measured on mainnet: 16384 + 1172 = 17556
   * for a depth-14 tree). Handing it over here encodes perfectly happily and is
   * then rejected on chain with `LeafIndexOutOfBounds`, reported as error 6008 —
   * which is the *compression* program's code, not Bubblegum's 6008, and reads
   * nothing like "wrong index".
   */
  index: number;
}

export async function buildCnftBurnInstruction(
  request: CnftBurnRequest,
): Promise<TransactionInstruction> {
  const [umi, bubblegum, adapters, eddsa] = await Promise.all([
    import("@metaplex-foundation/umi"),
    import("@metaplex-foundation/mpl-bubblegum"),
    import("@metaplex-foundation/umi-web3js-adapters"),
    import("@metaplex-foundation/umi-eddsa-web3js"),
  ]);

  const context = umi.createUmi();
  // `burn` has to derive the tree-config address, and does it through
  // `context.eddsa.findPda` — the base context has no eddsa implementation,
  // because it normally arrives with `umi-bundle-defaults`, which is the
  // package we are avoiding. This is Metaplex's own web3.js implementation of
  // exactly that one operation, rather than a PDA derivation of our own.
  //
  // Assigned rather than installed via `context.use`: the package exports the
  // interface itself under this name, while its plugin form is the separate
  // `web3JsEddsa()`. Assigning is both what the typings say and one less thing
  // to be wrong about.
  (context as unknown as { eddsa: unknown }).eddsa =
    eddsa.createWeb3JsEddsa();
  (context as unknown as { programs: unknown }).programs = programRepositoryShim();

  // Noop signers: this builds an instruction, not a signature. Each one is
  // still a signer *slot*, which the packer turns into a wallet approval.
  const owner = umi.createNoopSigner(umi.publicKey(request.owner));

  const builder =
    request.variant === "v2"
      ? bubblegum.burnV2(context, {
          // MUST be set. `burnV2` defaults `payer` to `context.payer`, and a
          // bare umi context has no wallet — it is a noop signer over a key
          // nobody controls, which becomes an extra signer slot the user could
          // never satisfy. The burn would be unbuildable in the wallet for a
          // reason that looks like nothing at all.
          payer: owner,
          // Documented as "defaults to payer... must be either the leaf owner
          // or the collection's permanent burn delegate". The wallet is the
          // leaf owner, so this is that, said explicitly rather than relied on.
          //
          // This is the *signing* slot in V2 — note that `leafOwner` is typed as
          // a plain key below, not a signer. That is the design change V2 makes,
          // so a collection's permanent burn delegate can sign instead of the
          // holder. Passing the owner as a signer for `leafOwner` type-checks
          // nowhere and would have been rejected on chain.
          authority: owner,
          leafOwner: umi.publicKey(request.owner),
          ...(request.delegate
            ? { leafDelegate: umi.publicKey(request.delegate) }
            : {}),
          merkleTree: umi.publicKey(request.tree),
          // Only when the leaf is in a collection. The builder then supplies
          // the Core CPI signer by itself; passing a collection that is not a
          // Core collection would add an account the program rejects.
          ...(request.collection
            ? { coreCollection: umi.publicKey(request.collection) }
            : {}),
          root: hashBytes(request.root),
          dataHash: hashBytes(request.dataHash),
          creatorHash: hashBytes(request.creatorHash),
          // V2 leaves commit to these two as well, and the program compares
          // them against the leaf, so both are mirrored exactly rather than
          // left to a default.
          ...(request.assetDataHash
            ? { assetDataHash: hashBytes(request.assetDataHash) }
            : {}),
          ...(request.flags !== null ? { flags: request.flags } : {}),
          nonce: BigInt(request.leafId),
          index: request.index,
          proof: request.proof.map((node) => umi.publicKey(node)),
        })
      : bubblegum.burn(context, {
          leafOwner: owner,
          // Omitted when the leaf is not delegated, and the builder then defaults
          // it to the owner — which is what an undelegated leaf stores anyway.
          // When it *is* delegated the program compares this account against the
          // delegate stored in the leaf, so passing the owner would fail.
          ...(request.delegate
            ? { leafDelegate: umi.publicKey(request.delegate) }
            : {}),
          merkleTree: umi.publicKey(request.tree),
          root: hashBytes(request.root),
          dataHash: hashBytes(request.dataHash),
          creatorHash: hashBytes(request.creatorHash),
          nonce: BigInt(request.leafId),
          index: request.index,
          proof: request.proof.map((node) => umi.publicKey(node)),
        });

  const [instruction] = builder.getInstructions();
  if (!instruction) {
    throw new Error("mpl-bubblegum built no instruction for this asset.");
  }
  return adapters.toWeb3JsInstruction(instruction);
}

/**
 * A 32-byte hash, decoded from the base58 the indexer speaks.
 *
 * Deliberately not `umi.publicKey`: a hash is not an address, and the length
 * check is the point. Anything that is not exactly 32 bytes means the indexer
 * sent something we do not understand, and a truncated proof should fail here
 * rather than on chain.
 */
function hashBytes(value: string): Uint8Array {
  const bytes = bs58.decode(value);
  if (bytes.length !== 32) {
    throw new Error(
      `Expected a 32-byte hash for this cNFT, got ${bytes.length} bytes.`,
    );
  }
  return bytes;
}
