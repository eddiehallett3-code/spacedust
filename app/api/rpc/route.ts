import { NextResponse } from "next/server";
import { getServerRpcUrl, MissingEnvError } from "@/lib/config/env";
import { ALLOWED_METHODS } from "@/lib/config/rpc-methods";
import { allowRequest } from "@/lib/api/rate-limit";

/**
 * Same-origin JSON-RPC proxy.
 *
 * The browser needs to simulate, sign-submit and confirm transactions, which
 * requires an RPC endpoint. Exposing `HELIUS_API_KEY` as a `NEXT_PUBLIC_`
 * variable would publish it to every visitor — anyone could read it from the
 * page source and drain the account's credits.
 *
 * So the browser posts here, and this handler attaches the key server-side.
 *
 * SECURITY: the method list is a strict allow-list. Without it, this endpoint
 * would be an open RPC relay anyone could point at your Helius account. The list
 * itself lives in `lib/config/rpc-methods.ts`: Next only allows HTTP handlers to
 * be exported from a route module, and the list needs to be importable by its
 * test.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generous ceiling for a base64 transaction plus config. */
const MAX_BODY_BYTES = 512 * 1024;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown[];
}

function rpcError(id: string | number | null, code: number, message: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status: code === -32600 ? 400 : 200 },
  );
}

export async function POST(request: Request) {
  // Before parsing, not after: a flood should cost a Map lookup, not JSON work.
  // Refusal is HTTP 429 with a JSON-RPC error body, because this endpoint's client
  // is web3.js and the app renders the resulting error like any other RPC failure.
  const quota = allowRequest(request, "rpc");
  if (!quota.allowed) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32005, message: "Rate limit exceeded. Try again shortly." },
      },
      { status: 429, headers: { "Retry-After": String(quota.retryAfterSeconds) } },
    );
  }

  let body: JsonRpcRequest;

  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return rpcError(null, -32600, "Request body too large");
    }
    body = JSON.parse(text) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Invalid JSON");
  }

  const { id = null, method, params } = body;

  if (typeof method !== "string" || !ALLOWED_METHODS.has(method)) {
    return rpcError(id, -32601, `Method not allowed: ${String(method)}`);
  }

  if (params !== undefined && !Array.isArray(params)) {
    return rpcError(id, -32602, "params must be an array");
  }

  // We reject unknown keys upstream, but never forward them.
  const forwardedParams = (params ?? []).slice(0, 3);

  let rpcUrl: string;
  try {
    rpcUrl = getServerRpcUrl();
  } catch (error) {
    if (error instanceof MissingEnvError) {
      return NextResponse.json(
        {
          error: error.message,
          provider: "helius",
        },
        { status: 424 },
      );
    }
    throw error;
  }

  try {
    const upstream = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: id ?? 1,
        method,
        params: forwardedParams,
      }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });

    const text = await upstream.text();

    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return rpcError(id, -32603, "RPC request failed or timed out");
  }
}

/** Explicitly reject GET so this can never become a read-open relay. */
export async function GET() {
  return NextResponse.json(
    { error: "POST JSON-RPC requests only" },
    { status: 405 },
  );
}