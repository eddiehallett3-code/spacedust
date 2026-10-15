import { describe, expect, it } from "vitest";
import { SigningTimeoutError } from "@/lib/solana/submit";
import { toFriendlyError } from "./errors";

/**
 * The copy for a wallet that accepts a request and never answers it.
 *
 * "No answer yet" and "no answer, ever" looked identical in the app: the sweep
 * sat on "waiting for you" with no message at all, so there was nothing to act
 * on and no way to tell whether a transaction existed. These pin the wording
 * that makes the stuck case sayable — including the distinction between the
 * app's own stuck detector and the wallet SDK's association timeout, which mean
 * different things.
 */

describe("toFriendlyError — a wallet that never answered", () => {
  it("names the app's own stuck detector", () => {
    const friendly = toFriendlyError(new SigningTimeoutError(180_000));

    expect(friendly.title).toBe("Your wallet never answered");
    expect(friendly.message).toMatch(/nothing was sent/i);
    expect(friendly.hint).toMatch(/local network/i);
  });

  it("names the wallet SDK's association timeout, which is a different failure", () => {
    const friendly = toFriendlyError(new Error("Wallet connection timed out"));

    expect(friendly.title).toBe("Your wallet never answered");
    expect(friendly.hint).toMatch(/showed no approval/i);
  });

  it("explains that a session can end while the app still shows an address", () => {
    const friendly = toFriendlyError(new Error("Wallet not connected"));

    expect(friendly.title).toBe("Your wallet session has ended");
    expect(friendly.hint).toMatch(/disconnect and connect again/i);
  });

  it("still passes an unrecognised error through untouched", () => {
    const friendly = toFriendlyError(new Error("some brand new upstream failure"));

    expect(friendly.title).toBe("Something went wrong");
    expect(friendly.message).toBe("some brand new upstream failure");
  });
});
