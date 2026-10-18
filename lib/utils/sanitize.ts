/**
 * Display-layer sanitisation for untrusted, user-controlled data.
 *
 * Token names, symbols and logo URIs come straight from on-chain metadata,
 * which anyone can set to anything. We never trust them. React already escapes
 * text in JSX, but we sanitise anyway because these values also reach
 * attributes, `Intl` formatters and image loaders — and because stripping
 * bidi/zero-width codepoints defeats homograph and text-direction spoofing
 * attacks that survive plain HTML escaping.
 */

/** Codepoints that must never appear in displayed text. */
const UNSAFE_CODEPOINTS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g;

/** Fallbacks used when a token has no usable symbol or name. */
export const FALLBACK_SYMBOL = "???";
export const FALLBACK_NAME = "Unknown token";

/**
 * Strip control, zero-width and bidi-override characters, collapse runs of
 * whitespace, and clamp the length.
 */
export function sanitizeText(
  input: unknown,
  maxLength = 40,
  fallback = "",
): string {
  if (typeof input !== "string") return fallback;
  const cleaned = input
    .replace(UNSAFE_CODEPOINTS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return fallback;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

/**
 * Sanitise a token symbol. Symbols are short by convention, so anything longer
 * than 12 characters is either broken metadata or a deliberate attempt to push
 * a fake ticker past a UI column edge.
 */
export function sanitizeSymbol(input: unknown): string {
  return sanitizeText(input, 12, FALLBACK_SYMBOL);
}

const MAX_LOGO_URL_LENGTH = 512;

/**
 * NFT artwork gets a longer leash than a token logo.
 *
 * Gateway URLs (and signed Arweave/CDN links) routinely carry long paths and
 * query strings, so the logo cap would silently discard valid images.
 */
const MAX_IMAGE_URL_LENGTH = 1024;

/**
 * Only allow http(s) logo URLs. Rejects `javascript:`, `data:`, `file:`,
 * protocol-relative `//host` and anything over-long. Returning `null` makes the
 * caller render a letter avatar instead.
 */
export function sanitizeLogoUri(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_LOGO_URL_LENGTH) return null;
  // A protocol-relative URL would silently inherit the page's scheme.
  if (trimmed.startsWith("//")) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname || url.hostname.length > 253) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Image URI for an NFT or cNFT.
 *
 * Separate from `sanitizeLogoUri` for two NFT-specific reasons:
 *
 *  - **Length.** A 512-char cap fits token logos but not artwork behind gateway
 *    URLs with long paths and query strings.
 *  - **`ipfs://`.** Plenty of NFT metadata still points at IPFS directly.
 *    Rejecting non-http schemes is right for tokens, but here it would mean no
 *    image at all for a large slice of collections, so we rewrite to a public
 *    gateway instead. The browser fetches it directly and the rendering
 *    component sets `no-referrer`, so the request carries nothing about the
 *    wallet.
 *
 * Everything else is the same allow-list, so this still cannot smuggle in
 * `javascript:`, `data:` or a protocol-relative URL.
 */
export function sanitizeImageUri(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let trimmed = input.trim();
  if (!trimmed) return null;

  // `ipfs://<cid>[/path]` → a public gateway. A malformed remainder is left
  // unchanged so the normal validation below rejects it, rather than us
  // guessing at a URL.
  if (trimmed.startsWith("ipfs://")) {
    const path = trimmed.slice("ipfs://".length).replace(/^ipfs\//, "");
    if (!path) return null;
    trimmed = `https://ipfs.io/ipfs/${path}`;
  }

  if (trimmed.length > MAX_IMAGE_URL_LENGTH) return null;
  if (trimmed.startsWith("//")) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname || url.hostname.length > 253) return null;
    return url.toString();
  } catch {
    return null;
  }
}


// ── Base58 / address validation ─────────────────────────────────────────────

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_RE = new RegExp(`^[${BASE58_ALPHABET}]+$`);

/** Every real Solana pubkey is exactly 32 bytes, which base58-encodes to 32–44 chars. */
export const SOLANA_ADDRESS_MIN_LENGTH = 32;
export const SOLANA_ADDRESS_MAX_LENGTH = 44;

/** True for a syntactically valid base58 Solana address. */
export function isValidSolanaAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < SOLANA_ADDRESS_MIN_LENGTH) return false;
  if (value.length > SOLANA_ADDRESS_MAX_LENGTH) return false;
  return BASE58_RE.test(value);
}

/**
 * Validate a mint before we are willing to build an instruction around it.
 *
 * This is a trust boundary: the mint string arrives from the DAS API and from
 * our own server route, but it ultimately originates from on-chain state we do
 * not control. Base58 shape is the minimum bar; callers additionally confirm the
 * account exists and is owned by a known token program.
 */
export function assertValidMint(mint: string): string {
  // Assigned to a separate binding on purpose: `isValidSolanaAddress` is a type
  // guard, so negating it inline would narrow `mint` to `never` and we could not
  // safely include it in the error message.
  const isValid = isValidSolanaAddress(mint);
  if (!isValid) {
    throw new Error(`Invalid mint address: ${String(mint).slice(0, 12)}…`);
  }
  return mint;
}

/**
 * Parse a base amount string into a `bigint`. Rejects anything that is not a
 * run of digits, so a malicious `"1e18"` or `"-5"` can never become a negative
 * or floating-point transfer.
 */
export function parseBaseAmount(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{1,30}$/.test(trimmed)) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

/**
 * Convert a base-unit amount to a display number without losing precision on
 * large balances. Returns `null` for absurd decimals so we never render `NaN`.
 */
export function baseAmountToNumber(amount: bigint, decimals: number): number | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) return null;
  // Scale by the real decimals. This used to clamp the divisor at 10^15 while
  // still accepting up to 30, which returned an amount 10^(decimals-15) times
  // too large — silently wrong money for any mint beyond 15 decimals.
  const divisor = 10 ** decimals;
  const value = Number(amount) / divisor;
  return Number.isFinite(value) ? value : null;
}

/**
 * Whole units to base units, for an amount a person typed.
 *
 * The counterpart of `baseAmountToNumber`, and the reason it exists: amounts are
 * never routed through a float on the way in. `1.005 * 1e6` is
 * 1004999.9999999999, so a float path truncated it to **1004999** — one base unit
 * short of what was typed, which is the difference between a send that empties an
 * account and one that leaves a residue the account can never then be closed for.
 * So the string is split on the decimal point and the parts are joined as digits
 * into a `bigint`.
 *
 * Returns `null` — never a guess — for anything that is not a plain positive
 * decimal with no more decimal places than the mint actually has. A user typing
 * more precision than the token supports has made a mistake worth showing rather
 * than silently rounding: rounding up would send more than they asked for.
 */
export function toBaseAmount(
  value: string,
  decimals: number,
): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) return null;

  const trimmed = value.trim().replace(/,/g, "");
  if (trimmed.length === 0 || trimmed.length > 40) return null;
  // No sign, no exponent, no whitespace inside — a plain decimal or nothing.
  if (!/^\d*\.?\d*$/.test(trimmed) || !/\d/.test(trimmed)) return null;

  const [whole = "", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) return null;

  const padded = fraction.padEnd(decimals, "0");
  try {
    return BigInt(`${whole || "0"}${padded}`);
  } catch {
    return null;
  }
}

/**
 * Coerce a `bigint` to a number for display/aggregation, clamping to
 * `Number.MAX_SAFE_INTEGER` instead of silently losing magnitude.
 */
export function bigintToSafeNumber(value: bigint): number {
  if (value <= 0n) return 0;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(value);
}