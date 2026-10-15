import {
  PublicKey,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import { createBurnInstruction } from "@solana/spl-token";
import {
  BASE_FEE_LAMPORTS,
  COMPUTE_UNIT_LIMIT,
  MAX_TX_SIZE_BYTES,
  PRIORITY_FEE_MICRO_LAMPORTS,
} from "@/lib/utils/constants";
import {
  createCloseAccountInstruction,
  createComputeBudgetInstructions,
  tokenProgramFor,
} from "@/lib/solana/instructions";
import { packTransactions, type PackUnit } from "@/lib/solana/pack";
import { simulateAll } from "@/lib/solana/simulate";
import { fetchRentMinimums } from "@/lib/solana/rent";
import { buildCoreBurnInstruction } from "@/lib/solana/core-burn";
import { buildCnftBurnInstruction } from "@/lib/solana/cnft-burn";
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
 */
const SPL_BURNABLE_INTERFACES = new Set(["V1_NFT", "LEGACY_NFT", "V1_PRINT"]);

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
}

export async function planNftBurn(input: {
  connection: Connection;
  owner: PublicKey;
  assets: NonFungibleAsset[];
}): Promise<PlanNftBurnResult> {
  const { connection, owner, assets } = input;
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
  const proofs = await fetchCnftProofs(cnftIds);

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
    // Burns need no ALTs: every account is local to the asset being burned.
    lookupTables: [],
  });

  warnings.push(
    ...packedResult.dropped.map((dropped) => {
      // A cNFT whose proof pushes the transaction past the size limit is not a
      // fault to report but a limit to explain. The depth of its tree — not
      // anything about the asset — is what makes it unburnable here, and the
      // packer only knows the byte count, not the reason for it.
      const proof = proofs.get(dropped.mint);
      // The proof's *length* is the whole story: it is one account per node, and
      // a tree's proof is `depth - canopy`. A tree created with no canopy sends
      // every level as an account, which is what makes a burn that cannot fit;
      // an even deeper tree with a canopy burns fine. Metaplex's own guidance
      // pairs a depth-20 tree with canopy 13, i.e. a 7-node proof.
      return proof
        ? `Skipped ${dropped.mint.slice(0, 6)}…: this tree has no canopy, so its burn needs a ${proof.proof.length}-account merkle proof and will not fit in one transaction (the limit is ${MAX_TX_SIZE_BYTES} bytes).`
        : `Skipped ${dropped.mint.slice(0, 6)}…: ${dropped.reason}`;
    }),
  );

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

    let rebuilt = 0;
    for (const unit of units) {
      const asset = cnftAssets.get(unit.mint);
      const proof = refreshed.get(unit.mint);
      if (!asset || !proof) continue;
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
      lookupTables: [],
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

  if (simulations.every((simulation) => !simulation.ok)) {
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
  };
}
