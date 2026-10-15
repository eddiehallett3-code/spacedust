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
    try {
      const parsed = JSON.parse(text) as {
        error?: string;
        message?: string;
        provider?: "helius" | "jupiter";
      };
      message = parsed.error ?? parsed.message ?? message;
      provider = parsed.provider;
    } catch {
      if (text) message = text.slice(0, 300);
    }

    if (response.status === 424 && /api key/i.test(message)) {
      throw new ConfigurationError(message);
    }
    throw new ApiRequestError(message, response.status, provider);
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