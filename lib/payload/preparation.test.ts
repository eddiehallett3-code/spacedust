import { describe, expect, it } from "vitest";
import { resolvePreparationGate, type PreparationInput } from "./preparation";

/**
 * The gate on Payload's two buttons.
 *
 * These exist because a dead button is indistinguishable from a broken one, and
 * this flow has had both: a phase that counted as busy forever, and a client
 * bundle that failed to hydrate after a mid-edit syntax error. Neither was
 * visible from the screen. So the rules are asserted here instead, including the
 * reported combination that started this: assets selected, verification switched
 * off, and — correctly — both actions available.
 */

const base: PreparationInput = {
  destinationOk: true,
  destinationVerified: true,
  verifyRequired: false,
  itemCount: 2,
  amountProblem: null,
  preparedFor: null,
  recipient: "6W2V5zMkwRmb7jiYavSJ1RS9Kh2Yg76wgzcNySuUGx2Z",
};

describe("resolvePreparationGate", () => {
  it("offers the preview when a destination is settled and something is selected", () => {
    // The reported case: assets ticked, "test before" unticked. Nothing about
    // that combination should block anything.
    const gate = resolvePreparationGate(base);

    expect(gate.canPrepare).toBe(true);
    expect(gate.blockedReason).toBeNull();
    // Signing still waits for a preview — that is the design, not a bug.
    expect(gate.canSend).toBe(false);
    expect(gate.sendBlockedReason).toBeNull();
  });

  it("offers signing once the preview matches the destination", () => {
    const gate = resolvePreparationGate({ ...base, preparedFor: base.recipient });

    expect(gate.canSend).toBe(true);
    expect(gate.sendBlockedReason).toBeNull();
  });

  it("tolerates whitespace around a pasted address", () => {
    const gate = resolvePreparationGate({
      ...base,
      recipient: `  ${base.recipient}  `,
      preparedFor: base.recipient,
    });

    expect(gate.canSend).toBe(true);
  });

  it("blocks both actions, with the reason, when verification is required and absent", () => {
    const gate = resolvePreparationGate({
      ...base,
      verifyRequired: true,
      destinationVerified: false,
    });

    expect(gate.canPrepare).toBe(false);
    expect(gate.canSend).toBe(false);
    expect(gate.blockedReason).toMatch(/not verified yet/i);
  });

  it("does not ask for verification when the switch is off", () => {
    const gate = resolvePreparationGate({
      ...base,
      verifyRequired: false,
      destinationVerified: true,
    });

    expect(gate.canPrepare).toBe(true);
    expect(gate.blockedReason).toBeNull();
  });

  it("says to select something when nothing is ticked", () => {
    const gate = resolvePreparationGate({ ...base, itemCount: 0 });

    expect(gate.canPrepare).toBe(false);
    expect(gate.blockedReason).toMatch(/select at least one/i);
  });

  it("blocks an unreadable amount even with items selected", () => {
    // The message is shown, so the action must actually be blocked — a reason
    // beside a working button is worse than no reason at all.
    const gate = resolvePreparationGate({
      ...base,
      itemCount: 1,
      amountProblem: "You asked to send more BONK than the wallet holds.",
    });

    expect(gate.canPrepare).toBe(false);
    expect(gate.canSend).toBe(false);
    expect(gate.blockedReason).toMatch(/more BONK/i);
  });

  it("stops signing when the destination changed after the preview", () => {
    const gate = resolvePreparationGate({
      ...base,
      preparedFor: "9qDz4uC7M7oJdhCErKEtLzm4pkdjdc7uQAFggy5jYrmt",
    });

    expect(gate.canPrepare).toBe(true);
    expect(gate.canSend).toBe(false);
    expect(gate.sendBlockedReason).toMatch(/destination changed/i);
  });

  it("leaves an invalid address to the field that shows it", () => {
    // Two problems reported for one cause reads as two mistakes.
    const gate = resolvePreparationGate({ ...base, destinationOk: false });

    expect(gate.canPrepare).toBe(false);
    expect(gate.canSend).toBe(false);
    expect(gate.blockedReason).toBeNull();
  });

  it("never reports the send reason for a destination that is simply unset", () => {
    const gate = resolvePreparationGate({
      ...base,
      destinationOk: false,
      preparedFor: null,
    });

    expect(gate.sendBlockedReason).toBeNull();
  });
});
