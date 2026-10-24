import { describe, expect, it } from "vitest";
import { SigningTimeoutError } from "@/lib/solana/submit";
import {
  assessFeeShortfall,
  EmptyWalletError,
  FeeShortfallError,
} from "@/lib/solana/fee-shortfall";
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
  it("names a relay that will not resolve, which looks like a wallet that never prompts", () => {
    const friendly = toFriendlyError(
      new Error(
        "WebSocket connection to 'wss://relay.walletconnect.org/?auth=x' failed: Error in connection establishment: net::ERR_NAME_NOT_RESOLVED",
      ),
    );

    expect(friendly.title).toBe("Could not reach WalletConnect");
    expect(friendly.hint).toMatch(/Private DNS|ad blocker/i);
  });

  it("names the app's own stuck detector", () => {
    const friendly = toFriendlyError(new SigningTimeoutError(180_000));

    expect(friendly.title).toBe("Your wallet never answered");
    expect(friendly.message).toMatch(/nothing was sent/i);
    expect(friendly.hint).toMatch(/Open in Phantom/);
  });

  it("names the wallet SDK's association timeout, which is a different failure", () => {
    const friendly = toFriendlyError(new Error("Wallet connection timed out"));

    expect(friendly.title).toBe("Your wallet never answered");
    expect(friendly.message).toMatch(/never came back with a signature/i);
  });

  it("explains that a session can end while the app still shows an address", () => {
    const friendly = toFriendlyError(new Error("Wallet not connected"));

    expect(friendly.title).toBe("Your wallet session has ended");
    expect(friendly.hint).toMatch(/disconnect and connect again/i);
  });

  it("tells the user to reconnect when the wallet has forgotten the approval", () => {
    // Phantom's exact wording, seen after restarting the extension — which is
    // what Phantom support tells users to do. The page still looks connected, so
    // without this the app says "Something went wrong" and invites a retry that
    // cannot work.
    const friendly = toFriendlyError(
      new Error(
        "The requested method and/or account has not been authorized by the user.",
      ),
    );

    expect(friendly.title).toBe("Reconnect your wallet");
    expect(friendly.message).toMatch(/nothing was signed or sent/i);
    expect(friendly.hint).toMatch(/disconnect and connect again/i);
  });

  it("still passes an unrecognised error through untouched", () => {
    const friendly = toFriendlyError(new Error("some brand new upstream failure"));

    expect(friendly.title).toBe("Something went wrong");
    expect(friendly.message).toBe("some brand new upstream failure");
  });
});

/**
 * A shortfall is the one failure whose fix is a number the user has to act on.
 *
 * The generic rule below it ("top up ~0.01 SOL, or reclaim rent…") is both
 * vague and, in this case, circular — the rent cannot be reclaimed without a
 * fee. So the typed error must win, and its figures must survive untouched.
 */
describe("toFriendlyError — a wallet with no SOL for the fee", () => {
  const shortfall = assessFeeShortfall({
    payer: "YNvAM4wiyvkgoExvz2ZH2AdhxaRF8ggi15BVSdvb6uA",
    availableLamports: 0,
    firstFeeLamports: 5_323,
    totalFeeLamports: 5_323,
    transactionCount: 1,
  });

  it("returns the exact amount and address, not the generic top-up hint", () => {
    const friendly = toFriendlyError(new FeeShortfallError(shortfall!));

    expect(friendly.title).toBe("Not enough SOL for the fee");
    expect(friendly.message).toMatch(/holds 0 SOL/i);
    expect(friendly.hint).toContain(
      "YNvAM4wiyvkgoExvz2ZH2AdhxaRF8ggi15BVSdvb6uA",
    );
    expect(friendly.hint).toMatch(/another wallet or exchange/i);
    expect(friendly.hint).not.toMatch(/Top up ~0\.01 SOL/);
  });
});

/**
 * The wallet that does not exist on chain.
 *
 * This is the copy that replaces "a token account no longer exists" for a wallet
 * with zero lamports — measured on a real 0-SOL wallet trying to swap 20¢.
 */
describe("toFriendlyError — a wallet with no SOL at all", () => {
  it("returns the empty-wallet copy instead of blaming a token account", () => {
    const friendly = toFriendlyError(
      new EmptyWalletError("AiuhH6fDqsuxVMiCw8c1ypEykfV8gg2aWvJ7Q4dLZ43u"),
    );

    expect(friendly.title).toBe("This wallet has no SOL");
    expect(friendly.message).toMatch(/no lamports at all/i);
    expect(friendly.hint).toMatch(/Salvage/i);
  });
});

