import { NextResponse } from "next/server";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { allowRequest, rateLimitResponse } from "@/lib/api/rate-limit";
import { z } from "zod";
import { burnDomain } from "@bonfida/spl-name-service";
import { MissingEnvError } from "@/lib/config/env";
import { readSnsDomains } from "@/lib/salvage/sns.server";
import { isValidSolanaAddress } from "@/lib/utils/sanitize";
import type { ApiInstruction } from "@/types/jupiter";

/**
 * `GET /api/domains?owner=<pubkey>` — the `.sns` domains a wallet owns.
 * `POST /api/domains` — the burn instructions for the ones the user picked.
 *
 * **Why this is a route rather than a client call.** The SNS SDK lists a wallet's
 * domains with `connection.getProgramAccounts` on the name-service program, and
 * this app's RPC proxy refuses that method on purpose — it is absent from
 * `ALLOWED_METHODS` and the README explains why. So the lookup happens here, where
 * the Helius key already lives, which is the shape every other flow uses: the
 * browser talks to our own endpoints and never to a provider.
 *
 * **Why the instructions are built here too.** They are *not* hand-encoded. An SNS
 * name is burned by a program-specific instruction with a discriminator and a
 * fixed account list, and this codebase's rule is that such instructions come
 * from the package that owns them — never from a buffer we assembled ourselves.
 * Keeping the SDK server-side also keeps it out of the browser bundle.
 *
 * **Nothing is signed here.** The route reads, and returns instructions in the same
 * serialised shape Jupiter's arrive in, so the client can put them through
 * `apiToInstruction` — the one place instructions from outside the app are
 * validated before they can reach a transaction.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const OwnerSchema = z
  .string()
  .refine(isValidSolanaAddress, { message: "Not a valid Solana address" });

/**
 * One instruction, in the shape `apiToInstruction` expects.
 *
 * The same serialisation Jupiter's instructions already arrive in, so the client
 * has exactly one path for turning outside instructions into web3.js ones — and
 * that path validates every field before anything can be signed.
 */
function serializeInstruction(instruction: TransactionInstruction): ApiInstruction {
  return {
    programId: instruction.programId.toBase58(),
    accounts: instruction.keys.map((key) => ({
      pubkey: key.pubkey.toBase58(),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: Buffer.from(instruction.data).toString("base64"),
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  // The expensive half of this route: `getSnsDomainsForOwner` composes a
  // `getProgramAccounts` lookup with a batched reverse lookup. The POST beside it
  // is deliberately *not* metered — it serialises delete instructions locally and
  // touches no provider, so charging it against a budget would only get in a
  // user's way.
  const quota = allowRequest(request, "domains");
  if (!quota.allowed) return rateLimitResponse(quota);

  const owner = new URL(request.url).searchParams.get("owner") ?? "";
  const parsed = OwnerSchema.safeParse(owner);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide a valid Solana wallet address" },
      { status: 400 },
    );
  }

  try {
    // "We could not look" and "there are none" are different answers, and only
    // one of them is safe to render as an empty list — a rule this app applies
    // to every lookup. A failed call throws here and becomes a 502, never an
    // empty result.
    const result = await readSnsDomains(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MissingEnvError) {
      return NextResponse.json({ error: error.message }, { status: 424 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lookup failed" },
      { status: 502 },
    );
  }
}

const DeleteSchema = z.object({
  owner: OwnerSchema,
  /** Name + account pairs, exactly as the GET returned them. */
  domains: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(255),
        address: z.string().refine(isValidSolanaAddress, "Invalid name account"),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * Build the burns. `burnDomain` derives the name account from the name and
 * clears the registrar's reverse and resale state as well as deleting the
 * registry; the address the client selected is checked against the derivation
 * so a stale or mismatched pair cannot burn a different name.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  try {
    const owner = new PublicKey(parsed.data.owner);
    const instructions = parsed.data.domains.map(({ name, address }) => {
      const canonical = name.replace(/\.(sns|sol)$/i, "").toLowerCase();
      const instruction = burnDomain(`${canonical}.sns`, owner, owner);
      const derived = instruction.keys[2]?.pubkey.toBase58();
      if (!derived || derived !== address) {
        throw new Error(
          `The name ${canonical}.sns does not derive the selected name account.`,
        );
      }
      return serializeInstruction(instruction);
    });

    return NextResponse.json({ instructions });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not build the burn instructions",
      },
      { status: 502 },
    );
  }
}

