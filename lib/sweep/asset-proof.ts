/**
 * Merkle proofs for cNFT burns.
 *
 * The proof comes from an indexer, through our own route, so the Helius key
 * stays on the server — the same reason the wallet scan does.
 *
 * Fetched at plan time and never cached or carried over from the scan: a proof
 * is only valid against the tree's current root, and a tree can gain a leaf at
 * any moment. An old proof is worse than none, because it produces a
 * transaction that encodes correctly and is rejected on chain.
 */
export interface CnftProof {
  /** The tree's root, as of when the indexer computed this proof. */
  root: string;
  /** Sibling hashes connecting the leaf to that root. */
  proof: string[];
}

/**
 * Proofs for the given assets, keyed by asset id.
 *
 * Assets the indexer cannot answer for are simply absent from the map, which
 * callers must treat as "cannot move this one" — with a reason — rather than as
 * a failure of the whole plan.
 *
 * Batched, because the route caps a request at 25 ids and a send can select more
 * cNFTs than that. Without this the route would answer 400 and *every* leaf in the
 * batch would be refused, which reads as "the indexer is down" rather than "you
 * picked too many".
 */
export async function fetchCnftProofs(
  ids: string[],
): Promise<Map<string, CnftProof>> {
  const proofs = new Map<string, CnftProof>();
  if (ids.length === 0) return proofs;

  /** Matches `MAX_IDS` in `app/api/asset-proof/route.ts`. */
  const BATCH = 25;

  for (let start = 0; start < ids.length; start += BATCH) {
    const batch = ids.slice(start, start + BATCH);
    try {
      const response = await fetch("/api/asset-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: batch }),
      });
      if (!response.ok) continue;

      const body = (await response.json()) as {
        proofs?: Record<string, CnftProof>;
      };

      for (const [id, proof] of Object.entries(body.proofs ?? {})) {
        if (typeof proof?.root === "string" && Array.isArray(proof.proof)) {
          proofs.set(id, { root: proof.root, proof: proof.proof });
        }
      }
    } catch {
      // A failed batch leaves its own leaves refused, each with a reason, rather
      // than stopping a plan that also holds SPL and Core assets.
    }
  }

  return proofs;
}
