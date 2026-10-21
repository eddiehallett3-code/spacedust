import { NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  type AccountInfo,
  type TransactionInstruction,
} from "@solana/web3.js";
import { allowRequest, rateLimitResponse } from "@/lib/api/rate-limit";
import { z } from "zod";
import {
  NAME_PROGRAM_ID,
  deleteInstruction,
  getDomainMint,
  getSnsDomainsForOwner,
} from "@bonfida/spl-name-service";
import { getServerRpcUrl, MissingEnvError } from "@/lib/config/env";
import { isValidSolanaAddress } from "@/lib/utils/sanitize";
import type { ApiInstruction } from "@/types/jupiter";

/**
 * `GET /api/domains?owner=<pubkey>` — the `.sns` domains a wallet owns.
 * `POST /api/domains` — the delete instructions for the ones the user picked.
 *
 * **Why this is a route rather than a client call.** The SNS SDK lists a wallet's
 * domains with `connection.getProgramAccounts` on the name-service program, and
 * this app's RPC proxy refuses that method on purpose — it is absent from
 * `ALLOWED_METHODS` and the README explains why. So the lookup happens here, where
 * the Helius key already lives, which is the shape every other flow uses: the
 * browser talks to our own endpoints and never to a provider.
 *
 * **Why the instructions are built here too.** They are *not* hand-encoded. An SNS
 * name account is deleted by a program-specific instruction with a discriminator
 * and a fixed account list, and this codebase's rule is that such instructions come
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

/** One domain, as the picker needs it. */
interface DomainEntry {
  /** The name without the `.sns` suffix, as the index returns it. */
  name: string;
  /** The name account. This is what a delete instruction acts on. */
  address: string;
  /** Rent held in that account, which is what a delete returns. */
  lamports: number;
  /** Account size. The deposit is set by the name's length at registration. */
  bytes: number;
  /** The owner recorded in the name registry's header. */
  owner: string | null;
  /**
   * True when this domain has been wrapped as an NFT.
   *
   * A tokenized domain is the form marketplaces sell, and whether its NFT must be
   * burned before the name can be deleted has not been verified against mainnet —
   * so the client refuses these rather than sending an instruction nobody has
   * exercised.
   */
  tokenized: boolean;
}

/**
 * The owner stored in a name registry's header: parent(32) · owner(32) · class(32),
 * then the domain's own data. Read by offset, and never assumed to be the wallet
 * that asked — the tool must not offer a domain the connected wallet does not own.
 */
function ownerOf(data: Buffer | Uint8Array | undefined): string | null {
  if (!data || data.length < 64) return null;
  try {
    return new PublicKey(data.subarray(32, 64)).toBase58();
  } catch {
    return null;
  }
}

const OwnerSchema = z
  .string()
  .refine(isValidSolanaAddress, { message: "Not a valid Solana address" });

/**
 * Read an aligned list of accounts in 100-key batches.
 *
 * `getMultipleAccountsInfo` is capped by the RPC at 100 keys per request in
 * practice; sending 250 used to look like it worked only while nobody owned that
 * many names. Batching keeps the alignment the mapping below relies on.
 */
async function readAccounts(
  connection: Connection,
  keys: readonly PublicKey[],
): Promise<Array<AccountInfo<Buffer> | null>> {
  const out: Array<AccountInfo<Buffer> | null> = [];
  for (let index = 0; index < keys.length; index += 100) {
    const batch = await connection.getMultipleAccountsInfo(
      keys.slice(index, index + 100),
    );
    out.push(...batch);
  }
  return out;
}

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
    const connection = new Connection(getServerRpcUrl(), "confirmed");
    const wallet = new PublicKey(parsed.data);

    // The SDK composes a `getProgramAccounts` lookup with a batched reverse
    // lookup, which is how each name account is paired with the name it holds.
    const found = await getSnsDomainsForOwner(connection, wallet);

    if (found.length === 0) {
      return NextResponse.json({ domains: [], truncated: false });
    }

    // "We could not look" and "there are none" are different answers, and only one
    // of them is safe to render as an empty list — a rule this app applies to every
    // lookup. A failed call throws above and becomes a 502, never an empty result.
    const entries = found.slice(0, 250).map((entry) => ({
      // The SDK returns a TLD-less name. Strip a suffix defensively so a future
      // response that includes `.sns` cannot render as `name.sns.sns`.
      name: String(entry.domain).replace(/\.(sns|sol)$/i, ""),
      key: new PublicKey(entry.key),
    }));

    // Two batched reads rather than two per domain: reading accounts one at a time
    // is what drew 429s from the RPC during the probe run.
    const accounts = await readAccounts(
      connection,
      entries.map((entry) => entry.key),
    );
    const mints = await readAccounts(
      connection,
      entries.map((entry) => getDomainMint(entry.key)),
    );

    const domains: DomainEntry[] = entries.map((entry, index) => {
      const account = accounts[index];
      return {
        name: entry.name,
        address: entry.key.toBase58(),
        lamports: account?.lamports ?? 0,
        bytes: account?.data.length ?? 0,
        owner: ownerOf(account?.data),
        tokenized: mints[index] !== null,
      };
    });

    return NextResponse.json({
      domains,
      // A domain collector can own hundreds, so the page says when it is showing a
      // subset rather than letting 250 look like the whole wallet.
      truncated: found.length > entries.length,
    });
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
  /** Name accounts to build deletes for, exactly as the GET returned them. */
  accounts: z
    .array(z.string().refine(isValidSolanaAddress, "Invalid name account"))
    .min(1)
    .max(50),
});

/**
 * Build the deletes. The refund target is the owner and the name owner is the
 * owner, which is what SNS's own documentation does — the wallet signs and the
 * wallet is paid.
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
    const instructions = parsed.data.accounts.map((address) =>
      serializeInstruction(
        deleteInstruction(NAME_PROGRAM_ID, new PublicKey(address), owner, owner),
      ),
    );

    return NextResponse.json({ instructions });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not build the delete instructions",
      },
      { status: 502 },
    );
  }
}

