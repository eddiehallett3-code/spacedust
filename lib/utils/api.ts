/**
 * Typed, cached fetch helper for our own API routes.
 *
 * Every call is same-origin so no API key ever reaches the browser. We attach a
 * timeout, surface a useful error on non-2xx, and abort in-flight requests when
 * the component unmounts or the inputs change.
 */

import { ConfigurationError, UpstreamError } from "./errors";

export class ApiRequestError extends Error {
  override readonly name = "ApiRequestError";
  constructor(
    message: string,
    readonly status: number,
    readonly provider?: "helius" | "jupiter",
    /**
     * How long the server asked us to wait, in seconds, when it said so.
     *
     * A 429 without a number reads as "some time later" and gets retried
     * immediately — the one behaviour a budget exists to prevent. The server puts
     * this in the body as well as `Retry-After`, so it survives a proxy that
     * strips headers; this is the parsed copy, and it is also read from the
     * header for an upstream that only sends that.
     */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Cache GET responses in-memory for this long. 0 disables. */
  cacheMs?: number;
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

/**
 * Very small in-memory response cache. Scans are read-heavy and the same wallet
 * gets rescanned often, so this removes a lot of Helius credit burn for free.
 * Deliberately process-local: no Redis, no cost.
 */
const cache = new Map<string, CacheEntry>();

function readCache(key: string): unknown | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * `Retry-After` in either form the spec allows: delta-seconds, or an HTTP date.
 *
 * Returns `undefined` rather than 0 for anything unparseable — "no answer" and
 * "wait no time at all" are different, and only the second should ever mean
 * "retry immediately".
 */
function readRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Math.max(0, Number(trimmed));
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

function waitSentence(seconds: number | undefined): string {
  return seconds === undefined
    ? "Try again shortly."
    : `Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
}

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    method = "GET",
    body,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cacheMs = 0,
  } = options;

  const cacheKey =
    method === "GET" ? `${path}` : null;
  if (cacheKey && cacheMs > 0) {
    const cached = readCache(cacheKey);
    if (cached !== undefined) return cached as T;
  }

  // Compose the caller's signal with our timeout so either can abort the fetch.
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const composedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: composedSignal,
      cache: "no-store",
    });
  } catch (error) {
    if (timeoutController.signal.aborted && !signal?.aborted) {
      throw new ApiRequestError(
        "The request timed out. The network may be slow — try again.",
        408,
      );
    }
    throw new ApiRequestError(
      error instanceof Error ? error.message : "Network request failed",
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let provider: "helius" | "jupiter" | undefined;
    let retryAfterSeconds: number | undefined;
    try {
      const parsed = JSON.parse(text) as {
        error?: string;
        message?: string;
        provider?: "helius" | "jupiter";
        retryAfterSeconds?: number;
      };
      message = parsed.error ?? parsed.message ?? message;
      provider = parsed.provider;
      if (
        typeof parsed.retryAfterSeconds === "number" &&
        parsed.retryAfterSeconds > 0
      ) {
        retryAfterSeconds = Math.ceil(parsed.retryAfterSeconds);
      }
    } catch {
      if (text) message = text.slice(0, 300);
    }

    // Body first, header second: an upstream may send only the header, and a
    // proxy in front of ours may strip it while leaving the body alone.
    retryAfterSeconds ??= readRetryAfter(response.headers.get("retry-after"));

    // A 429 that says nothing useful — no body, or the bare "Request failed
    // (429)" fallback — still has a number half the time. Saying it is the whole
    // difference between a user waiting twelve seconds and a user hammering the
    // button, which is what the budget is trying to stop.
    if (response.status === 429 && !/second|shortly/i.test(message)) {
      message = `Too many requests. ${waitSentence(retryAfterSeconds)}`;
    }

    if (response.status === 424 && /api key/i.test(message)) {
      throw new ConfigurationError(message);
    }
    throw new ApiRequestError(
      message,
      response.status,
      provider,
      retryAfterSeconds,
    );
  }

  let value: T;
  try {
    value = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    throw new ApiRequestError("Server returned malformed JSON", response.status);
  }

  if (cacheKey && cacheMs > 0) {
    cache.set(cacheKey, { expiresAt: Date.now() + cacheMs, value });
  }
  return value;
}

/** Rethrow anything as an `UpstreamError` when it came from a known provider. */
export function asUpstreamError(
  error: unknown,
  provider: "helius" | "jupiter",
): UpstreamError {
  if (error instanceof UpstreamError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new UpstreamError(message, provider);
}