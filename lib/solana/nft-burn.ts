import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { programRepositoryShim } from "@/lib/solana/umi-program-repository";

/** The Token Metadata program, which owns both PDAs below. */
const TOKEN_METADATA_PROGRAM =
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

/**
 * The metadata account for a mint.
 *
 * Derived here rather than through the SDK, because the burn plan needs these
 * addresses to price the reclaim — and pricing must not depend on a dynamic
 * import of a package a wallet without NFTs never downloads.
 */
export function findMetadataPda(mint: PublicKey): PublicKey {
  const program = new PublicKey(TOKEN_METADATA_PROGRAM);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), program.toBuffer(), mint.toBuffer()],
    program,
  )[0];
}

/** The master edition account for a mint. */
export function findMasterEditionPda(mint: PublicKey): PublicKey {
  const program = new PublicKey(TOKEN_METADATA_PROGRAM);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      program.toBuffer(),
      mint.toBuffer(),
      Buffer.from("edition"),
    ],
    program,
  )[0];
}


/**
 * Burning a plain NFT through Token Metadata.
 *
 * An SPL burn plus a close returns the token account's rent and leaves the
 * **metadata** and **master edition** accounts alive — and those are the
 * accounts a wallet's index reads to describe the NFT, so the asset carries on
 * being listed after it is burned. They also hold more rent than the token
 * account does.
 *
 * Token Metadata's own `burnNft` closes the token account, the metadata and the
 * master edition together. Verified against a real mainnet NFT by simulating the
 * instruction and reading every account afterwards (`probes/tmp-nft-wipe.mjs`): all
 * three came back with zero bytes and zero lamports, which is what closed looks
 * like, where the mint survived at 82 bytes and 1,461,600 lamports — only its
 * mint authority can close that, and it is normally revoked when an NFT is
 * minted.
 *
 * The same caveat as Core applies, in the other direction: an account this
 * builder is not given is **not** omitted. Metaplex's generated instruction
 * resolves a missing account to the instruction's own program id, so the result
 * is a valid-looking instruction that the program then refuses. Every account
 * this needs is therefore passed explicitly, and the simulation is the gate.
 */
export interface NftBurnRequest {
  /** The NFT's mint. */
  mint: string;
  /** The wallet that owns it and will sign. */
  owner: string;
  /** The token account holding it, exactly as the scan found it. */
  tokenAccount: string;
  /**
   * The collection's **mint**, when the asset is in one.
   *
   * Token Metadata wants the collection's metadata PDA, not the mint, so it is
   * derived here with the package's own helper. Omitting it for a collection
   * asset is a refused burn rather than a different one — measured as
   * `Custom: 103` before the probe passed it.
   */
  collection: string | null;
  /** The token program that owns the NFT's accounts. */
  program: "legacy" | "token2022";
}

export async function buildNftBurnInstruction(
  request: NftBurnRequest,
): Promise<TransactionInstruction> {
  const [umi, metadata, adapters, eddsa] = await Promise.all([
    import("@metaplex-foundation/umi"),
    import("@metaplex-foundation/mpl-token-metadata"),
    import("@metaplex-foundation/umi-web3js-adapters"),
    import("@metaplex-foundation/umi-eddsa-web3js"),
  ]);

  const context = umi.createUmi();
  // Both are needed to derive PDAs — metadata, master edition and the
  // collection's metadata all come from mints — and neither exists in a bare
  // umi context. See `lib/solana/umi-program-repository.ts`.
  (context as unknown as { eddsa: unknown }).eddsa = eddsa.createWeb3JsEddsa();
  (context as unknown as { programs: unknown }).programs = programRepositoryShim();

  const owner = umi.createNoopSigner(umi.publicKey(request.owner));
  const mint = umi.publicKey(request.mint);

  const builder = metadata.burnNft(context, {
    // Never left to a default: an omitted account here becomes the instruction's
    // own program id, which simulates as a program error rather than as a burn.
    metadata: metadata.findMetadataPda(context, { mint })[0],
    owner,
    mint,
    tokenAccount: umi.publicKey(request.tokenAccount),
    masterEditionAccount: metadata.findMasterEditionPda(context, { mint })[0],
    splTokenProgram: umi.publicKey(
      request.program === "token2022"
        ? "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        : "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    ),
    ...(request.collection
      ? {
          collectionMetadata: metadata.findMetadataPda(context, {
            mint: umi.publicKey(request.collection),
          })[0],
        }
      : {}),
  });

  const [instruction] = builder.getInstructions();
  if (!instruction) {
    throw new Error("mpl-token-metadata built no instruction for this asset.");
  }
  return adapters.toWeb3JsInstruction(instruction);
}
