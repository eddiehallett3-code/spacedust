import { describe, expect, it } from "vitest";
import {
  CONNECT_WAIT_MS,
  DISMISS_GRACE_MS,
  nextConnectStep,
  type ConnectWaitState,
} from "./connect-wait";

/**
 * The rule that decides when a connect attempt is over.
 *
 * It exists because the first version of this got it wrong in a way that could
 * never work: the adapter read AppKit's state once and then re-read that same
 * snapshot, so half a second after opening the wallet list it concluded the user
 * had closed it and threw. Nothing could connect. The cases below are the ones
 * that failure fell through, plus the ones a real phone handshake needs.
 */

const open: ConnectWaitState = { address: null, modalOpen: true, loading: false };
const closedIdle: ConnectWaitState = { address: null, modalOpen: false, loading: false };
const closedBusy: ConnectWaitState = { address: null, modalOpen: false, loading: true };
const connected: ConnectWaitState = { address: "9n3YAi3WWG", modalOpen: false, loading: false };

const step = (state: ConnectWaitState, waitedMs = 0, idleClosedMs = 0) =>
  nextConnectStep({ state, waitedMs, idleClosedMs });

describe("nextConnectStep", () => {
  it("is connected the moment there is an account", () => {
    expect(step(connected)).toBe("connected");
    // Even mid-handshake: AppKit sets the account before it finishes tidying up.
    expect(step({ ...connected, modalOpen: true, loading: true })).toBe("connected");
  });

  it("keeps waiting while the wallet list is open — the case that was broken", () => {
    // A stale reading claimed "closed, idle" here and threw at 500ms.
    expect(step(open, 500)).toBe("wait");
    expect(step(open, CONNECT_WAIT_MS - 1)).toBe("wait");
  });

  it("does not treat a just-closed modal as a refusal", () => {
    // Choosing a wallet closes the list while the wallet app is still approving.
    expect(step(closedIdle, 2_000, 0)).toBe("wait");
    expect(step(closedIdle, 2_000, DISMISS_GRACE_MS - 1)).toBe("wait");
  });

  it("keeps waiting while AppKit is busy, however long the modal has been shut", () => {
    expect(step(closedBusy, 60_000, 60_000)).toBe("wait");
  });

  it("calls a closed-and-idle modal a refusal once the grace has passed", () => {
    expect(step(closedIdle, 20_000, DISMISS_GRACE_MS)).toBe("dismissed");
  });

  it("gives up eventually, so \"not yet\" never looks like \"never\"", () => {
    expect(step(closedBusy, CONNECT_WAIT_MS, 0)).toBe("timeout");
    expect(step(open, CONNECT_WAIT_MS, 0)).toBe("timeout");
  });

  it("reports a connection that lands after a long wait", () => {
    expect(step(connected, CONNECT_WAIT_MS - 1, DISMISS_GRACE_MS - 1)).toBe("connected");
  });
});
