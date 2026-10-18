import { describe, expect, it } from "vitest";
import { payloadRequestKey, resolvePreparationGate, type PreparationInput } from "./preparation";

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

/**
 * The key that decides whether a preview still describes the request on screen.
 *
 * `execute()` signs the prepared batch, so a key that misses one input is not a
 * cosmetic bug: it is the difference between unticking a token and still sending
 * it. Each assertion below is one of those inputs.
 */
describe("payloadRequestKey", () => {
  const request = {
    recipient: "6W2V5zMkwRmb7jiYavSJ1RS9Kh2Yg76wgzcNySuUGx2Z",
    tokens: [
      { mint: "MINT_A", rawAmount: "1000" },
      { mint: "MINT_B", rawAmount: "2000" },
    ],
    assets: ["ASSET_1"],
    solLamports: "25000000",
    solSelected: true,
  };

  it("is stable across a selection reordered by a rescan", () => {
    const reordered = {
      ...request,
      tokens: [...request.tokens].reverse(),
      assets: [...request.assets].reverse(),
    };

    expect(payloadRequestKey(reordered)).toBe(payloadRequestKey(request));
  });

  it("changes when a token is added or removed", () => {
    expect(
      payloadRequestKey({ ...request, tokens: [request.tokens[0]!] }),
    ).not.toBe(payloadRequestKey(request));
  });

  it("changes when a typed amount changes, even for the same token", () => {
    const partial = {
      ...request,
      tokens: [{ mint: "MINT_A", rawAmount: "1" }, request.tokens[1]!],
    };

    expect(payloadRequestKey(partial)).not.toBe(payloadRequestKey(request));
  });

  it("changes when an NFT or cNFT is selected", () => {
    expect(payloadRequestKey({ ...request, assets: [] })).not.toBe(
      payloadRequestKey(request),
    );
  });

  it("distinguishes SOL unselected, selected with an amount, and selected with a bad one", () => {
    const keys = new Set([
      payloadRequestKey({ ...request, solSelected: false }),
      payloadRequestKey(request),
      payloadRequestKey({ ...request, solLamports: null }),
    ]);

    expect(keys.size).toBe(3);
  });

  it("ignores whitespace around a pasted address, as the field does", () => {
    expect(
      payloadRequestKey({ ...request, recipient: `  ${request.recipient}  ` }),
    ).toBe(payloadRequestKey(request));
  });

  it("changes when the destination changes", () => {
    expect(
      payloadRequestKey({
        ...request,
        recipient: "9qDz4uC7M7oJdhCErKEtLzm4pkdjdc7uQAFggy5jYrmt",
      }),
    ).not.toBe(payloadRequestKey(request));
  });
});
