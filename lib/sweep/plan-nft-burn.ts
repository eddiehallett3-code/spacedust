import {
  PublicKey,
  type AddressLookupTableAccount,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import { createBurnInstruction } from "@solana/spl-token";
import {
  BASE_FEE_LAMPORTS,
  COMPUTE_UNIT_LIMIT,
  MAX_LOCKED_ACCOUNTS_PER_TX,
  PRIORITY_FEE_MICRO_LAMPORTS,
} from "@/lib/utils/constants";
import {
  createCloseAccountInstruction,
  createComputeBudgetInstructions,
  tokenProgramFor,
} from "@/lib/solana/instructions";
import { packTransactions, lockedAccountCount, type PackUnit } from "@/lib/solana/pack";
import { simulateAll } from "@/lib/solana/simulate";
import { fetchRentMinimums } from "@/lib/solana/rent";
import { buildCoreBurnInstruction } from "@/lib/solana/core-burn";
import { buildCnftBurnInstruction } from "@/lib/solana/cnft-burn";
import { CNFT_INLINE_PROOF_BUDGET_BYTES } from "@/lib/solana/cnft-size";
import {
  buildNftBurnInstruction,
  findMasterEditionPda,
  findMetadataPda,
} from "@/lib/solana/nft-burn";
import {
  buildPnftBurnInstruction,
  fetchPnftStates,
  type PnftState,
} from "@/lib/solana/pnft-burn";
import { fetchCnftProofs, type CnftProof } from "@/lib/sweep/asset-proof";
import { VoidError } from "@/lib/sweep/plan-void";
import type { PackedTransaction, SimulationOutcome } from "@/types/sweep";
import { auditPlanBeforeSigning } from "@/lib/security/audit-plan";
import type { NonFungibleAsset } from "@/types/token";

/**
 * Burning NFTs, on purpose and one at a time.
 *
 * Deliberately *not* folded into the Void's token pipeline. A fungible burn is
 * routine housekeeping on something that was priced at nothing; an NFT burn
 * destroys a unique asset. Sharing a code path is how the two got confused
 * before, when an NFT arrived looking exactly like a token and was pre-selected
 * for the fire. Separating them means a bug here cannot sweep a token, and a
 * bug there cannot burn an NFT.
 *
 * No integrator fee is charged. The Void's 1.5% is a charge on reclaimed rent,
 * and whether it extends to NFTs is a pricing decision rather than an
 * implementation detail — not something to introduce silently.
 */

/** How a burnable asset is actually destroyed. */
export type BurnRoute = "spl" | "core" | "cnft" | "pnft";

/** What we can burn, by which route, and why we cannot burn the rest. */
export type Burnability =
  | { burnable: true; route: BurnRoute; reason?: never }
  | { burnable: false; reason: string };

/**
 * Interfaces whose burn is a plain SPL `Burn` + `CloseAccount`.
 *
 * An explicit allow-list rather than "anything with a token account". A pNFT
 * needs Token Metadata's `BurnNft` (it has a token record to clean up), a Core
 * asset is owned by a different program entirely, and an unrecognised interface
 * is by definition one we do not understand. In each case the right answer is
 * to refuse rather than to send an instruction and hope.
 *
 * `FungibleAsset` earns its place here rather than contradicting the rule above:
 * it is the index's word for a 0-decimal asset it could not tell from a fungible,
 * which `lib/token-source/collectible-shape.ts` has already determined has no
 * market and is therefore presented as a collectible. It has a token account like
 * any uncompressed NFT and burns with exactly the same instruction. Refusing it
 * would put something the app offers for destruction on one screen and nothing at
 * all on the screen built for destruction.
 */
const SPL_BURNABLE_INTERFACES = new Set([
  "V1_NFT",
  "LEGACY_NFT",
  "V1_PRINT",
  "FungibleAsset",
]);

/** Plain-English names, so a reason reads as a limit of this build, not jargon. */
const INTERFACE_LABELS: Record<string, string> = {
  MplCoreAsset: "Core assets",
  MplCoreCollection: "A Core collection",
  ProgrammableNFT: "A programmable NFT (pNFT)",
};

function describeInterface(iface: string): string {
  return INTERFACE_LABELS[iface] ?? iface;
}

/**
 * A compressed NFT: burnable only if we can actually prove the leaf's membership.
 *
 * A cNFT has no token account — it is a leaf in a merkle tree — so its burn is a
 * Bubblegum instruction carrying the tree, the leaf's index and its two hashes,
 * plus a merkle proof that the leaf is in that tree. Everything except the proof
 * comes from the scan; the proof is fetched at plan time.
 *
 * Verified on mainnet before this was offered: real leaves in real trees
 * simulate clean, so the refusals here are about the cases that genuinely
 * cannot work rather than about a build that does not try.
 */
function cnftBurnability(asset: NonFungibleAsset): Burnability {
  // No tree, index and hashes means no burn. The scan reads them all or none,
  // so this is what a wallet scanned without a metadata index looks like.
  if (!asset.merkle) {
    return {
      burnable: false,
      reason:
        "A metadata index (Helius key) is needed to prove this leaf is in its tree, and this wallet was scanned without one.",
    };
  }
  // A V2 leaf commits to its own asset-data hash, which the program checks, so
  // a V2 asset the index did not describe cannot be burned. Refused rather than
  // sent with a plausible-looking default.
  if (isBubblegumV2(asset) && !asset.merkle.assetDataHash) {
    return {
      burnable: false,
      reason:
        "A Bubblegum V2 leaf needs its asset-data hash, which this scan did not return. Rescan the wallet.",
    };
  }
  return { burnable: true, route: "cnft" };
}

/**
 * What kind of thing this asset is, in one word.
 *
 * Worth showing, because the burn route — and therefore the failure modes —
 * differ: a Core asset is its own account, a pNFT has a token record, a cNFT is
 * a merkle leaf, and an NFT is just an SPL token. They all live on the same two
 * tabs, and until now nothing on a card said which was which.
 */
export function assetKind(asset: NonFungibleAsset): string {
  if (asset.compressed) return "cNFT";
  if (asset.interface === "MplCoreAsset") return "Core";
  if (asset.interface === "ProgrammableNFT") return "pNFT";
  // A token the index called fungible, which this app calls a collectible: no
  // market prices it, so it is presented with the collectibles and burned through
  // the SPL route like an uncompressed NFT. Before this it would have read as
  // "unknown", which is worse than wrong — it is unhelpful on the one screen whose
  // job is to make destruction deliberate.
  if (asset.interface === "FungibleAsset") return "collectible";
  if (asset.interface.startsWith("core-rpc:")) return "unidentified";
  if (SPL_BURNABLE_INTERFACES.has(asset.interface)) return "NFT";
  return "unknown";
}

/**
 * Whether this leaf is a Bubblegum V2 leaf.
 *
 * The index names the interface, which is the only honest signal available:
 * V2 is not a property of the tree we could infer, and getting it wrong means
 * sending the wrong instruction — a different discriminator, accounts and
 * arguments — not a slightly-off one.
 */
export function isBubblegumV2(asset: NonFungibleAsset): boolean {
  return asset.interface === "MplBubblegumV2";
}

export function nftBurnability(asset: NonFungibleAsset): Burnability {
  // ORDER MATTERS. These strings are what a user reads when a card will not
  // respond, so the most specific, least alarming reason has to win.
  //
  // The asset-type checks come first on purpose. A Core asset has no SPL token
  // account *by nature*, so checking the token account first made every Core
  // asset report "its token account could not be located" — which reads like a
  // scanner failure and sends you hunting a bug that does not exist. It was
  // wrong for 4,244 of 4,280 assets in the first wallet that was measured.
  //
  // That leaves "token account could not be located" meaning what it says: an
  // asset of a type we *can* burn, whose account we genuinely could not find.
  // The only one of these that implies something is broken.
  if (asset.compressed) {
    return cnftBurnability(asset);
  }
  // The free scanner can only infer "minted once" from supply. Enough to keep
  // it out of the dust list, not enough to destroy it: we cannot say what it is.
  if (asset.interface.startsWith("core-rpc:")) {
    return {
      burnable: false,
      reason:
        "Not identified — a metadata index (Helius key) is needed to confirm what this is.",
    };
  }
  // A Core asset is burned by the Core program, not by SPL, and it has no token
  // account by nature — the asset account *is* the position, and the program
  // closes it and returns its rent. That is exactly why the asset-type checks
  // have to run before the token-account check below.
  //
  // But a Core asset is *not* exempt from the checks that follow: Core staking
  // works through a freeze delegate, and a frozen asset is one a staker is
  // holding. Returning "burnable" here used to skip both the frozen and the
  // delegate test — so a staked Core asset was offered, built, and rejected by
  // the program with `IncorrectAccount`. Deciding the route early is fine;
  // skipping the safety checks is not.
  const isCore = asset.interface === "MplCoreAsset";
  const isPnft = asset.interface === "ProgrammableNFT";
  if (!SPL_BURNABLE_INTERFACES.has(asset.interface) && !isCore && !isPnft) {
    return {
      burnable: false,
      reason: `${describeInterface(asset.interface)} — burning needs a Metaplex instruction this build does not send yet.`,
    };
  }
  if (asset.frozen) {
    return {
      burnable: false,
      reason:
        "Frozen, so the owner cannot burn it — a staking or escrow program usually holds it. Unstake or unfreeze it first.",
    };
  }
  // A delegate means something else has power over this asset — a staking
  // program, an escrow, or a marketplace listing that never moved it out of the
  // wallet. Burning it would destroy something that is in use elsewhere, and
  // the owner can always revoke the delegate first. Applying this to every NFT
  // tab on purpose: it is the same hazard whichever asset class it is.
  if (asset.delegate) {
    return {
      burnable: false,
      reason:
        "Delegated to another program, so it may be staked, escrowed or listed for sale. Revoke the delegate or unstake it first.",
    };
  }
  if (isCore) {
    return { burnable: true, route: "core" };
  }
  // A pNFT needs a real token account just as an SPL token does, so it runs
  // through the same checks and is then routed to Token Metadata instead of to
  // the token program — its token record has to be torn down with it, which a
  // plain `Burn` does not do.
  if (!asset.tokenAccount) {
    return {
      burnable: false,
      reason: "Its token account could not be located, so there is nothing to burn.",
    };
  }
  // Whether the holder can burn a pNFT at all is a property of its token
  // record — locked, or listed for sale — and only the chain knows that. The
  // planner reads it; this predicate stays a pure function of the scan.
  return isPnft ? { burnable: true, route: "pnft" } : { burnable: true, route: "spl" };
}

export interface PlanNftBurnResult {
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  warnings: string[];
  blockhash: string;
  lastValidBlockHeight: number;
  estimatedFeeLamports: number;
  /** One token-account rent per NFT whose account this batch closes. */
  estimatedRentReclaimLamports: number;
  /**
   * Rent expected back, per asset.
   *
   * A Core burn returns whatever is locked in the asset account, which varies
   * with the asset; an SPL burn returns the token account's rent, which does
   * not. A single batch can contain both, so this cannot be a single figure.
   */
  rentByAsset: Record<string, number>;
  /** Assets that were asked for and refused, with the reason shown to the user. */
  skipped: Array<{ id: string; name: string; reason: string }>;
  hasFailures: boolean;
  /**
   * cNFTs whose proofs are too long to fit without a lookup table.
   *
   * They are not failures and are not in `packed`: a burn cannot reference a
   * table that has not been created yet. The executor creates the table, waits
   * for it to become usable, then re-plans these assets with `lookupTables`.
   */
  lookupTableAssets: NonFungibleAsset[];
  /**
   * What this batch was packed from, kept so a single transaction can be rebuilt
   * against a fresh blockhash in the middle of a run.
   *
   * A wallet that prompts once per transaction spends the blockhash window on the
   * prompts; re-packing is how each approval starts with a fresh minute without
   * re-fetching proofs the user has already approved. See
   * `refreshNftBurnBlockhash` and `signAndSubmitSequentially`.
   */
  repackInput: {
    units: PackUnit[];
    prologue: TransactionInstruction[];
    payer: PublicKey;
    lookupTables: AddressLookupTableAccount[];
  };
}

export async function planNftBurn(input: {
  connection: Connection;
  owner: PublicKey;
  assets: NonFungibleAsset[];
  /**
   * Proofs to use instead of fetching fresh ones.
   *
   * The lookup-table path builds a table from one proof snapshot. Re-fetching
   * between table creation and burn could produce nodes the table does not
   * contain, so the executor passes the same snapshot to this planner.
   */
  proofs?: Map<string, CnftProof>;
  /**
   * Tables the burn may reference. Passing them is what turns a 20- or
   * 24-node proof from a dropped unit into a transaction that fits.
   */
  lookupTables?: AddressLookupTableAccount[];
}): Promise<PlanNftBurnResult> {
  const { connection, owner, assets } = input;
  const lookupTables = input.lookupTables ?? [];
  const warnings: string[] = [];
  const skipped: PlanNftBurnResult["skipped"] = [];
  const units: PackUnit[] = [];

  // Rent from the chain, like every other money figure in the app.
  const rent = await fetchRentMinimums(connection);

  const rentByAsset: Record<string, number> = {};
  /**
   * Accounts each burn will close, so the reclaim is priced from what they hold.
   *
   * A rent *constant* was right when a burn closed exactly one account of a
   * known size. It is wrong now: a Token Metadata burn closes the token account,
   * the metadata and the master edition, and those hold different amounts — the
   * metadata account of one NFT measured 3,733,800 lamports against the token
   * account's 2,039,280. Pricing from the constant would understate every row.
   */
  const closedAccounts = new Map<string, PublicKey[]>();
  const coreMints: string[] = [];

  // Proofs first, for every cNFT in the plan, in one request. They are fetched
  // rather than carried over from the scan because a proof is only valid against
  // the tree's *current* root: the fresher the better, and the closer to signing
  // the better still.
  const cnftIds = assets
    .filter((asset) => {
      const verdict = nftBurnability(asset);
      return verdict.burnable && verdict.route === "cnft";
    })
    .map((asset) => asset.id);
  // A caller may hand us a snapshot from the lookup-table setup. Copy it:
  // the stale-proof retry below adds fresh entries, and mutating the caller's
  // map would make the table and the burn disagree about which snapshot won.
  const proofs = input.proofs
    ? new Map(input.proofs)
    : await fetchCnftProofs(cnftIds);

  // pNFT state, in one batched read. A pNFT can be locked or listed *inside the
  // owner's own wallet*, so "the wallet holds it" is not the same as "the
  // holder may destroy it" — the token record decides, and only the chain has
  // it. Reading it here means the reason lands on the row instead of arriving
  // as a program error after a wallet prompt.
  // Same shape of safety as the token-record pass itself: a failure while
  // *asking* must leave the assets to the simulation, not stop the plan.
  const pnftStates = await fetchPnftStates(
    connection,
    assets
      .filter((asset) => {
        const verdict = nftBurnability(asset);
        return verdict.burnable && verdict.route === "pnft";
      })
      .flatMap((asset) =>
        asset.tokenAccount
          ? [{ mint: asset.id, tokenAccount: asset.tokenAccount }]
          : [],
      ),
  ).catch(() => new Map<string, PnftState>());

  const cnftAssets = new Map<string, NonFungibleAsset>();
  const lookupTableAssets = new Map<string, NonFungibleAsset>();

  /**
   * The Bubblegum burn for one cNFT, from a proof.
   *
   * A function rather than inline because the proof is fetched twice: once to
   * build the plan, and again if the tree moves while that plan is simulated —
   * which, on a tree someone is actively minting into, it does.
   */
  const cnftBurnUnit = async (
    asset: NonFungibleAsset,
    proof: CnftProof,
  ): Promise<PackUnit> => {
    const leaf = asset.merkle;
    if (!leaf) throw new Error("A cNFT reached the planner with no leaf.");
    const instruction = await buildCnftBurnInstruction({
      asset: asset.id,
      // Which instruction this leaf needs: a V2 leaf is destroyed by `burnV2`,
      // a different instruction and not a variation of `burn`.
      variant: isBubblegumV2(asset) ? "v2" : "v1",
      tree: leaf.tree,
      owner: owner.toBase58(),
      delegate: asset.delegate,
      collection: asset.collection?.address ?? null,
      leafId: leaf.leafId,
      dataHash: leaf.dataHash,
      creatorHash: leaf.creatorHash,
      assetDataHash: leaf.assetDataHash,
      flags: leaf.flags,
      root: proof.root,
      proof: proof.proof,
      // The leaf's index, not the proof's `nodeIndex` — see the field's own
      // note; confusing the two is rejected on chain with a 6008 that reads like
      // a Bubblegum error and is not one.
      index: leaf.leafId,
    });
    return { mint: asset.id, instructions: [instruction], rentReclaim: false };
  };

  for (const asset of assets) {
    const verdict = nftBurnability(asset);
    if (!verdict.burnable) {
      skipped.push({ id: asset.id, name: asset.name, reason: verdict.reason });
      continue;
    }

    try {
      if (verdict.route === "cnft") {
        // A cNFT sits in a merkle tree, so there is no account to close and no
        // rent to reclaim — the leaf simply stops existing. The instruction
        // comes from mpl-bubblegum rather than from us; see
        // `lib/solana/cnft-burn.ts`.
        const proof = proofs.get(asset.id);
        if (!asset.merkle || !proof) {
          skipped.push({
            id: asset.id,
            name: asset.name,
            reason:
              "Its merkle proof could not be fetched, so this leaf cannot be proven to be in its tree. Try again in a moment.",
          });
          continue;
        }

        // Remembered so a stale proof can be swapped for a fresh one without
        // re-deriving anything from the scan.
        cnftAssets.set(asset.id, asset);
        units.push(await cnftBurnUnit(asset, proof));
        // Deliberately no `rentByAsset` entry: a leaf is not an account, so
        // there is nothing to give back.
        continue;
      }

      if (verdict.route === "pnft") {
        // A pNFT's own token record decides whether this is possible at all —
        // see the pre-pass above.
        const state = pnftStates.get(asset.id);
        if (state?.locked) {
          skipped.push({
            id: asset.id,
            name: asset.name,
            reason:
              "Locked or listed for sale, so only the current delegate can move it. Delist or unlock it first.",
          });
          continue;
        }


        // A printed edition (standard 5) needs its *master edition's* accounts:
        // the master mint, its token account, the edition marker. The builder
        // derives none of them, because a print's own mint has no master edition
        // — so it derives an account that is not the right one, which Token
        // Metadata rejects with `InvalidEditionKey` (6).
        //
        // That is not a theory: a real print hit exactly this on mainnet, which
        // is why this refuses with a reason instead of trying. Deriving the
        // master accounts is the work that would lift it.
        if (state?.tokenStandard === 5) {
          skipped.push({
            id: asset.id,
            name: asset.name,
            reason:
              "This is a printed edition, and burning one needs its master edition's accounts, which this build does not send yet. Nothing was lost.",
          });
          continue;
        }

        // Token Metadata's own burn, which closes the token account and the
        // token record together — a plain SPL burn would leave the record
        // behind. See `lib/solana/pnft-burn.ts`. The token standard comes from
        // the asset's metadata, read in the pass above: the index calls a pNFT
        // and a printed edition of one by the same name, and they are not the
        // same instruction.
        const instruction = await buildPnftBurnInstruction({
          mint: asset.id,
          owner: owner.toBase58(),
          tokenAccount: asset.tokenAccount as string,
          collection: asset.collection?.address ?? null,
          tokenStandard: state?.tokenStandard ?? 4,
        });
        units.push({
          mint: asset.id,
          instructions: [instruction],
          rentReclaim: true,
        });
        // A pNFT is an SPL token underneath, so closing it returns the token
        // account's rent exactly as an SPL NFT's does.
        rentByAsset[asset.id] = rent.tokenAccount;
        continue;
      }

      if (verdict.route === "core") {
        // Core: the asset account is closed by the Core program itself, so
        // there is nothing to burn-then-close. The instruction comes from
        // mpl-core rather than from us — see `lib/solana/core-burn.ts`.
        const instruction = await buildCoreBurnInstruction({
          asset: asset.id,
          collection: asset.collection?.address ?? null,
          owner: owner.toBase58(),
        });
        units.push({
          mint: asset.id,
          instructions: [instruction],
          rentReclaim: true,
        });
        coreMints.push(asset.id);
        continue;
      }

      const mint = new PublicKey(asset.id);
      const account = new PublicKey(asset.tokenAccount as string);
      const tokenProgram = tokenProgramFor(asset.program);

      /**
       * Token Metadata's own burn first, because it closes the **metadata** and
       * **master edition** accounts as well as the token account.
       *
       * Those are the accounts a wallet's index reads to describe the NFT, so a
       * plain SPL burn leaves the asset describable — which is what "it still
       * shows up after I burned it" turns out to be. They also hold more rent
       * than the token account does: on the NFT measured, 3,733,800 and
       * 1,030,080 lamports against the token account's 2,039,280.
       *
       * If it cannot be built, the SPL burn still burns the token and returns
       * the token account's rent, so the row warns rather than refusing. It is a
       * weaker burn, and it is reported as one.
       */
      let instructions: TransactionInstruction[];
      const metadataPda = findMetadataPda(mint);
      const editionPda = findMasterEditionPda(mint);

      try {
        instructions = [
          await buildNftBurnInstruction({
            mint: asset.id,
            owner: owner.toBase58(),
            tokenAccount: asset.tokenAccount as string,
            collection: asset.collection?.address ?? null,
            program: asset.program,
          }),
        ];
        // The three accounts this burn closes, so its reclaim can be priced from
        // what they actually hold rather than from a rent constant.
        closedAccounts.set(asset.id, [account, metadataPda, editionPda]);
      } catch (error) {
        warnings.push(
          `${asset.name}: burned the token only — the metadata account could not be closed (${
            error instanceof Error ? error.message : "builder failed"
          }). The NFT may keep appearing in wallets.`,
        );
        instructions = [
          // Burn first: `closeAccount` refuses to run on a non-empty account,
          // and for a 0-decimal mint one unit is the entire supply.
          createBurnInstruction(account, mint, owner, 1n, [], tokenProgram),
          // The close must use the mint's own program — a Token-2022 account
          // cannot be closed by the legacy Token program.
          createCloseAccountInstruction(account, owner, tokenProgram),
        ];
        closedAccounts.set(asset.id, [account]);
      }

      units.push({ mint: asset.id, instructions, rentReclaim: true });
    } catch (error) {
      warnings.push(
        `Skipped ${asset.name}: ${
          error instanceof Error ? error.message : "could not build a burn."
        }`,
      );
    }
  }

  /**
   * Price each burn from the accounts it will actually close.
   *
   * Batched 100 keys at a time, which is the RPC's limit: a wallet with more
   * than 33 NFTs would exceed it in one call, and the whole read would fail
   * without saying why.
   */
  const closeKeys: Array<{ mint: string; key: PublicKey }> = [];
  for (const [mint, keys] of closedAccounts) {
    for (const key of keys) closeKeys.push({ mint, key });
  }

  for (let start = 0; start < closeKeys.length; start += 100) {
    const batch = closeKeys.slice(start, start + 100);
    try {
      const infos = await connection.getMultipleAccountsInfo(
        batch.map((entry) => entry.key),
      );
      batch.forEach((entry, index) => {
        const lamports = infos[index]?.lamports ?? 0;
        if (lamports > 0) {
          rentByAsset[entry.mint] = (rentByAsset[entry.mint] ?? 0) + lamports;
        }
      });
    } catch {
      // Left out of the estimate rather than guessed.
    }
  }

  // A Core burn returns whatever is locked in the asset account — and it keeps
  // back the rent of the one-byte husk Core leaves behind, because the burn
  // shrinks the account rather than closing it. Measured on mainnet at 655,320
  // lamports, which on a typical asset is a real slice of the reclaim: pricing
  // it as the full balance overstated every Core burn.
  if (coreMints.length > 0) {
    try {
      const infos = await connection.getMultipleAccountsInfo(
        coreMints.map((id) => new PublicKey(id)),
      );
      coreMints.forEach((id, index) => {
        const lamports = infos[index]?.lamports ?? 0;
        rentByAsset[id] = Math.max(0, lamports - rent.huskAccount);
      });
    } catch {
      // Left out of the estimate rather than guessed.
    }
  }

  if (units.length === 0) {
    throw new VoidError(
      "None of the selected NFTs can be burned.",
      skipped.length > 0
        ? "Each row on the tab says why."
        : "Rescan the wallet and try again.",
      warnings,
    );
  }

  const blockhashInfo = await connection.getLatestBlockhash("confirmed");
  const prologue = createComputeBudgetInstructions(
    COMPUTE_UNIT_LIMIT,
    PRIORITY_FEE_MICRO_LAMPORTS,
  );

  let packedResult = packTransactions({
    units,
    prologue,
    payer: owner,
    blockhash: blockhashInfo.blockhash,
    lookupTables,
  });

  for (const dropped of packedResult.dropped) {
    const asset = cnftAssets.get(dropped.mint);
    const proof = proofs.get(dropped.mint);
    const unit = units.find((entry) => entry.mint === dropped.mint);
    const lockCount = unit
      ? lockedAccountCount(unit.instructions, owner, lookupTables)
      : 0;
    const tooManyLocks = lockCount > MAX_LOCKED_ACCOUNTS_PER_TX;
    const canRescue =
      asset !== undefined &&
      proof !== undefined &&
      lookupTables.length === 0 &&
      !tooManyLocks;

    if (canRescue) {
      // Not a refusal: the proof is simply too long to send inline. The
      // executor has a lookup-table path for exactly this, so keep the asset
      // pending instead of reporting it as burned or skipped.
      lookupTableAssets.set(asset.id, asset);
      continue;
    }

    // A cNFT that still does not fit with a lookup table is a real refusal. Say
    // so on its row rather than leaving it in a warning the user has to connect
    // back to an asset.
    if (asset) {
      const reason = tooManyLocks
        ? `This burn locks ${lockCount} accounts, over the ${MAX_LOCKED_ACCOUNTS_PER_TX}-account transaction limit. A lookup table reduces bytes but not account locks, so this cNFT needs to be split into a smaller burn.`
        : proof && lookupTables.length > 0
          ? `This tree's ${proof.proof.length}-account proof still did not fit with a lookup table. Rescan and try again.`
          : "This burn needs more accounts than a single transaction allows.";
      skipped.push({ id: asset.id, name: asset.name, reason });
    } else {
      // A non-cNFT drop is a genuine size or instruction limit, not a canopy
      // problem. Keep the packer's own explanation. cNFT drops already have a
      // row-level reason in `skipped`; repeating them here made the warning
      // count look like a count of assets.
      const proofNote =
        proof && lookupTables.length === 0
          ? `this tree's canopy leaves a ${proof.proof.length}-account merkle proof, and that will not fit in one transaction (the packed budget is ${CNFT_INLINE_PROOF_BUDGET_BYTES} bytes)`
          : dropped.reason;
      warnings.push(`Skipped ${dropped.mint.slice(0, 6)}…: ${proofNote}`);
    }
  }

  if (packedResult.transactions.length === 0 && lookupTableAssets.size === 0) {
    throw new VoidError(
      "None of the selected NFTs can be burned.",
      skipped[0]?.reason ?? "Rescan the wallet and try again.",
      warnings,
    );
  }

  let simulations = await simulateAll(connection, packedResult.transactions);

  // ── One retry for a proof that went stale while we were building ──────────
  // A leaf's proof must match its tree's root at the moment the program runs.
  // On a tree someone is actively minting into, the root moves every few
  // seconds — so a proof can be correct when fetched and stale by simulation.
  // That is a race, not a mistake, and handing it to the user as a failure is
  // giving up on something we can simply fix: fetch a fresh proof and try again.
  //
  // Retried on *any* cNFT simulation failure rather than by matching an error
  // string, because the failure modes share that one cause and a bounded retry
  // costs one round trip. Anything still failing after this is reported as
  // before, so nothing is hidden.
  for (let attempt = 0; attempt < 1; attempt += 1) {
    const failedCnfts = [
      ...new Set(
        packedResult.transactions.flatMap((transaction, index) =>
          simulations[index]?.ok === false
            ? transaction.mints.filter((mint) => cnftAssets.has(mint))
            : [],
        ),
      ),
    ];
    if (failedCnfts.length === 0) break;

    const refreshed = await fetchCnftProofs(failedCnfts);
    if (refreshed.size === 0) break;

    const tableAddresses = lookupTableAddresses(lookupTables);
    let rebuilt = 0;
    for (const unit of units) {
      const asset = cnftAssets.get(unit.mint);
      const proof = refreshed.get(unit.mint);
      if (!asset || !proof) continue;
      // A refreshed proof can contain sibling hashes the lookup table was not
      // built with. Rebuilding a *table-dependent* burn from it would compile
      // those nodes inline and can push it back over the limit, so leave the old
      // proof in place and let the simulation report the stale-root failure
      // honestly. A burn that never used the table has short enough a proof to
      // rebuild normally; skipping it would turn a routine stale-root retry into
      // a permanent failure just because another asset in the batch needed one.
      const previousProof = proofs.get(unit.mint);
      const dependsOnTable =
        previousProof !== undefined &&
        previousProof.proof.length > 0 &&
        previousProof.proof.every((node) => tableAddresses.has(node));
      if (
        lookupTables.length > 0 &&
        dependsOnTable &&
        !proofUsesOnlyTableAddresses(proof, tableAddresses)
      ) {
        continue;
      }
      unit.instructions = (await cnftBurnUnit(asset, proof)).instructions;
      // Kept in step with what was actually built, so the size explanation for a
      // dropped unit describes the proof we ended up using.
      proofs.set(unit.mint, proof);
      rebuilt += 1;
    }
    if (rebuilt === 0) break;

    packedResult = packTransactions({
      units,
      prologue,
      payer: owner,
      blockhash: blockhashInfo.blockhash,
      lookupTables,
    });
    simulations = await simulateAll(connection, packedResult.transactions);
  }

  // ── The audit: what is about to be signed ────────────────────────────────
  // Burns are the one flow whose instructions come from builders this app does
  // not own (Token Metadata, Bubblegum, Core), so the check that matters most
  // here is that the wallet is named by every burn, and that no rental refund
  // goes anywhere but back to it. No SOL fee is charged on this flow at all.
  auditPlanBeforeSigning({
    prologue,
    units,
    packed: packedResult.transactions,
    expected: {
      flow: "void",
      owner: owner.toBase58(),
      feeWallet: null,
      expectedFeeLamports: 0,
    },
  });

  const hasFailures = simulations.some((simulation) => !simulation.ok);

  if (
    packedResult.transactions.length > 0 &&
    simulations.every((simulation) => !simulation.ok)
  ) {
    const firstError = simulations.find((simulation) => !simulation.ok);
    throw new VoidError(
      firstError?.error ?? "Every burn failed to simulate.",
      "Nothing was signed or sent. Rescan the wallet and try again.",
      warnings,
    );
  }

  const priorityFee = Math.ceil(
    (COMPUTE_UNIT_LIMIT * PRIORITY_FEE_MICRO_LAMPORTS) / 1_000_000,
  );
  const closedMints = new Set(
    packedResult.transactions.flatMap(
      (transaction) => transaction.rentReclaimMints,
    ),
  );

  return {
    packed: packedResult.transactions,
    simulations,
    warnings,
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
    estimatedFeeLamports:
      packedResult.transactions.length * (BASE_FEE_LAMPORTS + priorityFee),
    // Summed per asset, because a Core burn returns a different amount from an
    // SPL one and a batch can contain both.
    estimatedRentReclaimLamports: [...closedMints].reduce(
      (sum, mint) => sum + (rentByAsset[mint] ?? 0),
      0,
    ),
    rentByAsset,
    skipped,
    hasFailures,
    lookupTableAssets: [...lookupTableAssets.values()],
    repackInput: {
      units,
      prologue,
      payer: owner,
      lookupTables,
    },
  };
}

/**
 * The same burns, packed against a fresh blockhash.
 *
 * Not a re-plan: the instructions — and so the merkle proofs they carry — are
 * unchanged, which matters because re-planning mid-run would change what the
 * user approved. It exists so each approval can start with a live window when
 * the wallet asks once per transaction.
 */
export async function refreshNftBurnBlockhash(
  connection: Connection,
  result: PlanNftBurnResult,
): Promise<{
  packed: PackedTransaction[];
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  const blockhashInfo = await connection.getLatestBlockhash("confirmed");

  const repacked = packTransactions({
    ...result.repackInput,
    blockhash: blockhashInfo.blockhash,
  });

  if (repacked.transactions.length === 0) {
    throw new VoidError(
      "The burns could not be rebuilt against a fresh blockhash.",
      "Nothing further was sent. Run the preview again.",
      [],
    );
  }

  return {
    packed: repacked.transactions,
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
  };
}

/** Every address the supplied tables can compress, as a lookup set. */
function lookupTableAddresses(
  lookupTables: AddressLookupTableAccount[],
): Set<string> {
  return new Set(
    lookupTables.flatMap((table) =>
      table.state.addresses.map((address) => address.toBase58()),
    ),
  );
}

/**
 * True when every node of a proof is already in one of the tables.
 *
 * Used by the stale-proof retry: a table is built from one proof snapshot, and
 * a newer proof may name sibling hashes that are not in it. Rebuilding with
 * those nodes would put them back inline, so the retry is skipped rather than
 * quietly undoing the compression.
 */
function proofUsesOnlyTableAddresses(
  proof: CnftProof,
  tableAddresses: Set<string>,
): boolean {
  return proof.proof.every((node) => tableAddresses.has(node));
}
