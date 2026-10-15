import { NextResponse } from "next/server";
import { z } from "zod";
import { allowRequest, rateLimitResponse } from "@/lib/api/rate-limit";
import { fetchAssetProof } from "@/lib/helius/das.server";
import { isValidSolanaAddress } from "@/lib/utils/sanitize";

/**
 * `POST /api/asset-proof` — `{ ids: string[] }` → `{ proofs: { <id>: { root, proof } } }`
 *
 * A compressed NFT's burn needs a merkle proof, and only an indexer can produce
 * one: it takes every other leaf in the tree. So this goes through the server
 * for the same reason the scan does — the Helius key stays private.
 *
 * Per-asset failures are omitted rather than failing the whole request. An asset
 * whose proof cannot be fetched is a row that explains itself, and burning a
 * cNFT must never take the SPL and Core assets in the same plan down with it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Burning is opt-in and one tick at a time; this is a sanity ceiling, not a target. */
const MAX_IDS = 25;
/** Concurrent indexer calls. Enough for a real batch, gentle on a free tier. */
const CONCURRENCY = 5;

const BodySchema = z.object({
  ids: z.array(z.string().refine(isValidSolanaAddress)).min(1).max(MAX_IDS),
});

export async function POST(request: Request) {
  // Proof fetches are a DAS call each, and the packed burn needs one per asset.
  const quota = allowRequest(request, "asset-proof");
  if (!quota.allowed) return rateLimitResponse(quota);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Expected a JSON body." },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Expected 1 to ${MAX_IDS} valid asset ids.` },
      { status: 400 },
    );
  }

  const ids = [...new Set(parsed.data.ids)];
  const proofs: Record<string, { root: string; proof: string[] }> = {};

  for (let start = 0; start < ids.length; start += CONCURRENCY) {
    const batch = ids.slice(start, start + CONCURRENCY);
    const fetched = await Promise.all(
      batch.map(async (id) => ({ id, proof: await fetchAssetProof(id) })),
    );
    for (const { id, proof } of fetched) {
      // `nodeIndex` is deliberately not forwarded: it is the leaf's position in
      // the tree's node array, not the index a burn takes, and the only reason
      // to send it would be to have it used by mistake.
      if (proof?.root && proof.proof.length > 0) {
        proofs[id] = { root: proof.root, proof: proof.proof };
      }
    }
  }

  return NextResponse.json({ proofs });
}
