import { afterEach, describe, expect, it, vi } from "vitest";
import { Transaction } from "@solana/web3.js";
import {
  WalletNotConnectedError,
  WalletReadyState,
} from "@solana/wallet-adapter-base";
import type { ConnectWaitState } from "@/lib/solana/connect-wait";
import {
  WalletConnectWalletAdapter,
  type WalletConnectBridge,
  type WalletConnectProvider,
} from "./walletconnect-adapter";

/**
 * The two properties this adapter exists to have.
 *
 * Both are regressions of a specific failure. The adapter this replaced read
 * AppKit's state once and then re-read that snapshot, so it decided the wallet
 * list was closed about half a second after opening it and could never connect.
 * And `signAllTransactions` used WalletConnect's multi-transaction request, which
 * not every wallet implements — a wallet that ignores it produces a page that
 * waits forever and a wallet that never prompts.
 */

const ADDRESS = "So11111111111111111111111111111111111111112";

function bridge(overrides: Partial<WalletConnectBridge> = {}): WalletConnectBridge {
  return {
    openWalletList: () => undefined,
    closeWalletList: () => undefined,
    disconnectSession: async () => undefined,
    connectWallet: async () => undefined,
    readState: () => ({ address: null, modalOpen: false, loading: false }),
    readProvider: () => null,
    ...overrides,
  };
}

describe("WalletConnectWalletAdapter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps asking AppKit for the state instead of holding a snapshot", async () => {
    vi.useFakeTimers();
    let state: ConnectWaitState = { address: null, modalOpen: true, loading: false };
    let polls = 0;

    const adapter = new WalletConnectWalletAdapter(
      bridge({
        readState: () => {
          polls += 1;
          return state;
        },
      }),
    );

    const connecting = adapter.connect();
    await vi.advanceTimersByTimeAsync(1_500);
    // Still no account: the wallet list is open and that is not a refusal.
    expect(polls).toBeGreaterThan(2);

    // The user picks a wallet; AppKit reports it on a later read.
    state = { address: ADDRESS, modalOpen: false, loading: false };
    await vi.advanceTimersByTimeAsync(600);

    await expect(connecting).resolves.toBeUndefined();
    expect(adapter.publicKey?.toBase58()).toBe(ADDRESS);
  });

  it("goes straight to a named wallet instead of opening the directory", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let state: ConnectWaitState = { address: null, modalOpen: false, loading: false };

    const adapter = new WalletConnectWalletAdapter(
      bridge({
        openWalletList: () => calls.push("list"),
        connectWallet: async (id) => {
          calls.push(`wallet:${id}`);
        },
        readState: () => state,
      }),
    );

    // What the picker's shortlist does before the pick, so WalletProvider's own
    // connect() takes this branch rather than opening the list.
    adapter.connectToWalletOnNextConnect("phantom");
    const connecting = adapter.connect();
    await vi.advanceTimersByTimeAsync(600);

    state = { address: ADDRESS, modalOpen: false, loading: false };
    await vi.advanceTimersByTimeAsync(600);
    await connecting;

    expect(calls).toEqual(["wallet:phantom"]);
    expect(adapter.publicKey?.toBase58()).toBe(ADDRESS);
  });

  it("is a one-shot instruction: the next connect without it opens the list", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let state: ConnectWaitState = { address: null, modalOpen: false, loading: false };

    const adapter = new WalletConnectWalletAdapter(
      bridge({
        openWalletList: () => calls.push("list"),
        connectWallet: async (id) => {
          calls.push(`wallet:${id}`);
        },
        readState: () => state,
      }),
    );

    adapter.connectToWalletOnNextConnect("phantom");
    const first = adapter.connect();
    await vi.advanceTimersByTimeAsync(600);
    state = { address: ADDRESS, modalOpen: false, loading: false };
    await vi.advanceTimersByTimeAsync(600);
    await first;

    // A later connect — after a disconnect, say — must not silently reuse it.
    adapter.disconnect();
    state = { address: null, modalOpen: false, loading: false };
    const second = adapter.connect();
    await vi.advanceTimersByTimeAsync(1_200);
    state = { address: ADDRESS, modalOpen: false, loading: false };
    await vi.advanceTimersByTimeAsync(600);
    await second;

    expect(calls).toEqual(["wallet:phantom", "list"]);
  });

  it("opens the wallet list once, and closes it when the account arrives", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let state: ConnectWaitState = { address: null, modalOpen: true, loading: false };

    const adapter = new WalletConnectWalletAdapter(
      bridge({
        openWalletList: () => calls.push("open"),
        closeWalletList: () => calls.push("close"),
        readState: () => state,
      }),
    );

    const connecting = adapter.connect();
    await vi.advanceTimersByTimeAsync(600);
    state = { address: ADDRESS, modalOpen: false, loading: false };
    await vi.advanceTimersByTimeAsync(600);
    await connecting;

    expect(calls).toEqual(["open", "close"]);
  });

  it("sends one signing request per transaction, never a batch", async () => {
    const requested: Transaction[] = [];
    const provider = {
      signTransaction: async (transaction: Transaction) => {
        requested.push(transaction);
        return transaction;
      },
    } as unknown as WalletConnectProvider;

    const adapter = new WalletConnectWalletAdapter(
      bridge({ readProvider: () => provider }),
    );

    const transactions = [new Transaction(), new Transaction(), new Transaction()];
    await expect(adapter.signAllTransactions(transactions)).resolves.toEqual(
      transactions,
    );
    // Three separate requests: the shape every wallet answers.
    expect(requested).toEqual(transactions);
  });

  it("refuses to sign when there is no live provider, rather than hanging", async () => {
    const adapter = new WalletConnectWalletAdapter(bridge());
    await expect(adapter.signTransaction(new Transaction())).rejects.toThrow(
      WalletNotConnectedError,
    );
  });

  it("reports itself as loadable so the picker offers it", () => {
    // `window` is what makes it loadable: it means "usable in this browser", not
    // "installed" — nothing is injected for WalletConnect to detect.
    vi.stubGlobal("window", {});
    const adapter = new WalletConnectWalletAdapter(bridge());
    expect(adapter.name).toBe("WalletConnect");
    expect(adapter.readyState).toBe(WalletReadyState.Loadable);
    vi.unstubAllGlobals();
  });
});
