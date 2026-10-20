import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isBusyPhase, isRestingPhase } from "@/lib/sweep/phase";
import type { SweepPhase } from "@/types/sweep";

/**
 * The phase machine has already broken this app once.
 *
 * A Void preview ended on `simulating`, which `isBusyPhase` counts as work in
 * progress, so the phase never came to rest and "Sign & send" stayed
 * `disabled={isBusy}` forever. The preview rendered perfectly next to a dead
 * button, which reads as a broken button rather than a broken phase.
 */

const ALL_PHASES: SweepPhase[] = [
  "idle",
  "planning",
  "simulating",
  "awaiting-signature",
  "submitting",
  "confirming",
  "success",
  "error",
];

describe("phase classification", () => {
  it("puts every phase on exactly one side", () => {
    for (const phase of ALL_PHASES) {
      expect(
        isBusyPhase(phase) !== isRestingPhase(phase),
        `${phase} must be busy or resting, never both or neither`,
      ).toBe(true);
    }
  });

  it("treats the phase a successful prepare() settles on as resting", () => {
    // Both burn pipelines finish a preview on "idle". This is the assertion
    // that would have failed on the original bug.
    expect(isBusyPhase("idle")).toBe(false);
  });

  it("still treats simulating as busy", () => {
    // Guard the other direction: "simulating" must stay busy, or the UI would
    // let someone sign mid-flight.
    expect(isBusyPhase("simulating")).toBe(true);
    expect(isBusyPhase("awaiting-signature")).toBe(true);
  });

  it("treats a finished run as resting, whichever way it went", () => {
    expect(isBusyPhase("success")).toBe(false);
    expect(isBusyPhase("error")).toBe(false);
  });
});

/**
 * The invariant only holds if the hooks actually obey it, so check the source.
 *
 * Reading files in a test is unusual, and worth it here: the rule is "prepare()
 * must not settle on a busy phase", which no unit test of `isBusyPhase` can
 * observe. This is the assertion that would have caught the original bug
 * before it shipped.
 */
describe("every prepare() settles on a resting phase", () => {
  const cases: Array<{ file: string; endMarker: string }> = [
    { file: "hooks/use-sweep.ts", endMarker: "return true;" },
    { file: "hooks/use-void.ts", endMarker: "return result.packed.length;" },
    // The burn preview returns counts, not a bare transaction count, because a
    // canopy-0 preview can consist entirely of pending lookup-table work.
    {
      file: "hooks/use-nft-burn.ts",
      endMarker: "return {\n          transactions: result.packed.length",
    },
  ];

  for (const { file, endMarker } of cases) {
    it(`${file} ends its successful preview on a resting phase`, () => {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      const start = source.indexOf("const prepare");
      const end = source.indexOf(endMarker, start);
      expect(start, `could not find prepare() in ${file}`).toBeGreaterThan(-1);
      expect(end, `could not find "${endMarker}" in ${file}`).toBeGreaterThan(-1);

      const body = source.slice(start, end);
      const phases = [...body.matchAll(/phase:\s*"([a-z-]+)"/g)].map((m) => m[1]);
      expect(phases.length, `no phase set in ${file}'s prepare()`).toBeGreaterThan(0);

      // The last one assigned before the success return is where it rests.
      const resting = phases[phases.length - 1] as SweepPhase;
      expect(
        isRestingPhase(resting),
        `${file} settles on "${resting}", which is busy — the button stays disabled`,
      ).toBe(true);
    });
  }
});
