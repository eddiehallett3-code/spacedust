/**
 * Every planner that packs must audit.
 *
 * The audit is the only thing standing between a third-party instruction set and
 * a wallet prompt, and it is called by hand: a planner that packs and signs
 * without it looks exactly like one that does, in every test that does not go
 * looking. So this reads the source and asserts the pairing, the same way
 * `lib/token-source/scan-budget.test.ts` reads two files to assert an ordering
 * that no type can express.
 *
 * A call is `packTransactions(`, with the parenthesis — an import or a mention in
 * a comment does not count, which is what keeps this from passing on a file that
 * merely names it. The module that *defines* it is excluded, because packing is
 * not planning.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LIB = path.join(process.cwd(), "lib");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

const CALLS_PACK = /\bpackTransactions\s*\(/;
const AUDITS = /\b(?:auditPlanBeforeSigning|assertPlanAudited)\s*(?:<[^>]*>)?\s*\(/;

describe("audit coverage", () => {
  it("audits every planner that packs a transaction", () => {
    const files = sourceFiles(LIB);
    const packers = files.filter((file) => {
      if (path.basename(file) === "pack.ts") return false;
      return CALLS_PACK.test(readFileSync(file, "utf8"));
    });

    // A walk that finds nothing would make this test pass for the wrong reason.
    // There are nine today; the floor is what stops a refactor from quietly
    // removing the only thing being checked.
    expect(packers.length).toBeGreaterThanOrEqual(5);

    for (const file of packers) {
      const source = readFileSync(file, "utf8");
      expect(AUDITS.test(source), `${path.relative(LIB, file)} packs without auditing`)
        .toBe(true);
    }
  });
});
