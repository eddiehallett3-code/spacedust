import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `getTokenAccountsByOwner` has no pagination, and the scanners once pretended it
 * did.
 *
 * Both scans looped `for (page = 1; page <= MAX_PAGES; page++)` while sending the
 * identical request each time: the same accounts came back, duplicate rows were
 * appended, and up to ten times the RPC budget was spent without ever seeing an
 * account the first response did not contain. A provider that caps the response
 * caps every call just the same.
 *
 * The fix is one request plus de-duplication by address. These read the sources
 * because the mistake is a request shape, not a pure function, and the project
 * already locks cross-file invariants this way (`scan-budget.test.ts`).
 */
const source = (file: string): string =>
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

const SCANNERS = [
  "lib/token-source/rpc.server.ts",
  "lib/token-source/empty-accounts.server.ts",
];

describe("the token-account read", () => {
  for (const file of SCANNERS) {
    it(`${file} makes one request and de-duplicates, rather than faking pages`, () => {
      const text = source(file);

      expect(text).not.toMatch(/MAX_PAGES|ACCOUNT_PAGE/);
      expect(text).not.toMatch(/for \(let page/);
      // One call site, on its own line, in `rpcCall("getTokenAccountsByOwner", …)`.
      expect(text.match(/"getTokenAccountsByOwner",/g) ?? []).toHaveLength(1);
      // The de-duplication that replaces the loop.
      expect(text).toMatch(/seen\.has\(/);
    });
  }
});
