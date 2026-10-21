import { beforeEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import {
  AddressLookupTableAccount,
  PublicKey,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";

// Simulating needs the network; it is the only part we replace. Everything that
// builds and packs the transaction — the part whose failure mode is destroying
// an asset — stays real.
//
// Stateful, and via `vi.hoisted` because `vi.mock` is hoisted above the imports:
// the retry under test depends on a simulation failing and then succeeding, and
// on a second proof differing from the first.
const mocked = vi.hoisted(() => ({
  /** How many simulations to fail before succeeding. Zero by default. */
  simulateFails: 0,
  /** Proofs handed out by `fetchCnftProofs`, one per call. */
  proofs: [] as Array<{ root: string; proof: string[] }>,
  /** When true, Token Metadata's burn builder throws, to exercise the fallback. */
  nftBuilderFails: false,
}));

vi.mock("@/lib/solana/simulate", () => ({
  simulateAll: vi.fn(async (_connection: unknown, transactions: unknown[]) => {
    const failing = mocked.simulateFails > 0;
    if (failing) mocked.simulateFails -= 1;
    return transactions.map(() =>
      failing
        ? { ok: false, feeLamports: null, error: "the merkle tree changed" }
        : { ok: true, feeLamports: 5_000, error: null },
    );
  }),
}));

vi.mock("@/lib/sweep/asset-proof", () => ({
  fetchCnftProofs: vi.fn(async (ids: string[]) => {
    const next = mocked.proofs.shift();
    return next ? new Map(ids.map((id) => [id, next])) : new Map();
  }),
}));

/**
 * The Token Metadata burn builder, wrapped rather than replaced.
 *
 * The plan takes the Token Metadata route for a plain NFT and falls back to an
 * SPL burn when that builder cannot produce one — a weaker burn that leaves the
 * metadata account alive, which the row has to report. The fallback only fires
 * on a builder failure, so the only way to exercise it is to make one happen.
 * The PDAs the plan uses for pricing stay real, which is why this wraps the
 * original module instead of stubbing it.
 */
vi.mock("@/lib/solana/nft-burn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/solana/nft-burn")>();
  return {
    ...actual,
    buildNftBurnInstruction: vi.fn(async (request: unknown) => {
      if (mocked.nftBuilderFails) {
        throw new Error("mpl-token-metadata built no instruction for this asset.");
      }
      return actual.buildNftBurnInstruction(
        request as Parameters<typeof actual.buildNftBurnInstruction>[0],
      );
    }),
  };
});

import { MPL_CORE_PROGRAM_ID } from "@metaplex-foundation/mpl-core";
import { planNftBurn } from "@/lib/sweep/plan-nft-burn";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@/lib/utils/constants";
import type { NonFungibleAsset } from "@/types/token";

/** Token Metadata owns the metadata and master edition accounts. */
const TOKEN_METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
/** The prologue every packed transaction carries. */
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
/** Bubblegum burns a cNFT's leaf; read from the installed SDK, not from memory. */
const BUBBLEGUM_PROGRAM_ID = "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY";
/** A compressed asset, and the tree its leaf lives in. */
const CNFT = "HhWaxhccnjuaFgUU2NGsSKQZ7j7mYFwoHYaJFFa3z899";
const CNFT_TREE = "7MHNupVw45KV1JG3HxPPqUnCJoLzFxt3THMJsLjJRerz";

/** The metadata and master edition PDAs for a mint, derived independently here. */
function tokenMetadataPdas(mint: string) {
  const program = new PublicKey(TOKEN_METADATA_PROGRAM_ID);
  const seed = [
    Buffer.from("metadata"),
    program.toBuffer(),
    new PublicKey(mint).toBuffer(),
  ];
  return {
    metadata: PublicKey.findProgramAddressSync(seed, program)[0].toBase58(),
    edition: PublicKey.findProgramAddressSync(
      [...seed, Buffer.from("edition")],
      program,
    )[0].toBase58(),
  };
}

const OWNER = "C9fK5qou5v9E7cAT8zq6ZsfCtz2jWQxJ2st5yaAXFC5t";
const MINT = "JEKMoZLzbHgsUwpNrDp7aDNKXNN432hJrbegzTTCLnwQ";
const TOKEN_ACCOUNT = "HDB6voVbH8skNEXH13bBqJ9tNk2DrtQ3eJ8AucFZan8d";

const asset: NonFungibleAsset = {
  id: MINT,
  name: "Pixel Guild - Golden Key",
  imageUri: null,
  imageMime: null,
  collection: null,
  compressed: false,
  interface: "V1_NFT",
  tokenAccount: TOKEN_ACCOUNT,
  program: "legacy",
  frozen: false,
  merkle: null,
  delegate: null,
};

function fakeConnection(): Connection {
  return {
    getLatestBlockhash: async () => ({
      // 32 zero bytes: valid base58, so the message compiles.
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 1,
    }),
    getMinimumBalanceForRentExemption: async (size: number) =>
      size === 165 ? 1_488_440 : 650_240,
    // A Core burn returns whatever the asset account holds, so the planner reads
    // it rather than assuming the token-account rent.
    getMultipleAccountsInfo: async (keys: unknown[]) =>
      keys.map(() => ({ lamports: 3_000_000 })),
  } as unknown as Connection;
}

/** The single transaction a one-asset plan produces. */
function onlyTx(plan: { packed: Array<{ base64: string }> }): string {
  const first = plan.packed[0];
  if (!first) throw new Error("expected exactly one packed transaction");
  return first.base64;
}

/** Decode a packed transaction into the shape a reviewer needs to see. */
function decode(base64: string) {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  const keys = tx.message.staticAccountKeys;
  return tx.message.compiledInstructions.map((ix) => {
    const program = keys[ix.programIdIndex];
    if (!program) throw new Error("instruction references a missing key");
    return {
      program: program.toBase58(),
      // SPL Token: 0x08 = Burn, 0x09 = CloseAccount.
      opcode: Buffer.from(ix.data).toString("hex").slice(0, 2),
      accounts: Array.from(ix.accountKeyIndexes).map((index) => {
        const key = keys[index];
        if (!key) throw new Error("account index out of range");
        return key.toBase58();
      }),
    };
  });
}

/**
 * A leaf's proof must match its tree's root at the moment the program runs, and
 * a tree someone is minting into moves that root every few seconds. That race
 * reached a user twice as "the merkle tree changed since the preview was built"
 * — accurate, and still a failure we can fix rather than report.
 */
describe("planNftBurn and a stale cNFT proof", () => {
  const FIRST_ROOT = "ENZ5LNawYGdiYRzmeHpXVCRUbydgAKuD8aHVF5eyfBKm";
  const SECOND_ROOT = "6rEiStD8xp5Y3VPt4t85hKaz3eBH6Jud5auJ3KSYzpn3";

  const cnft: NonFungibleAsset = {
    ...asset,
    id: "HhWaxhccnjuaFgUU2NGsSKQZ7j7mYFwoHYaJFFa3z899",
    name: "Mask",
    compressed: true,
    tokenAccount: null,
    interface: "V1_NFT",
    merkle: {
      tree: "7MHNupVw45KV1JG3HxPPqUnCJoLzFxt3THMJsLjJRerz",
      leafId: 1172,
      dataHash: "3eNTexmWmu1cEYKhCsoXDCZJRSvgdujR1RQDGVa3t8H9",
      creatorHash: "98UuRrUaTrQF5gQocbrabinCDqmPh2UeyF9t7GwzNVCK",
      assetDataHash: null,
      flags: null,
    },
  };

  beforeEach(() => {
    mocked.simulateFails = 0;
    mocked.proofs = [];
    mocked.nftBuilderFails = false;
  });

  it("fetches a fresh proof and rebuilds, rather than reporting the race", async () => {
    mocked.proofs = [
      { root: FIRST_ROOT, proof: ["9AtiDDT8GDDs5NpSBEgCrFrbPV4atve4CDVJZ6xeFwdR"] },
      { root: SECOND_ROOT, proof: ["AtZYkS9LiQeryQbMxP2Qg5YyrGFcFnHc5jvBLFy6Qvfc"] },
    ];
    // The first simulation loses the race, the retry wins it.
    mocked.simulateFails = 1;

    const plan = await planNftBurn({
      connection: fakeConnection(),
      owner: new PublicKey(OWNER),
      assets: [cnft],
    });

    expect(plan.simulations.every((simulation) => simulation.ok)).toBe(true);

    // And the transaction carries the *second* root — the one that survived.
    const [instruction] = decode(onlyTx(plan)).filter(
      (ix) => ix.program === "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY",
    );
    expect(instruction).toBeDefined();
    // And it carries the *second* root — the one that survived.
    expect(bs58.encode(cnftData(onlyTx(plan)).subarray(8, 40))).toBe(SECOND_ROOT);
  });

  it("still retries a burn whose proof never needed the lookup table", async () => {
    const FIRST_NODE = "9AtiDDT8GDDs5NpSBEgCrFrbPV4atve4CDVJZ6xeFwdR";
    const SECOND_NODE = "AtZYkS9LiQeryQbMxP2Qg5YyrGFcFnHc5jvBLFy6Qvfc";
    mocked.proofs = [{ root: SECOND_ROOT, proof: [SECOND_NODE] }];
    mocked.simulateFails = 1;

    // The table belongs to another asset in the batch. This leaf's short proof
    // fits inline, so a stale-root retry must rebuild it instead of skipping it
    // just because a lookup table happens to be present.
    const table = new AddressLookupTableAccount({
      key: new PublicKey(bs58.encode(Buffer.alloc(32, 77))),
      state: {
        deactivationSlot: BigInt("0xffffffffffffffff"),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: new PublicKey(OWNER),
        addresses: [],
      },
    });

    const plan = await planNftBurn({
      connection: fakeConnection(),
      owner: new PublicKey(OWNER),
      assets: [cnft],
      proofs: new Map([
        [cnft.id, { root: FIRST_ROOT, proof: [FIRST_NODE] }],
      ]),
      lookupTables: [table],
    });

    expect(plan.simulations.every((simulation) => simulation.ok)).toBe(true);
    expect(bs58.encode(cnftData(onlyTx(plan)).subarray(8, 40))).toBe(SECOND_ROOT);
  });

  it("does not retry when nothing cNFT-shaped failed", async () => {
    mocked.proofs = [
      { root: FIRST_ROOT, proof: ["9AtiDDT8GDDs5NpSBEgCrFrbPV4atve4CDVJZ6xeFwdR"] },
      { root: SECOND_ROOT, proof: ["AtZYkS9LiQeryQbMxP2Qg5YyrGFcFnHc5jvBLFy6Qvfc"] },
    ];

    const plan = await planNftBurn({
      connection: fakeConnection(),
      owner: new PublicKey(OWNER),
      assets: [cnft],
    });

    const [instruction] = decode(onlyTx(plan)).filter(
      (ix) => ix.program === "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY",
    );
    expect(instruction).toBeDefined();
    // The first proof, untouched: one fetch, no second attempt.
    expect(bs58.encode(cnftData(onlyTx(plan)).subarray(8, 40))).toBe(FIRST_ROOT);
    // The second proof is still in the queue, unspent.
    expect(mocked.proofs).toHaveLength(1);
  });
});

/**
 * The Bubblegum instruction's data, out of a packed plan.
 *
 * `decode` above is deliberately thin — program, opcode, accounts — so this
 * reaches for the bytes the assertion is actually about.
 */
function cnftData(base64: string): Buffer {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  const instruction = tx.message.compiledInstructions.find((candidate) => {
    const program = tx.message.staticAccountKeys[candidate.programIdIndex];
    return program?.toBase58() === "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY";
  });
  if (!instruction) throw new Error("no Bubblegum instruction in the plan");
  return Buffer.from(instruction.data);
}

describe("planNftBurn", () => {
  it("burns a plain NFT through Token Metadata, so the metadata is closed too", async () => {
    const plan = await planNftBurn({
      connection: fakeConnection(),
      owner: new PublicKey(OWNER),
      assets: [asset],
    });

    expect(plan.packed).toHaveLength(1);
    const instructions = decode(onlyTx(plan)).filter(
      (ix) => ix.program !== COMPUTE_BUDGET,
    );

    // One instruction from Token Metadata — not the SPL Burn + CloseAccount pair
    // this used to build. That pair returned the token account's rent and left
    // the metadata account alive, which is the account an index describes the
    // NFT from, so the asset carried on being listed after it was burned.
    expect(instructions).toHaveLength(1);
    const [burn] = instructions;
    expect(burn?.program).toBe(TOKEN_METADATA_PROGRAM_ID);

    // Every account the burn closes is named explicitly. A missing one does not
    // fail to build — Metaplex resolves it to the instruction's own program id
    // and the program then refuses, measured as `Custom: 103`.
    const pdas = tokenMetadataPdas(MINT);
    expect(burn?.accounts).toContain(pdas.metadata);
    expect(burn?.accounts).toContain(pdas.edition);
    expect(burn?.accounts).toContain(MINT);
    expect(burn?.accounts).toContain(TOKEN_ACCOUNT);
    expect(burn?.accounts).toContain(OWNER);
  });

  it("names the mint's own token program inside the burn", async () => {
    const plan = await planNftBurn({
      connection: fakeConnection(),
      owner: new PublicKey(OWNER),
      assets: [{ ...asset, program: "token2022" }],
    });

    const [burn] = decode(onlyTx(plan)).filter(
      (ix) => ix.program !== COMPUTE_BUDGET,
    );

    // Token Metadata needs to be told which token program owns the accounts: a
    // Token-2022 account cannot be closed by the legacy Token program, and the
    // builder cannot tell them apart from the mint alone.
    expect(burn?.accounts).toContain(TOKEN_2022_PROGRAM_ID);
    expect(burn?.accounts).not.toContain(TOKEN_PROGRAM_ID);
  });

  it("falls back to the SPL burn, and says so, when Token Metadata cannot build one", async () => {
    mocked.nftBuilderFails = true;

    try {
      const plan = await planNftBurn({
        connection: fakeConnection(),
        owner: new PublicKey(OWNER),
        assets: [asset],
      });

      const spl = decode(onlyTx(plan)).filter(
        (ix) => ix.program === TOKEN_PROGRAM_ID,
      );
      // Burn then close, in that order: closeAccount refuses a non-empty
      // account.
      expect(spl.map((ix) => ix.opcode)).toEqual(["08", "09"]);

      // A weaker burn that leaves the asset describable has to be reported, not
      // performed quietly.
      expect(plan.warnings.join(" ")).toContain(
        "metadata account could not be closed",
      );
      // And the reclaim is priced from the one account this path closes.
      expect(plan.rentByAsset[asset.id]).toBe(3_000_000);
    } finally {
      // Cleared here rather than in a shared hook: the flag is module-level, and
      // leaving it set turned the next test's three-account burn into this one.
      mocked.nftBuilderFails = false;
    }
  });

  it("prices the rent from every account the burn closes, not a constant", async () => {
    const plan = await planNftBurn({
      connection: fakeConnection(),
      owner: new PublicKey(OWNER),
      assets: [asset],
    });

    // The stub answers 3,000,000 lamports per account, and a Token Metadata burn
    // closes three: the token account, the metadata and the master edition.
    expect(plan.rentByAsset[asset.id]).toBe(9_000_000);
    expect(plan.estimatedRentReclaimLamports).toBe(9_000_000);
    // The rent constant is what a single-account burn would have returned.
    expect(plan.estimatedRentReclaimLamports).not.toBe(1_488_440);
  });

  it("burns an NFT and a cNFT together, in one transaction", async () => {
    // One proof for the one cNFT in the batch — the plan fetches proofs for
    // exactly the leaves it is about to burn.
    mocked.proofs = [
      { root: "ENZ5LNawYGdiYRzmeHpXVCRUbydgAKuD8aHVF5eyfBKm", proof: ["9AtiDDT8GDDs5NpSBEgCrFrbPV4atve4CDVJZ6xeFwdR"] },
    ];

    try {
      const meta = tokenMetadataPdas(MINT);
      const plan = await planNftBurn({
        connection: fakeConnection(),
        owner: new PublicKey(OWNER),
        assets: [
          asset,
          {
            ...asset,
            id: CNFT,
            name: "Mask",
            compressed: true,
            tokenAccount: null,
            merkle: {
              tree: CNFT_TREE,
              leafId: 1172,
              dataHash: "3eNTexmWmu1cEYKhCsoXDCZJRSvgdujR1RQDGVa3t8H9",
              creatorHash: "98UuRrUaTrQF5gQocbrabinCDqmPh2UeyF9t7GwzNVCK",
              assetDataHash: null,
              flags: null,
            },
          },
        ],
      });

      expect(plan.skipped).toHaveLength(0);
      // One signature for both, which is the point: a selection that spans the
      // NFT and cNFT tabs is one batch, not two.
      expect(plan.packed).toHaveLength(1);

      const instructions = decode(onlyTx(plan)).filter(
        (ix) => ix.program !== COMPUTE_BUDGET,
      );
      expect(instructions.some((ix) => ix.program === TOKEN_METADATA_PROGRAM_ID)).toBe(true);
      const bubblegum = instructions.find((ix) => ix.program === BUBBLEGUM_PROGRAM_ID);
      expect(bubblegum, "no Bubblegum burn in the batch").toBeDefined();

      // And the two halves are really the ones expected: the metadata PDA for the
      // NFT, the merkle tree for the cNFT.
      expect(
        instructions.find((ix) => ix.program === TOKEN_METADATA_PROGRAM_ID)?.accounts,
      ).toContain(meta.metadata);
      expect(bubblegum?.accounts).toContain(CNFT_TREE);
    } finally {
      mocked.proofs = [];
    }
  });

  it("burns a Core asset through the Core program, priced from its own account", async () => {
    const plan = await planNftBurn({
      connection: fakeConnection(),
      owner: new PublicKey(OWNER),
      // A Core asset has no token account at all — that is the whole reason the
      // type check has to come before the account check.
      assets: [{ ...asset, interface: "MplCoreAsset", tokenAccount: null }],
    });

    expect(plan.skipped).toHaveLength(0);
    const [instruction] = decode(onlyTx(plan)).filter(
      (ix) => ix.program !== "ComputeBudget111111111111111111111111111111",
    );

    // Built by mpl-core, not encoded by us.
    expect(instruction?.program).toBe(MPL_CORE_PROGRAM_ID);
    // Discriminator 12 is Core's `Burn`; the trailing `00` is Option::None for
    // the compression proof.
    expect(instruction?.opcode).toBe("0c");
    expect(instruction?.accounts).toContain(asset.id);

    // And its rent is the asset account's balance, not the token-account rent.
    // Priced from the asset's own account, minus the one-byte husk Core leaves
    // behind: 3,000,000 − 650,240 (the fake's rent for a 1-byte account).
    expect(plan.rentByAsset[asset.id]).toBe(3_000_000 - 650_240);
    expect(plan.estimatedRentReclaimLamports).toBe(3_000_000 - 650_240);
  });

  it("reports what it refused instead of dropping it silently", async () => {
    const plan = await planNftBurn({
      connection: fakeConnection(),
      owner: new PublicKey(OWNER),
      assets: [asset, { ...asset, id: "P1", interface: "SomethingNew" }],
    });

    expect(plan.packed).toHaveLength(1);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]?.reason).toContain("Metaplex");
  });


  it("refuses to build anything when nothing is burnable", async () => {
    await expect(
      planNftBurn({
        connection: fakeConnection(),
        owner: new PublicKey(OWNER),
        assets: [{ ...asset, frozen: true }],
      }),
    ).rejects.toThrow(/None of the selected NFTs/);
  });
});

/**
 * A canopy-0 proof cannot fit inline. The planner must not lie about that: it
 * reports the asset as pending, not skipped, and produces no burn transaction
 * until the executor has created a lookup table. Passing the table back in is
 * what turns the same proof into a transaction that fits.
 */
describe("planNftBurn and a proof too long to send inline", () => {
  const CNFT_ID = "HhWaxhccnjuaFgUU2NGsSKQZ7j7mYFwoHYaJFFa3z899";
  const ROOT = "ENZ5LNawYGdiYRzmeHpXVCRUbydgAKuD8aHVF5eyfBKm";
  const proof = Array.from({ length: 24 }, (_, index) =>
    bs58.encode(Buffer.alloc(32, 200 + index)),
  );

  const cnft: NonFungibleAsset = {
    ...asset,
    id: CNFT_ID,
    name: "Deep Leaf",
    compressed: true,
    tokenAccount: null,
    interface: "V1_NFT",
    merkle: {
      tree: CNFT_TREE,
      leafId: 42,
      dataHash: "3eNTexmWmu1cEYKhCsoXDCZJRSvgdujR1RQDGVa3t8H9",
      creatorHash: "98UuRrUaTrQF5gQocbrabinCDqmPh2UeyF9t7GwzNVCK",
      assetDataHash: null,
      flags: null,
    },
  };

  beforeEach(() => {
    mocked.simulateFails = 0;
    mocked.proofs = [];
    mocked.nftBuilderFails = false;
  });

  it("keeps the leaf pending instead of refusing it", async () => {
    mocked.proofs = [{ root: ROOT, proof }];

    const plan = await planNftBurn({
      connection: fakeConnection(),
      owner: new PublicKey(OWNER),
      assets: [cnft],
    });

    expect(plan.packed).toHaveLength(0);
    expect(plan.lookupTableAssets.map((entry) => entry.id)).toEqual([CNFT_ID]);
    expect(plan.skipped).toHaveLength(0);
    // The lookup-table notice is derived from `lookupTableAssets` by the UI. It
    // must not also be a warning: the warning list is counted as skipped units,
    // so one summary string used to render as "1 token skipped".
    expect(plan.warnings).toHaveLength(0);
  });

  it("fits the same proof once a lookup table is supplied", async () => {
    const table = new AddressLookupTableAccount({
      key: new PublicKey(
        bs58.encode(Buffer.alloc(32, 111)),
      ),
      state: {
        deactivationSlot: BigInt("0xffffffffffffffff"),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: new PublicKey(OWNER),
        addresses: proof.map((node) => new PublicKey(node)),
      },
    });

    const plan = await planNftBurn({
      connection: fakeConnection(),
      owner: new PublicKey(OWNER),
      assets: [cnft],
      proofs: new Map([[CNFT_ID, { root: ROOT, proof }]]),
      lookupTables: [table],
    });

    expect(plan.lookupTableAssets).toHaveLength(0);
    expect(plan.packed).toHaveLength(1);
    // The whole point: the lookup-table form is comfortably below the wire
    // limit, while the same proof inline was not.
    expect(plan.packed[0]?.sizeBytes).toBeLessThan(900);
  });
});
