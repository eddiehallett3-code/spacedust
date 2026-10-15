import {
  BaseMessageSignerWalletAdapter,
  WalletConnectionError,
  WalletDisconnectionError,
  WalletError,
  WalletName,
  WalletNotConnectedError,
  WalletReadyState,
  WalletSignMessageError,
  WalletSignTransactionError,
  type SendTransactionOptions,
} from "@solana/wallet-adapter-base";
import {
  PublicKey,
  type Connection,
  type Transaction,
  type TransactionSignature,
  type TransactionVersion,
  type VersionedTransaction,
} from "@solana/web3.js";
import { nextConnectStep, type ConnectWaitState } from "@/lib/solana/connect-wait";

/**
 * A WalletConnect wallet, as this app's wallet layer expects one.
 *
 * WHY THIS IS OURS RATHER THAN A LIBRARY'S: the adapter shipped with
 * `@jup-ag/jup-mobile-adapter` calls AppKit's state hook once, when its component
 * first renders, and then re-reads that *snapshot* inside its connect loop. Half a
 * second after opening the wallet list it compares the snapshot — `open: false`,
 * `loading: false` — against a modal the user is looking at, concludes the modal
 * was closed, and throws `AppKit adapter closed`. Reproduced against the live
 * site: the attempt failed in about two seconds with the wallet list visibly open,
 * so that adapter could never connect, with any wallet, on any device.
 *
 * The fix is structural rather than a patch: nothing here stores state. Every read
 * goes through `bridge`, which is rebuilt on every render and so is always
 * current. The decision about when to stop waiting lives in
 * `lib/solana/connect-wait.ts`, where it can be tested without a browser.
 */

/** How often the connect loop re-reads AppKit's state. */
const POLL_MS = 400;

/**
 * The part of WalletConnect's Solana provider this app uses.
 *
 * Structural rather than imported, so this file does not depend on AppKit's
 * provider class and a fake can stand in for it in a test.
 */
export interface WalletConnectProvider {
  signTransaction: <T extends Transaction | VersionedTransaction>(
    transaction: T,
  ) => Promise<T>;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  sendTransaction?: (
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options?: SendTransactionOptions,
  ) => Promise<TransactionSignature>;
}

/**
 * Everything the adapter needs from the component that owns it.
 *
 * Every member must read the **live** value at call time. The wallet list, the
 * account and the provider all change after this adapter is constructed, and an
 * adapter holding a snapshot of any of them is the bug described above.
 */
export interface WalletConnectBridge {
  openWalletList: () => void;
  closeWalletList: () => void;
  disconnectSession: () => Promise<void>;
  /** Read fresh on every call. */
  readState: () => ConnectWaitState;
  /** Read fresh on every call; null until the session supplies one. */
  readProvider: () => WalletConnectProvider | null;
  /**
   * Connect straight to a named wallet, skipping the wallet list.
   *
   * Separate from `openWalletList` because they are different journeys: one asks
   * AppKit for its directory and waits for a choice, the other goes to a wallet
   * the user has already named and never shows a list at all.
   */
  connectWallet: (id: WalletConnectWalletId) => Promise<void>;
}

export const WALLETCONNECT_NAME = "WalletConnect" as WalletName<"WalletConnect">;

/**
 * The Solana wallets this app offers by name.
 *
 * WalletConnect's own list runs to 160-odd entries, and finding Phantom in it
 * means searching. These are the wallets a Solana dust sweep actually meets, so
 * the picker offers them directly and the full list stays as the fallback for
 * everything else.
 *
 * The ids are the keys of `WalletButtonsIds` in the installed
 * `@reown/appkit-wallet-button` — not invented here — and the type below is
 * derived from this list, so a typo is a compile error rather than a button that
 * does nothing.
 */
export const WALLETCONNECT_WALLETS = [
  { id: "phantom", label: "Phantom" },
  { id: "solflare", label: "Solflare" },
  { id: "backpack", label: "Backpack" },
  { id: "jupiter", label: "Jupiter" },
] as const;

export type WalletConnectWalletId =
  (typeof WALLETCONNECT_WALLETS)[number]["id"];

export class WalletConnectWalletAdapter extends BaseMessageSignerWalletAdapter {
  name = WALLETCONNECT_NAME;
  url = "https://walletconnect.network";
  /**
   * Deliberately empty. The picker falls back to a letter badge for an adapter
   * with no icon, which is better than shipping a third party's logo in our
   * bundle to label a connection option.
   */
  icon = "";
  supportedTransactionVersions: Set<TransactionVersion> = new Set([
    "legacy",
    0,
  ]);

  private _connecting = false;
  private _publicKey: PublicKey | null = null;
  /** Set by `connectToWalletOnNextConnect`, consumed and cleared by `connect`. */
  private _namedWallet: WalletConnectWalletId | null = null;

  constructor(private readonly bridge: WalletConnectBridge) {
    super();
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  get readyState(): WalletReadyState {
    // Loadable, not Installed: nothing is injected into this page — the wallet is
    // reached over WalletConnect — so there is nothing to detect. The picker reads
    // this as usable, which is exactly right, and shows the row as tappable.
    return typeof window === "undefined"
      ? WalletReadyState.Unsupported
      : WalletReadyState.Loadable;
  }

  /**
   * Pick up a session that already exists.
   *
   * Deliberately does **not** open the wallet list: `autoConnect` runs on page
   * load for a wallet the browser remembers, and throwing a modal at someone who
   * has just arrived is not a connection, it is an interruption.
   */
  async autoConnect(): Promise<void> {
    const address = this.bridge.readState().address;
    if (!address || this._publicKey) return;
    this._publicKey = new PublicKey(address);
    this.emit("connect", this._publicKey);
  }

  async connect(): Promise<void> {
    if (this._publicKey || this._connecting) return;
    this._connecting = true;
    try {
      // A wallet the user named by hand: no list, no search. Cleared either way,
      // so a later plain connect() opens the directory as usual.
      const named = this._namedWallet;
      this._namedWallet = null;

      if (!this.bridge.readState().address) {
        if (named) await this.bridge.connectWallet(named);
        else this.bridge.openWalletList();
      }
      await this.finishConnect();
    } catch (error) {
      this.emit("error", this.asWalletError(error));
      this.emit("disconnect");
      throw error;
    } finally {
      this._connecting = false;
    }
  }

  /**
   * Connect to a named wallet on the *next* connect, instead of opening the list.
   *
   * An instruction rather than a connection, deliberately. The picker's flow is
   * "select the adapter, and let WalletProvider call `connect()`" — so connecting
   * here as well would race it, and the loser of that race would open the 160-wallet
   * directory at the same time as the wallet the user actually asked for.
   */
  connectToWalletOnNextConnect(id: WalletConnectWalletId): void {
    this._namedWallet = id;
  }

  /** Wait for the account once a connection has been asked for. */
  private async finishConnect(): Promise<void> {
    const address = await this.waitForAccount();
    this._publicKey = new PublicKey(address);
    this.emit("connect", this._publicKey);
  }

  /**
   * Wait for AppKit to produce an account.
   *
   * The loop never reads a stored value twice: `readState()` is called fresh on
   * every pass, which is what makes a "closed" reading trustworthy when it does
   * finally arrive.
   */
  private async waitForAccount(): Promise<string> {
    const started = Date.now();
    let idleSince: number | null = null;

    for (;;) {
      const state = this.bridge.readState();
      const idleClosedMs = idleSince === null ? 0 : Date.now() - idleSince;

      const step = nextConnectStep({
        state,
        waitedMs: Date.now() - started,
        idleClosedMs,
      });

      if (step === "connected") {
        this.bridge.closeWalletList();
        // Re-read: the account is what this returns, not a copy taken earlier.
        const address = this.bridge.readState().address;
        if (address) return address;
      }
      if (step === "dismissed") {
        throw new WalletConnectionError(
          "The wallet list was closed before a wallet was chosen.",
        );
      }
      if (step === "timeout") {
        throw new WalletConnectionError(
          "WalletConnect did not finish connecting. Nothing was sent or charged.",
        );
      }

      // Track closed-and-idle time; anything else resets it, so a handshake that
      // has moved to the wallet app is never mistaken for a refusal.
      idleSince =
        !state.modalOpen && !state.loading ? (idleSince ?? Date.now()) : null;

      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  async disconnect(): Promise<void> {
    this._publicKey = null;
    try {
      await this.bridge.disconnectSession();
    } catch (error) {
      this.emit(
        "error",
        new WalletDisconnectionError(
          error instanceof Error ? error.message : undefined,
          error,
        ),
      );
    }
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> {
    return this.withProvider(async (provider) => {
      try {
        return await provider.signTransaction(transaction);
      } catch (error) {
        throw new WalletSignTransactionError(
          error instanceof Error ? error.message : undefined,
          error,
        );
      }
    });
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]> {
    return this.withProvider(async (provider) => {
      try {
        // One request per transaction, deliberately.
        //
        // WalletConnect defines a multi-transaction method, and this used it. Not
        // every wallet implements it, and a wallet that does not can simply never
        // answer — which reaches the user as a page that waits forever and a
        // wallet that never prompts. A single-transaction request is the one shape
        // every wallet supports, so it is what we send. The cost is one approval
        // per transaction, which is the honest price of being asked at all.
        const signed: T[] = [];
        for (const transaction of transactions) {
          signed.push(await provider.signTransaction(transaction));
        }
        return signed;
      } catch (error) {
        throw new WalletSignTransactionError(
          error instanceof Error ? error.message : undefined,
          error,
        );
      }
    });
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    return this.withProvider(async (provider) => {
      if (!provider.signMessage) {
        throw new WalletSignMessageError("This wallet cannot sign messages.");
      }
      try {
        return await provider.signMessage(message);
      } catch (error) {
        throw new WalletSignMessageError(
          error instanceof Error ? error.message : undefined,
          error,
        );
      }
    });
  }

  async sendTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
    connection: Connection,
    options: SendTransactionOptions = {},
  ): Promise<TransactionSignature> {
    return this.withProvider(async (provider) => {
      if (!provider.sendTransaction) throw new WalletNotConnectedError();
      const signed = await provider.signTransaction(transaction);
      return provider.sendTransaction(signed, connection, options);
    });
  }

  /**
   * Wallet adapter events carry a `WalletError`, and a thrown value is not
   * necessarily one. The original stays attached as the cause, so nothing about
   * the failure is lost on the way to `toFriendlyError`.
   */
  private asWalletError(error: unknown): WalletError {
    if (error instanceof WalletError) return error;
    return new WalletError(
      error instanceof Error ? error.message : String(error),
      error,
    );
  }

  /**
   * Run something against the live provider, reporting failures the same way.
   *
   * The provider is read at call time, never stored: a signature requested after
   * a reconnect must use the session that exists now.
   */
  private async withProvider<T>(
    run: (provider: WalletConnectProvider) => Promise<T>,
  ): Promise<T> {
    const provider = this.bridge.readProvider();
    if (!provider) throw new WalletNotConnectedError();
    try {
      return await run(provider);
    } catch (error) {
      this.emit("error", this.asWalletError(error));
      throw error;
    }
  }
}
