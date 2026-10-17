import { PublicKey } from "@solana/web3.js";
import { getOwnerAta, tokenProgramFor } from "@/lib/solana/instructions";

/**
 * The mints a swap cannot reach.
 *
 * Jupiter's route drains the wallet's **associated** token account for the mint:
 * `/build` is given a `taker`, not a source account, so the swap acts on
 * `ATA(owner, mint)` and nothing else. A balance held in any other token account
 * — old airdrops and a few tools create those — would therefore move nothing, and
 * the transaction would fail on chain after costing fees.
 *
 * This matters because the scanners do not agree on which account to report. The
 * RPC scanner prefers the canonical ATA when one exists; the DAS scanner picks
 * the account with the largest balance, which can be a non-canonical one. Either
 * way, a reported account that is not the ATA is a balance a swap cannot drain.
 *
 * Reported rather than filtered: the row is still a real holding, and The Void
 * *can* take it (a burn acts on the account the scanner named). Callers turn this
 * into a refusal with that way out, which is the difference between "this token is
 * broken" and "this token belongs in the other tool".
 *
 * A `null` account is not in this set: the composer falls back to the derived ATA
 * for those, which is exactly the account a swap uses.
 */
export function nonCanonicalMints(
  owner: string,
  tokens: readonly {
    mint: string;
    program: "legacy" | "token2022";
    tokenAccount?: string | null;
  }[],
): Set<string> {
  const mints = new Set<string>();
  let ownerKey: PublicKey;
  try {
    ownerKey = new PublicKey(owner);
  } catch {
    // An owner that will not parse is refused by the caller's schema; there is
    // nothing sensible to attribute to an individual token here.
    return mints;
  }

  for (const token of tokens) {
    if (!token.tokenAccount) continue;
    try {
      // The program is part of the derivation: a Token-2022 mint's ATA is a
      // different address from the legacy one for the same mint and owner.
      const canonical = getOwnerAta(
        ownerKey,
        new PublicKey(token.mint),
        tokenProgramFor(token.program),
      ).toBase58();
      if (canonical !== token.tokenAccount) mints.add(token.mint);
    } catch {
      // A malformed mint is a schema problem, not a routing one.
    }
  }

  return mints;
}
