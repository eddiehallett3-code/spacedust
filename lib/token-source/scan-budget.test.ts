import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The wallet scan has two clocks, and they must be in the right order.
 *
 * A large wallet is slow: 3,033 holdings took 49.4 seconds against production,
 * because every mint is priced 50 at a time and every mint authority read 100 at
 * a time, both sequentially. The client used to give up at 45 seconds — before
 * the server had finished — so the UI reported a timeout for a request that was
 * about to succeed. The fix is not a bigger number in one place; it is that the
 * *server* must be the one that gives up, with an error the user can read.
 *
 * These read the sources because the relationship spans a hook and a route, and
 * nothing else in the toolchain would notice if one were tuned without the other.
 */

const source = (file: string): string =>
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

describe("the wallet scan's budget", () => {
  it("waits longer on the client than the server is allowed to run", () => {
    const clientMs = Number(
      source("hooks/use-wallet-scan.ts")
        .match(/timeoutMs:\s*([\d_]+)/)?.[1]
        ?.replace(/_/g, ""),
    );
    const serverSeconds = Number(
      source("app/api/tokens/route.ts").match(/maxDuration\s*=\s*(\d+)/)?.[1],
    );

    expect(clientMs).toBeGreaterThan(0);
    expect(serverSeconds).toBeGreaterThan(0);
    // If this fails, the client is aborting scans the server would have finished.
    expect(clientMs).toBeGreaterThan(serverSeconds * 1_000);
  });

  it("declares a duration for both routes that do real upstream work", () => {
    for (const file of [
      "app/api/tokens/route.ts",
      "app/api/health/route.ts",
    ]) {
      expect(source(file), file).toContain("export const maxDuration = 60;");
    }
  });
});
