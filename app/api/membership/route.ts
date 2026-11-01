import { NextResponse } from "next/server";
import { z } from "zod";
import { allowRequest, rateLimitResponse } from "@/lib/api/rate-limit";
import { describeFailure } from "@/lib/api/redact";
import { isValidSolanaAddress } from "@/lib/utils/sanitize";
import { readHolderStatus } from "@/lib/fees/holder-membership.server";
import { unavailableStatus } from "@/lib/fees/holder-membership";

/**
 * `GET /api/membership?owner=<pubkey>` — does this wallet hold enough Turtles?
 *
 * Server-side because the Helius key never reaches the browser, and because the
 * answer decides a fee: a client that could compute it locally could also compute
 * it wrongly and skip a fee it owes.
 *
 * It answers a *count*, not a promise. Nothing here says "free forever" — the
 * client is expected to re-ask, and the five-minute cache in the reader is the
 * longest an old answer can survive.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  owner: z
    .string()
    .refine(isValidSolanaAddress, { message: "Not a valid Solana address" }),
});

export async function GET(request: Request): Promise<NextResponse> {
  const quota = allowRequest(request, "membership");
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
    const status = await readHolderStatus(parsed.data.owner);
    return NextResponse.json(status, {
      // Private: the answer is about one wallet, and a shared cache would hand it
      // to the next visitor.
      headers: { "cache-control": "private, max-age=60" },
    });
  } catch (error) {
    // A failed check is not a denial the user should see — the fee is simply not
    // waived and everything works. `entitled: false` with `held: 0` is the same
    // answer a non-holder gets, which keeps the client's rendering honest.
    return NextResponse.json(
      {
        error: describeFailure(error) || "Could not check holder status.",
        ...unavailableStatus(),
      },
      { status: 502 },
    );
  }
}
