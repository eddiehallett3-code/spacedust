import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Payload's preview, its rebuild, and the request they describe.
 *
 * Two bugs reached the review stage here, and neither was visible from a green
 * build:
 *
 *  - a preview survived a change to the selection or to a typed amount, so the
 *    wallet could sign a batch the screen no longer described;
 *  - the blockhash-expiry rebuild omitted the native-SOL fields, so a batch that
 *    included SOL silently lost it (and an SOL-only batch threw instead).
 *
 * The rules are tested directly where they can be (`payloadRequestKey`), and the
 * wiring is asserted here — the same shape as `lib/sweep/preview.test.ts` for
 * the two burn flows, because a rule that exists but is not called helps nobody.
 */

const source = (file: string): string =>
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

describe("Payload's preview is discarded when its request moves", () => {
  it("consults payloadRequestKey and acts on the previewAction verdict", () => {
    const app = source("components/payload/payload-app.tsx");

    expect(app).toContain("payloadRequestKey({");
    expect(app).toContain("previewAction({");
    expect(app).toMatch(/action === "discard"/);
    expect(app).toMatch(/payload\.reset\(\)/);
  });
});

describe("Payload's rebuild is the same request as the preview", () => {
  it("passes the SOL fields to every planSend call, including the rebuild", () => {
    const hook = source("hooks/use-payload.ts");

    const calls = [
      ...hook.matchAll(/planSend\(\{[\s\S]*?\n\s*\}\);/g),
    ].map((match) => match[0]);

    // prepare() and the blockhash-expiry rebuild. If a third call is added it
    // must also carry the whole request, which this loop enforces.
    expect(calls.length).toBeGreaterThanOrEqual(2);

    for (const call of calls) {
      expect(call).toContain("solLamports:");
      expect(call).toContain("solBalanceLamports:");
    }
  });

  it("does not treat an SOL-only batch as an empty selection", () => {
    // The UI offers SOL as its own row. The hook's opening guard used to look
    // only at tokens and NFTs, so an SOL-only batch never reached the planner.
    const hook = source("hooks/use-payload.ts");

    expect(hook).toMatch(
      /request\.tokens\.length === 0 &&[\s\S]{0,160}request\.solLamports/,
    );
  });
});
