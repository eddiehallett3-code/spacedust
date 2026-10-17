/**
 * Scrubbing text that came from somewhere else.
 *
 * `/api/health` is public, unauthenticated and diagnostic: its whole job is to
 * say whether a key works. The messages it wants to quote come from providers,
 * and a provider's error body is arbitrary text — gateways routinely echo the
 * request URL on a 401, and this app's Helius key lives *in* that URL's query
 * string (`?api-key=…`, see `getServerRpcUrl`). So the one moment the endpoint is
 * most useful — a rejected key — is the moment it is most likely to print one.
 *
 * A `slice(0, 160)` is a length limit, not a secret filter: it truncates the leak.
 * So two defences run instead, in order:
 *
 *  1. the caller passes the exact secrets it knows (the key, the URL) and they are
 *     replaced verbatim — no pattern has to recognise a provider's key shape;
 *  2. patterns catch the shapes gateways and proxies use for everything else
 *     (`api-key=`, `token=`, `Bearer …`, `x-api-key: …`).
 *
 * What survives is length-capped and stripped of control characters, because it is
 * embedded in JSON for a browser. The *full* message belongs in the server log,
 * where only the operator can read it — see the call sites in `/api/health`.
 */

/** Query or path parameters that carry credentials. */
const SECRET_PARAM =
  /([?&;](?:api[-_]?key|apikey|access[-_]?token|auth[-_]?token|token|secret|key)=)[^&\s"'<>]+/gi;

/** `Authorization: Bearer …`, and a bare `Bearer …` in prose. */
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/** Header echoes: `x-api-key: abc`, or the same pair written as `=` outside a URL. */
const KEY_HEADER = /\b(x-api-key\s*[:=]\s*)[^\s,"'}<]+/gi;

/** Control characters: they either break the JSON string or smuggle a second line. */
const CONTROL = /[\u0000-\u001f\u007f]+/g;

export interface RedactOptions {
  /**
   * Values to remove wherever they appear.
   *
   * The most reliable rule available: the caller knows the key, so no pattern has
   * to guess what one looks like. Values shorter than eight characters are ignored
   * — replacing a two-letter "secret" would mangle the sentence and protect
   * nothing.
   */
  secrets?: readonly string[];
  /** Hard cap, in characters, on what is returned. */
  maxLength?: number;
}

export function redactSecrets(
  text: string,
  { secrets = [], maxLength = 160 }: RedactOptions = {},
): string {
  let clean = text;

  for (const secret of secrets) {
    const trimmed = secret.trim();
    if (trimmed.length < 8) continue;
    clean = clean.split(trimmed).join("[redacted]");
  }

  clean = clean
    .replace(SECRET_PARAM, "$1[redacted]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(KEY_HEADER, "$1[redacted]")
    .replace(CONTROL, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1))}…`;
}

/**
 * The operator-facing copy of a failure.
 *
 * Same redaction as the public sentence, with a larger cap: the full provider
 * message has real debugging value and the key has none, and a deployment log is a
 * place a secret can live for months. This exists so the call site never reaches
 * for `console.warn(error)`, which would write the whole thing — URL and all — into
 * a log the team can export but cannot un-export.
 */
export function redactForLog(
  error: unknown,
  secrets: readonly string[] = [],
): string {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return redactSecrets(message, { secrets, maxLength: 500 });
}

/**
 * A failure, in one public sentence.
 *
 * Timeouts are named rather than quoted: `AbortSignal.timeout` surfaces as a
 * `TimeoutError` whose message ("The operation was aborted due to timeout") tells
 * a user nothing they can act on, while the useful fact is that nothing came back.
 */
export function describeFailure(
  error: unknown,
  secrets: readonly string[] = [],
): string {
  const message = error instanceof Error ? error.message : "";
  const name = error instanceof Error ? error.name : "";

  if (name === "TimeoutError" || name === "AbortError") {
    return "no response before the timeout";
  }

  return redactSecrets(message, { secrets }) || "no detail from the provider";
}
