/**
 * Base64 helpers that work identically in the browser and on Node.
 *
 * We deliberately avoid `Buffer` in client code: relying on Next.js's bundler
 * polyfill is a portability trap, and `atob`/`btoa` are available everywhere we
 * target. Node 20+ also ships `atob`/`btoa` as globals, so this stays simple.
 */

/** Decode base64 to bytes. Throws on malformed input rather than silently truncating. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Encode bytes as base64. */
export function bytesToBase64(bytes: Uint8Array): string {
  // Chunk to stay well clear of the argument-count limit on large arrays.
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/** True when the string is plausibly valid base64. */
export function isBase64(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}