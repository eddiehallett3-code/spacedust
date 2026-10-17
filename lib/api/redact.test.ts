import { describe, expect, it } from "vitest";
import { describeFailure, redactSecrets } from "./redact";

/**
 * What a public diagnostic endpoint may repeat.
 *
 * The case these exist for: Helius answers 401 with a body that echoes the request
 * URL, the URL carries `?api-key=…`, and `/api/health` used to return
 * `error.message.slice(0, 160)` — a length limit, not a filter. Every test below
 * is a way that happens, or a way the filter could overreach and mangle the
 * message it is supposed to preserve.
 */

const KEY = "9f2c1d4e-7a6b-4c3d-8e5f-0a1b2c3d4e5f";
const URL_WITH_KEY = `https://mainnet.helius-rpc.com/?api-key=${KEY}`;

describe("redactSecrets", () => {
  it("removes a key from a URL the provider echoed", () => {
    const text = `401 unauthorized: ${URL_WITH_KEY}`;
    const clean = redactSecrets(text, { secrets: [KEY, URL_WITH_KEY] });

    expect(clean).not.toContain(KEY);
    expect(clean).toContain("401 unauthorized");
    expect(clean).toContain("[redacted]");
  });

  it("removes credential parameters by shape, keyed or not", () => {
    // The caller may not know what the provider called it. The parameter is kept
    // so the sentence still says *what* was rejected; only its value goes.
    for (const param of ["api-key", "apikey", "access_token", "token", "secret", "key"]) {
      const clean = redactSecrets(`failed: https://x.test/v1?${param}=SECRETVALUE123`);
      expect(clean, param).toBe(`failed: https://x.test/v1?${param}=[redacted]`);
      expect(clean, param).not.toContain("SECRETVALUE123");
    }
  });

  it("removes a literal secret even with no URL around it", () => {
    // The rule that does not depend on any pattern being right.
    expect(redactSecrets(`invalid key ${KEY}`, { secrets: [KEY] })).toBe(
      "invalid key [redacted]",
    );
  });

  it("removes bearer tokens and header echoes", () => {
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnop")).toBe(
      "Authorization: Bearer [redacted]",
    );
    expect(redactSecrets("x-api-key: abc123def456")).toBe("x-api-key: [redacted]");
    expect(redactSecrets("x-api-key=abc123def456")).toBe("x-api-key=[redacted]");
  });

  it("leaves an ordinary sentence alone", () => {
    const text = "Helius responded 401. Check that HELIUS_API_KEY is valid.";
    expect(redactSecrets(text)).toBe(text);
  });

  it("strips control characters and collapses whitespace", () => {
    expect(redactSecrets("first\nsecond\ttabbed\u0000end")).toBe(
      "first second tabbed end",
    );
  });

  it("caps the length, with an ellipsis inside the cap", () => {
    const clean = redactSecrets("x".repeat(500), { maxLength: 10 });
    expect(clean).toHaveLength(10);
    expect(clean.endsWith("…")).toBe(true);
  });

  it("ignores a secret too short to be one", () => {
    // Replacing "key" everywhere would destroy the sentence and protect nothing.
    expect(redactSecrets("the key is missing", { secrets: ["key"] })).toBe(
      "the key is missing",
    );
  });
});

describe("describeFailure", () => {
  it("names a timeout instead of quoting it", () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";

    expect(describeFailure(timeout)).toBe("no response before the timeout");
  });

  it("names an abort the same way", () => {
    const abort = new Error("signal is aborted without reason");
    abort.name = "AbortError";

    expect(describeFailure(abort)).toBe("no response before the timeout");
  });

  it("redacts a key inside a provider's own message", () => {
    const failure = new Error(`Helius error: invalid api key in ${URL_WITH_KEY}`);

    expect(describeFailure(failure, [KEY, URL_WITH_KEY])).not.toContain(KEY);
  });

  it("says so when there is nothing to say", () => {
    expect(describeFailure(new Error(""))).toBe("no detail from the provider");
    expect(describeFailure("a thrown string")).toBe("no detail from the provider");
    expect(describeFailure(null)).toBe("no detail from the provider");
  });
});
