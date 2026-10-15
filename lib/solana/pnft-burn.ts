import { PublicKey, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { programRepositoryShim } from "@/lib/solana/umi-program-repository";

/**
 * Burning a programmable NFT (pNFT).
 *
 * A pNFT is an SPL NFT with a *token record* — an extra account that tracks
 * whether the asset is locked and who may move it. A plain SPL `Burn` leaves
 * that record behind and is refused, which is why pNFTs were the first thing
 * this app declined to burn.
 *
 * The burn therefore comes from Token Metadata as a whole, `burnV1`, which
 * closes the token account and the token record together. As with Core and
 * Bubblegum, the bytes are never written by hand: the builder owns the
 * discriminator and the account list, and the result is converted with
 * Metaplex's own web3.js adapter. Imported dynamically, so a wallet with no
 * pNFTs never downloads it.
 *
 * Three of its inputs default to `context.identity` — a key nobody controls in a
 * context built without a wallet — so `authority`, `tokenOwner` and `token` are
 * all passed explicitly:
 *
 *  - `authority` is the signing slot ("asset owner or utility delegate").
 *  - `tokenOwner` is only used to derive the associated token account, but a
 *    wrong one derives the wrong account.
 *  - `token` is the account the scan actually found, because a non-canonical
 *    holding would otherwise be missed — the same reason the SPL route never
 *    assumes an ATA.
 */
export interface PnftBurnRequest {
  /** The NFT's mint. */
  mint: string;
  /** The wallet that owns it and will sign. */
  owner: string;
  /** The token account holding it, exactly as the scan found it. */
  tokenAccount: string;
  /**
   * The collection's *metadata* account, when the asset is in a collection.
   *
   * Token Metadata wants the collection's metadata PDA, not the collection's
   * mint, so it is derived here with the package's own helper.
   */
  collection: string | null;
  /**
   * The asset's token standard, as read from its metadata: 4 for a pNFT, 5 for
   * a printed edition of one.
   *
   * The index reports both as `ProgrammableNFT`, and the two need different
   * handling from Token Metadata, so this number comes from the chain rather
   * than from a guess about the interface.
   */
  tokenStandard: number;
}

export async function buildPnftBurnInstruction(
  request: PnftBurnRequest,
): Promise<TransactionInstruction> {
  const [umi, metadata, adapters, eddsa] = await Promise.all([
    import("@metaplex-foundation/umi"),
    import("@metaplex-foundation/mpl-token-metadata"),
    import("@metaplex-foundation/umi-web3js-adapters"),
    import("@metaplex-foundation/umi-eddsa-web3js"),
  ]);

  const context = umi.createUmi();
  // Both of these are needed to derive PDAs — the metadata, master edition and
  // token record addresses all come from the mint — and neither exists in a
  // bare umi context. See `lib/solana/umi-program-repository.ts`.
  (context as unknown as { eddsa: unknown }).eddsa =
    eddsa.createWeb3JsEddsa();
  (context as unknown as { programs: unknown }).programs = programRepositoryShim();

  const owner = umi.createNoopSigner(umi.publicKey(request.owner));

  const builder = metadata.burnV1(context, {
    // Never left to the default: `context.identity` in a bare context is a key
    // the user cannot sign for.
    authority: owner,
    tokenOwner: umi.publicKey(request.owner),
    mint: umi.publicKey(request.mint),
    token: umi.publicKey(request.tokenAccount),
    // This is what makes the builder include the token record at all: it only
    // resolves that account for the programmable standards. 5 is a printed
    // edition of a pNFT, which Token Metadata treats as programmable too.
    tokenStandard:
      request.tokenStandard === 5
        ? metadata.TokenStandard.ProgrammableNonFungibleEdition
        : metadata.TokenStandard.ProgrammableNonFungible,
    ...(request.collection
      ? {
          collectionMetadata: metadata.findMetadataPda(context, {
            mint: umi.publicKey(request.collection),
          }),
        }
      : {}),
  });

  const [instruction] = builder.getInstructions();
  if (!instruction) {
    throw new Error("mpl-token-metadata built no instruction for this asset.");
  }
  return adapters.toWeb3JsInstruction(instruction);
}

/** What a pNFT's own accounts say about whether — and how — it can be burned. */
export interface PnftState {
  /**
   * The token record is not `Unlocked`, so the holder cannot burn it.
   *
   * `Locked` is an escrow or a staking program holding it; `Listed` is a
   * marketplace listing — very common, and very fixable by delisting.
   */
  locked: boolean;
  /**
   * The token standard straight from the asset's metadata: 4 for a pNFT, 5 for
   * a printed *edition* of one.
   *
   * Not inferred from the index's interface, which reports both as
   * `ProgrammableNFT` — and the two need different instructions from Token
   * Metadata, so guessing would send the wrong one.
   */
  tokenStandard: number;
}

/**
 * Read each pNFT's metadata and token record, and report what they say.
 *
 * Two batched calls' worth of keys in **one** call, because both answers matter
 * and neither is in the wallet scan: the token record says whether the holder
 * may move the asset at all, and the metadata says which standard it is. A
 * listing locks the asset inside the owner's own wallet without moving it
 * anywhere, which is why four of the first pNFTs tested here could not be
 * burned — and why "cannot be burned by its holder" has to be a reason on the
 * row rather than a rejection from the program.
 *
 * Anything unreadable is left out of the map, and callers then let the
 * simulation decide: unknown is not the same as locked.
 */
export async function fetchPnftStates(
  connection: Connection,
  requests: Array<{ mint: string; tokenAccount: string }>,
): Promise<Map<string, PnftState>> {
  const states = new Map<string, PnftState>();
  if (requests.length === 0) return states;

  const [umi, metadata, adapters, eddsa] = await Promise.all([
    import("@metaplex-foundation/umi"),
    import("@metaplex-foundation/mpl-token-metadata"),
    import("@metaplex-foundation/umi-web3js-adapters"),
    import("@metaplex-foundation/umi-eddsa-web3js"),
  ]);

  const context = umi.createUmi();
  (context as unknown as { eddsa: unknown }).eddsa =
    eddsa.createWeb3JsEddsa();
  (context as unknown as { programs: unknown }).programs =
    programRepositoryShim();

  // Careful with the two serializers: they are different accounts with
  // different layouts, so each key is tagged with what it is.
  const metadataSerializer = metadata.getMetadataAccountDataSerializer();
  const recordSerializer = metadata.getTokenRecordAccountDataSerializer();

  const keys: Array<{ mint: string; kind: "metadata" | "record"; key: PublicKey }> =
    [];

  // Derived one at a time, each guarded. A malformed address is the caller's to
  // report on its own row; this pass must never be the reason a whole burn plan
  // fails.
  for (const request of requests) {
    try {
      const mint = umi.publicKey(request.mint);
      const token = umi.publicKey(request.tokenAccount);
      // A umi `Pda` is a tuple — `[address, bump]` — so `[0]` is the key and
      // stringifying the wrapper yields "address,bump", which is not a valid
      // one. The throw that follows is easy to swallow, and that is exactly how
      // this read silently returned nothing at first.
      keys.push({
        mint: request.mint,
        kind: "metadata",
        key: adapters.toWeb3JsPublicKey(
          metadata.findMetadataPda(context, { mint })[0],
        ),
      });
      keys.push({
        mint: request.mint,
        kind: "record",
        key: adapters.toWeb3JsPublicKey(
          metadata.findTokenRecordPda(context, { mint, token })[0],
        ),
      });
    } catch {
      // Nothing to say about this one.
    }
  }

  const found = new Map<string, Partial<PnftState>>();

  // One RPC call takes at most 100 keys.
  for (let start = 0; start < keys.length; start += 100) {
    const batch = keys.slice(start, start + 100);
    try {
      const infos = await connection.getMultipleAccountsInfo(
        batch.map((entry) => entry.key),
      );
      batch.forEach((entry, index) => {
        const data = infos[index]?.data;
        if (!data) return;
        const entryState = found.get(entry.mint) ?? {};
        try {
          if (entry.kind === "metadata") {
            const [account] = metadataSerializer.deserialize(
              new Uint8Array(data),
            );
            const standard = account.tokenStandard;
            if (standard?.__option === "Some") {
              entryState.tokenStandard = Number(standard.value);
            }
            // `programmableConfig` also carries a rule set, and reading it was
            // tried and then dropped: it flagged all 30 pNFTs sampled as having
            // rules, while 25 of those same assets simulated a clean burn. A
            // check that is wrong in that direction would block burns that
            // work, so the rule-set case is left to the simulation — which
            // fails before anyone signs, in words, if a rule actually applies.
          } else {
            const [record] = recordSerializer.deserialize(new Uint8Array(data));
            // Unlocked is 0; Locked (1) and Listed (2) both stop the holder.
            entryState.locked = Number(record.state) !== 0;
          }
          found.set(entry.mint, entryState);
        } catch {
          // A record we cannot decode tells us nothing — fall through to the
          // simulation rather than refusing an asset that may be fine.
        }
      });
    } catch {
      // Same again: unreadable is unknown.
    }
  }

  for (const [mint, entryState] of found) {
    // Only a complete read is useful: a burn needs the standard, and a
    // half-known token record could refuse something that is fine.
    if (entryState.tokenStandard === undefined) continue;
    if (entryState.locked === undefined) continue;
    states.set(mint, {
      locked: entryState.locked,
      tokenStandard: entryState.tokenStandard,
    });
  }

  return states;
}
