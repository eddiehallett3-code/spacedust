import bs58 from "bs58";
import type { TransactionInstruction } from "@solana/web3.js";
import { programRepositoryShim } from "@/lib/solana/umi-program-repository";

/**
 * Sending a compressed NFT.
 *
 * A cNFT is not an account: it is a leaf in a concurrent merkle tree. So a send
 * is not a token transfer at all — there is no token account to move from, no
 * associated account to create at the destination, and no rent on either side.
 * The Bubblegum program verifies the leaf against the tree's *current* root and
 * rewrites the leaf's owner in place.
 *
 * Three consequences worth stating where they are load-bearing:
 *
 *  - The destination is a **wallet key, not an ATA**. Nothing is created for it
 *    and nothing is charged for it, which is why a cNFT row has no
 *    recipient-account rent beside it.
 *  - Nothing is closed, so a cNFT send reclaims **no rent** and pays **no
 *    Spacedust fee** — the fee exists only as a share of the rent a close
 *    returns.
 *  - The proof comes from an indexer and is fetched fresh at plan time. A tree
 *    can gain a leaf between the fetch and the transaction landing, which moves
 *    the root and gets the transfer rejected. That race cannot be engineered
 *    away, only shortened.
 *
 * The bytes are never written by hand: they come from mpl-bubblegum's own
 * `transfer` / `transferV2` builders. A wrong discriminator does not produce a
 * failed transfer, it produces a *different instruction*.
 *
 * Both packages are imported dynamically, so a wallet that never sends a cNFT
 * never downloads them.
 */
export interface CnftTransferRequest {
  /** The leaf's asset id (DAS `id`). Only used for error messages. */
  asset: string;
  /**
   * Which Bubblegum instruction this leaf needs — the same distinction as the
   * burn: a V2 leaf commits to two fields a V1 leaf does not, and is moved by
   * `transferV2`, which has its own discriminator, accounts and arguments.
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
  /** V2 only: the hash of the asset's own data. `null` for a V1 leaf. */
  assetDataHash: string | null;
  /** V2 only: the leaf's flags word, or `null`. */
  flags: number | null;
  /** The tree's current root, as the proof was computed against. */
  root: string;
  /** Sibling hashes connecting the leaf to that root. */
  proof: string[];
  /**
   * The leaf's index within the tree, again — this is what `transfer` calls
   * `index`.
   *
   * Deliberately **not** the indexer's `node_index`: that is the leaf's position
   * in the tree's node array and differs from its leaf id. Handing it over here
   * encodes happily and is rejected on chain.
   */
  index: number;
  /** Where the leaf is going. A wallet, not an associated token account. */
  newOwner: string;
}

export async function buildCnftTransferInstruction(
  request: CnftTransferRequest,
): Promise<TransactionInstruction> {
  const [umi, bubblegum, adapters, eddsa] = await Promise.all([
    import("@metaplex-foundation/umi"),
    import("@metaplex-foundation/mpl-bubblegum"),
    import("@metaplex-foundation/umi-web3js-adapters"),
    import("@metaplex-foundation/umi-eddsa-web3js"),
  ]);

  const context = umi.createUmi();
  // `transfer` derives the tree-config address through `context.eddsa.findPda`,
  // and a base context has no eddsa implementation — it normally arrives with
  // `umi-bundle-defaults`, the package this app avoids. This is Metaplex's own
  // web3.js implementation of that operation, not a derivation of ours.
  (context as unknown as { eddsa: unknown }).eddsa =
    eddsa.createWeb3JsEddsa();
  (context as unknown as { programs: unknown }).programs = programRepositoryShim();

  // Noop signers: this builds an instruction, not a signature. Each one is still
  // a signer *slot*, which the packer turns into a wallet approval.
  const owner = umi.createNoopSigner(umi.publicKey(request.owner));
  const newOwner = umi.publicKey(request.newOwner);

  const builder =
    request.variant === "v2"
      ? bubblegum.transferV2(context, {
          // MUST be set, for the same reason as the burn: `transferV2` defaults
          // `payer` to `context.payer`, and a bare umi context has none — the
          // result is an extra signer slot nobody could satisfy.
          payer: owner,
          // The signing slot in V2. The wallet is the leaf owner, so this is
          // that, said explicitly rather than relied on.
          authority: owner,
          leafOwner: umi.publicKey(request.owner),
          ...(request.delegate
            ? { leafDelegate: umi.publicKey(request.delegate) }
            : {}),
          newLeafOwner: newOwner,
          merkleTree: umi.publicKey(request.tree),
          // Only when the leaf is in a Core collection; the builder then supplies
          // the Core CPI signer by itself. Passing a collection that is not one
          // would add an account the program rejects.
          ...(request.collection
            ? { coreCollection: umi.publicKey(request.collection) }
            : {}),
          root: hashBytes(request.root),
          dataHash: hashBytes(request.dataHash),
          creatorHash: hashBytes(request.creatorHash),
          // V2 leaves commit to these two as well, and the program compares them
          // against the leaf, so both are mirrored exactly rather than defaulted.
          ...(request.assetDataHash
            ? { assetDataHash: hashBytes(request.assetDataHash) }
            : {}),
          ...(request.flags !== null ? { flags: request.flags } : {}),
          nonce: BigInt(request.leafId),
          index: request.index,
          proof: request.proof.map((node) => umi.publicKey(node)),
        })
      : bubblegum.transfer(context, {
          leafOwner: owner,
          // Omitted when the leaf is not delegated; the builder then defaults it
          // to the owner, which is what an undelegated leaf stores anyway. When
          // it *is* delegated the program compares this account against the
          // delegate recorded in the leaf, so passing the owner would fail.
          ...(request.delegate
            ? { leafDelegate: umi.publicKey(request.delegate) }
            : {}),
          newLeafOwner: newOwner,
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
    throw new Error(
      `mpl-bubblegum built no transfer instruction for ${request.asset}.`,
    );
  }
  return adapters.toWeb3JsInstruction(instruction);
}

/**
 * A 32-byte hash, decoded from the base58 the indexer speaks.
 *
 * Deliberately not `umi.publicKey`: a hash is not an address, and the length
 * check is the point. Anything that is not exactly 32 bytes means the indexer
 * sent something we do not understand, and it should fail here rather than on
 * chain.
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

