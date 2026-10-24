import { NextResponse } from "next/server";
import { Connection, VersionedTransaction, type PublicKey } from "@solana/web3.js";
import { getServerRpcUrl } from "@/lib/config/env";
import { allowRequest, rateLimitResponse } from "@/lib/api/rate-limit";
import { crossOriginRefusal } from "@/lib/api/same-origin";
import {
  MIN_SPONSOR_BALANCE_LAMPORTS,
  verifySponsoredTransaction,
} from "@/lib/sponsor/policy";
import { getSponsorKeypair } from "@/lib/sponsor/config";
import { isWalletSignatureValid } from "@/lib/sponsor/signature.server";
import { base64ToBytes } from "@/lib/utils/base64";

/**
 * Advance the network fee for a wallet that cannot pay it.
 *
 * The shape of this endpoint is the security model, so it is worth stating
 * plainly: it does not *build* anything and it does not trust the caller. The
 * client sends a transaction its wallet has already signed; this handler reads
 * the final bytes, re-derives every fact it cares about from them, refuses
 * anything that could cost the sponsor more than one fee, simulates it, and only
 * then adds the sponsor's signature.
 *
 * What the sponsor is exposed to, in full:
 *
 *  - one network fee per sponsored transaction (it is the fee payer and appears
 *    in no instruction, so nothing else can move its lamports), and
 *  - a transaction that lands and fails still pays that fee. The simulation
 *    below is what keeps that rare, and the balance floor is what keeps the
 *    total bounded.
 *
 * The repayment is a plain transfer from the wallet back to the sponsor, placed
 * after the close that releases the rent, so it is funded by the same
 * transaction it pays for. If it does not cover the fee, this refuses.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A serialized Solana transaction cannot exceed 1232 bytes. */
const MAX_TRANSACTION_BYTES = 1232;

/** Comfortably above a 1232-byte body once base64 and JSON have their way. */
const MAX_BODY_BYTES = 4 * 1024;

/** Same-origin only, and every response is a fresh decision. */
function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/** Whether sponsorship is available, and which address would pay. */
export async function GET() {
  const sponsor = getSponsorKeypair();
  const enabled = sponsor !== null && (await sponsorIsFunded(sponsor.publicKey));
  return json({
    enabled,
    // A receiving address is public by definition; it is on chain either way.
    sponsor: enabled ? (sponsor?.publicKey.toBase58() ?? null) : null,
  });
}

/**
 * Is the sponsor actually able to pay right now?
 *
 * Cached for a minute: this is asked once per page that can use it, and the
 * answer only changes when somebody funds or drains the wallet. Reporting a
 * funded sponsor as available and then refusing at co-sign time would turn a
 * usable flow into a dead end, so the answer is checked before a plan offers it.
 */
let fundedCache: { at: number; funded: boolean } | null = null;
const FUNDED_CACHE_MS = 60_000;

async function sponsorIsFunded(pubkey: PublicKey): Promise<boolean> {
  if (fundedCache && Date.now() - fundedCache.at < FUNDED_CACHE_MS) {
    return fundedCache.funded;
  }
  let funded = false;
  try {
    const connection = new Connection(getServerRpcUrl(), "confirmed");
    funded =
      (await connection.getBalance(pubkey, "confirmed")) >=
      MIN_SPONSOR_BALANCE_LAMPORTS;
  } catch {
    funded = false;
  }
  fundedCache = { at: Date.now(), funded };
  return funded;
}

export async function POST(request: Request) {
  const quota = allowRequest(request, "sponsor");
  if (!quota.allowed) return rateLimitResponse(quota);

  const refusal = crossOriginRefusal(request);
  if (refusal) return json({ error: refusal }, 403);

  const keypair = getSponsorKeypair();
  if (!keypair) {
    return json({ error: "Fee sponsorship is not configured." }, 503);
  }
  const sponsor = keypair.publicKey.toBase58();

  // Before parsing: a flood should cost a header read, not JSON work.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: "That request is too large." }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "The request body could not be read." }, 400);
  }

  const encoded =
    body && typeof body === "object" && "transaction" in body
      ? (body as { transaction?: unknown }).transaction
      : null;
  if (typeof encoded !== "string" || encoded.length === 0) {
    return json({ error: "A signed transaction is required." }, 400);
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(encoded);
  } catch {
    return json({ error: "The transaction could not be decoded." }, 400);
  }
  if (bytes.length === 0 || bytes.length > MAX_TRANSACTION_BYTES) {
    return json({ error: "That is not a Solana transaction." }, 413);
  }

  // ── The gate ──────────────────────────────────────────────────────────────
  // Everything below is decided from these bytes, never from the request's
  // description of itself.
  const verdict = verifySponsoredTransaction(bytes, sponsor);
  if (!verdict.ok) return json({ error: verdict.reason }, 422);

  const connection = new Connection(getServerRpcUrl(), "confirmed");

  // The hard budget. Checked before anything is signed, and it is the reason a
  // failure anywhere else cannot cost more than the float in this wallet.
  let balance: number;
  try {
    balance = await connection.getBalance(keypair.publicKey, "confirmed");
  } catch {
    return json({ error: "The sponsor's balance could not be read." }, 502);
  }
  if (balance < MIN_SPONSOR_BALANCE_LAMPORTS) {
    console.warn(
      `[sponsor] refusing to sign: balance ${balance} is below the ${MIN_SPONSOR_BALANCE_LAMPORTS} floor`,
    );
    return json(
      {
        error:
          "The fee sponsor is out of SOL right now, so no fee could be advanced.",
      },
      503,
    );
  }

  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(bytes);
  } catch {
    return json({ error: "The transaction could not be read." }, 400);
  }

  // A sponsored transaction that would fail still pays its fee, so it is never
  // signed. This is the same rule the client applies to what it sends.
  try {
    const simulation = await connection.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    });
    if (simulation.value.err) {
      return json(
        {
          error:
            "That transaction fails when simulated, so no fee was advanced and nothing was sent.",
        },
        422,
      );
    }
  } catch {
    return json(
      { error: "The sponsor could not simulate the transaction." },
      502,
    );
  }

  // The wallet's signature is checked here because `sign()` does not check it
  // for us: this build fills the slots it is handed and leaves the rest alone.
  // A sponsor signature over a message nobody validly authorised is never sent.
  const walletSignature = transaction.signatures[1];
  const walletKey = transaction.message.staticAccountKeys[1];
  if (
    !walletSignature ||
    !walletKey ||
    !isWalletSignatureValid({
      message: transaction.message.serialize(),
      signature: walletSignature,
      publicKey: walletKey.toBytes(),
    })
  ) {
    return json(
      { error: "The wallet's signature on that transaction is not valid." },
      422,
    );
  }

  let signed: VersionedTransaction;
  try {
    signed = VersionedTransaction.deserialize(bytes);
    signed.sign([keypair]);
  } catch {
    return json(
      { error: "The fee sponsor could not sign that transaction." },
      422,
    );
  }

  return json({
    transaction: Buffer.from(signed.serialize()).toString("base64"),
    feeLamports: verdict.feeLamports,
  });
}
