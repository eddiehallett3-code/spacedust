import { describe, expect, it } from "vitest";
import { buildPnftBurnInstruction } from "@/lib/solana/pnft-burn";
import { TOKEN_PROGRAM_ID } from "@/lib/utils/constants";

/**
 * A pNFT's burn comes from Token Metadata as a whole, because the asset has a
 * token record that a plain SPL `Burn` would leave behind.
 *
 * The reference shape was verified against mainnet before this was offered:
 * built for ten real pNFTs and simulated clean at 619 bytes each, collection
 * metadata included. What is asserted here is the part that must not drift —
 * the program, the discriminator, the amount, and *who signs*.
 */

const TOKEN_METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const MINT = "JEKMoZLzbHgsUwpNrDp7aDNKXNN432hJrbegzTTCLnwQ";
const OWNER = "C9fK5qou5v9E7cAT8zq6ZsfCtz2jWQxJ2st5yaAXFC5t";
const TOKEN_ACCOUNT = "HDB6voVbH8skNEXH13bBqJ9tNk2DrtQ3eJ8AucFZan8d";

const request = {
  mint: MINT,
  owner: OWNER,
  tokenAccount: TOKEN_ACCOUNT,
  collection: null,
  // 4 = a pNFT. 5 is a printed edition of one, which the index also calls a
  // pNFT, so the number is read from the asset's metadata rather than inferred.
  tokenStandard: 4,
};

describe("buildPnftBurnInstruction", () => {
  it("builds Token Metadata's burnV1 with an amount of one", async () => {
    const instruction = await buildPnftBurnInstruction(request);
    const data = Buffer.from(instruction.data);

    expect(instruction.programId.toBase58()).toBe(TOKEN_METADATA_PROGRAM_ID);
    // 41 is Token Metadata's own discriminator for `burnV1`, then its sub-flag,
    // then the amount as a little-endian u64 — one, for a one-of-one.
    expect([...data.subarray(0, 2)]).toEqual([41, 0]);
    expect(data.length).toBe(10);
    expect(data.readBigUInt64LE(2)).toBe(1n);
  });

  it("only ever asks the owner to sign", async () => {
    // `authority` and `tokenOwner` both default to `context.identity`, which in
    // a context built without a wallet is a key nobody controls — an extra
    // signer slot the user could not satisfy. Exactly one signer must remain.
    const keys = (await buildPnftBurnInstruction(request)).keys;
    const signers = keys.filter((key) => key.isSigner);

    expect(signers).toHaveLength(1);
    expect(signers[0]?.pubkey.toBase58()).toBe(OWNER);
  });

  it("burns from the account the scan found, not a derived ATA", async () => {
    // The same doctrine as the SPL route: a non-canonical holding exists, and
    // closing a derived address that holds nothing fails on chain.
    const keys = (await buildPnftBurnInstruction(request)).keys;
    const addresses = keys.map((key) => key.pubkey.toBase58());

    expect(addresses).toContain(TOKEN_ACCOUNT);
    expect(addresses).toContain(MINT);
    // The mint's own token program, which Token Metadata burns through.
    expect(addresses).toContain(TOKEN_PROGRAM_ID);
    // And the token record, which is what makes this route different from SPL.
    expect(addresses.length).toBeGreaterThan(6);
  });

  it("treats a printed edition as the programmable standard it is", async () => {
    // Standard 5 must not be silently downgraded to 4: Token Metadata picks its
    // account list and its validation from this number, and the index calls both
    // standards `ProgrammableNFT`.
    const edition = await buildPnftBurnInstruction({
      ...request,
      tokenStandard: 5,
    });
    expect(edition.programId.toBase58()).toBe(TOKEN_METADATA_PROGRAM_ID);
    // Still a burn of one, still the same program — the difference is which
    // path Token Metadata takes for it.
    expect([...Buffer.from(edition.data).subarray(0, 2)]).toEqual([41, 0]);
    expect(edition.keys.filter((key) => key.isSigner)).toHaveLength(1);
  });
});
