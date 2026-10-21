import { NextResponse } from "next/server";
import { allowRequest, rateLimitResponse } from "@/lib/api/rate-limit";
import { z } from "zod";
import { MissingEnvError } from "@/lib/config/env";
import { listWrappedSolAccounts } from "@/lib/token-source/wrapped-sol.server";
import { isValidSolanaAddress } from "@/lib/utils/sanitize";

/**
 * `GET /api/wrapped-sol?owner=<pubkey>` — the wallet's non-empty wSOL accounts.
 *
 * The read has to happen server-side: the browser never holds the Helius key.
 * It is kept separate from `/api/tokens` because it is a Pro-only Salvage
 * lookup, and adding it to every scan would make every dust sweep pay for a
 * read it never uses.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  owner: z
    .string()
    .refine(isValidSolanaAddress, { message: "Not a valid Solana address" }),
});

export async function GET(request: Request): Promise<NextResponse> {
  const quota = allowRequest(request, "wrapped-sol");
  if (!quota.allowed) return rateLimitResponse(quota);

  const parsed = QuerySchema.safeParse({
    owner: new URL(request.url).searchParams.get("owner"),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide a valid Solana wallet address." },
      { status: 400 },
    );
  }

  try {
    const accounts = await listWrappedSolAccounts(parsed.data.owner);
    return NextResponse.json({ accounts });
  } catch (error) {
    if (error instanceof MissingEnvError) {
      return NextResponse.json({ error: error.message }, { status: 424 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not read wrapped SOL accounts.",
      },
      { status: 502 },
    );
  }
}
