import type { SweepPhase } from "@/types/sweep";

/**
 * Phases during which the UI must treat a flow as in progress.
 *
 * Extracted rather than inlined in each hook because all three pipelines
 * (`useSweep`, `useVoid`, `useNftBurn`) need the same answer, and getting it
 * wrong is not cosmetic. A Void preview once ended on `simulating` — a member
 * of this set — so the phase machine never came to rest and "Sign & send" was
 * `disabled={isBusy}` forever. The preview rendered perfectly next to a dead
 * button, which reads as a broken button rather than a broken phase.
 *
 * The invariant that must hold, and that `phase.test.ts` locks down: whatever
 * phase a *successful* `prepare()` settles on has to be **outside** this set.
 */
export function isBusyPhase(phase: SweepPhase): boolean {
  return (
    phase === "planning" ||
    phase === "simulating" ||
    phase === "awaiting-signature" ||
    phase === "submitting" ||
    phase === "confirming"
  );
}

/**
 * Phases a flow may legitimately come to rest on after preparing.
 *
 * Anything else means the UI is stuck waiting for something that will never
 * arrive.
 */
export function isRestingPhase(phase: SweepPhase): boolean {
  return phase === "idle" || phase === "success" || phase === "error";
}
