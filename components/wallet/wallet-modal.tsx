"use client";

import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Loader2, ShieldCheck, X } from "lucide-react";
import {
  WalletReadyState,
  type Adapter,
  type WalletError,
  type WalletName,
} from "@solana/wallet-adapter-base";
import {
  MOBILE_WALLET_ADAPTER_NAME,
  WALLET_CONNECT_ADAPTER_NAME,
  diagnoseConnectFailure,
  isMobileUserAgent,
  looksLikeWalletInAppBrowser,
  visibleWalletNames,
  walletBrowseLink,
  type ConnectFailure,
} from "@/lib/solana/wallet-diagnostics";
import {
  WALLETCONNECT_WALLETS,
  type WalletConnectWalletAdapter,
  type WalletConnectWalletId,
} from "@/components/wallet/walletconnect-adapter";
import { cn } from "@/lib/utils/cn";
import { playSound } from "@/lib/ui/sound";

/**
 * Wallets whose own in-app browser we can open directly.
 *
 * Only wallets with a browse link confirmed against their own universal-link
 * declaration are listed — see `walletBrowseLink`. A guessed deep link fails in
 * exactly the way this panel exists to fix, so an entry is added the day its
 * link is confirmed and not before: Backpack's `apple-app-site-association`
 * declaring `/ul/v1/*` is what earned it a place here.
 *
 * Jupiter is the one gap, and it is a real one rather than an oversight: its site
 * declares no `/ul/*` path at all, so there is no link that opens this page inside
 * Jupiter's browser. It keeps its WalletConnect row instead, which opens the app
 * directly — verified on a real device.
 */
const MOBILE_BROWSE_WALLETS = ["Phantom", "Solflare", "Backpack"] as const;

/**
 * How long to wait for a wallet before assuming the request went nowhere.
 *
 * Generous on purpose — a real approval prompt needs time to reach the user's
 * phone. This exists to catch the case where the wallet never answers at all,
 * not to rush a slow approval.
 */
const CONNECT_TIMEOUT_MS = 15_000;

/**
 * How long to wait when the wallet is reached over WalletConnect.
 *
 * Considerably longer, because the user has to leave this page to finish: the
 * wallet list opens, the wallet app takes over, they approve there and come back.
 * Fifteen seconds comfortably covers a browser extension, which answers in place,
 * but would abandon a phone handshake that is progressing perfectly well.
 *
 * This only governs the failure message — the connect attempt itself keeps going,
 * so a connection that lands late still closes the picker.
 */
const WALLETCONNECT_TIMEOUT_MS = 120_000;

/**
 * Spacedust's own wallet picker.
 *
 * Replaces `WalletModalProvider` from `@solana/wallet-adapter-react-ui`, whose
 * modal depends on that package's `styles.css` for all of its positioning. That
 * stylesheet was never imported, so the overlay rendered unstyled and
 * unclickable — which is why the Connect button did nothing. Owning the modal
 * fixes the bug and lets the picker match the app's design.
 *
 * It reads `useWallet().wallets`, which already includes Wallet Standard
 * wallets auto-registered by `WalletProvider`, so modern wallets such as
 * Backpack and the Jupiter extension appear with no extra wiring. Wallets that
 * are *not* installed never register, so known ones (Jupiter) are listed
 * anyway with an Install link.
 */

interface WalletModalApi {
  /** Open the picker. Drop-in replacement for `setVisible(true)`. */
  open: () => void;
}

const WalletModalContext = createContext<WalletModalApi>({
  open: () => undefined,
});

export function WalletModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const api = useMemo<WalletModalApi>(() => ({ open: () => setOpen(true) }), []);

  // Lock body scroll and close on Escape while the picker is open.
  useEffect(() => {
    if (!open) return;
    // Not a Radix dialog, so it does not get the pop from `DialogContent`.
    playSound("popup");
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <WalletModalContext.Provider value={api}>
      {children}
      <AnimatePresence>
        {open ? <WalletPickerDialog onClose={close} /> : null}
      </AnimatePresence>
    </WalletModalContext.Provider>
  );
}

/** Drop-in replacement for `useWalletModal()` from wallet-adapter-react-ui. */
export function useWalletModal(): WalletModalApi {
  return useContext(WalletModalContext);
}

/**
 * Human label and tone for each adapter state.
 *
 * `WalletReadyState` is a real enum, so these comparisons are checked against
 * the actual values (Installed / NotDetected / Loadable / Unsupported).
 */
function readyStateInfo(state: WalletReadyState): {
  label: string;
  tone: "ready" | "missing";
} {
  switch (state) {
    case WalletReadyState.Installed:
      return { label: "Ready to connect", tone: "ready" };
    case WalletReadyState.Loadable:
      // Detected, but the extension has not injected itself yet — common when
      // the page loaded before the extension finished loading.
      return { label: "Detected — try connecting", tone: "ready" };
    case WalletReadyState.Unsupported:
      return { label: "Not supported by this browser", tone: "missing" };
    case WalletReadyState.NotDetected:
    default:
      return { label: "Not installed", tone: "missing" };
  }
}

/**
 * Placeholder row for the Jupiter Wallet extension when it is not installed.
 *
 * A Wallet Standard wallet only shows up once its extension registers, so
 * without this row users with no Jupiter installed would never learn Spacedust
 * supports it. The row is inert (NotDetected ⇒ disabled) and links to the
 * official download page; the moment the extension registers, the real adapter
 * replaces it and `jupiterListed` hides it.
 */
const JUPITER_FALLBACK = {
  name: "Jupiter" as WalletName,
  icon: "/tokens/jup.png",
  url: "https://jup.ag/wallet",
} as const;

function WalletPickerDialog({ onClose }: { onClose: () => void }) {
  const { wallets, select, connected, connecting, wallet } = useWallet();
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<ConnectFailure | null>(null);

  // The page's secure-context status never changes mid-session, so read it once
  // (lazily, since this only ever mounts in the browser).
  const [isSecureContext] = useState(
    () => typeof window === "undefined" || window.isSecureContext,
  );

  /**
   * Wallet-browser links, set only on a phone that is *not* already inside a
   * wallet's browser.
   *
   * A mobile browser injects no provider, so every adapter reports "not detected"
   * — even for a wallet the user has installed — and the picker can offer nothing
   * better than an Install link for an app they already have. The way through is
   * to open this page inside the wallet, and these are the links that do it.
   *
   * Set in an effect rather than during render: this component only ever mounts
   * client-side, but reaching for `window` at render time is the habit that breaks
   * the day something above it becomes server-rendered.
   */
  const [walletLinks, setWalletLinks] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    const userAgent = navigator.userAgent;
    // Inside a wallet's own browser the ordinary adapters already work, so the
    // panel would be telling the user to do what they have just done.
    if (!isMobileUserAgent(userAgent) || looksLikeWalletInAppBrowser(userAgent)) return;

    const links: Record<string, string> = {};
    for (const name of MOBILE_BROWSE_WALLETS) {
      const href = walletBrowseLink(name, window.location.href, window.location.origin);
      if (href) links[name] = href;
    }

    if (Object.keys(links).length > 0) setWalletLinks(links);
  }, []);

  /**
   * Is a usable Mobile Wallet Adapter in the list?
   *
   * On Android that adapter speaks the same protocol the wallet apps themselves
   * do, so the answer is a native connect: the wallet opens and asks. Where it is
   * available the deep-link panel below is noise, so the two are mutually
   * exclusive rather than both shouting at once.
   *
   * `readyState` is part of the test, not just the name: a device with no
   * MWA-capable wallet still has the adapter constructed, and pointing a user at a
   * row that cannot work would be the same dead end in a new costume.
   */
  const hasMobileWalletAdapter = wallets.some(
    (entry) =>
      entry.adapter.name === MOBILE_WALLET_ADAPTER_NAME &&
      entry.readyState !== WalletReadyState.NotDetected,
  );

  /**
   * Which rows to list.
   *
   * The rule lives in `visibleWalletNames` so it can be tested without a
   * browser, and it is deliberately narrow on a phone: the browse panel above
   * plus WalletConnect, nothing else.
   *
   * The Mobile Wallet Adapter was briefly listed here as well, above
   * WalletConnect, because the library documentation says it works in Android
   * Chrome. On a real phone it does not: the row appeared, the wallet opened,
   * and the connection timed out with "No response from Mobile Wallet Adapter".
   * Offering a promise that dead-ends is worse than offering nothing, so it is
   * filtered out with the extensions. `visibleWalletNames` carries the full
   * account of what would justify revisiting it.
   *
   * Extension rows are dropped for the same reason: on a phone they can only
   * ever say "Install" about an app the visitor may already have.
   */
  const orderedWallets = useMemo(() => {
    const byName = new Map<string, (typeof wallets)[number]>(
      wallets.map((entry) => [String(entry.adapter.name), entry] as const),
    );

    return visibleWalletNames({
      names: wallets.map((entry) => String(entry.adapter.name)),
      hasWalletLinks: Boolean(walletLinks),
    }).flatMap((name) => {
      const entry = byName.get(name);
      return entry ? [entry] : [];
    });
  }, [wallets, walletLinks]);

  /**
   * Jupiter, for the "Open in" panel — and the one button there that is not a
   * browse link.
   *
   * Jupiter publishes no link that opens an arbitrary page inside its browser.
   * `jup.ag`'s own universal-link declaration covers `/swap/*`,
   * `/ask-for-sol/*`, `/invite/*`, `/gift/*`, `/tokens/*`, `/radar/*`,
   * `/portfolio/*`, its gamification paths and a referral catch-all — and nothing
   * that takes a URL. What Jupiter does have is the WalletConnect shortcut, which
   * opens the app directly: verified on a device, where it landed in Jupiter with
   * no second button to press. So the panel offers four ways into a wallet, and
   * this is the one that connects rather than browses.
   */
  const jupiterShortcut =
    WALLETCONNECT_WALLETS.find((wallet) => wallet.id === "jupiter") ?? null;
  const walletConnectAvailable = wallets.some(
    (entry) => entry.adapter.name === WALLET_CONNECT_ADAPTER_NAME,
  );

  // Handle for the current attempt's adapter error listener, so a second pick
  // (or unmount) never leaves a stale subscription behind.
  const listenerRef = useRef<{
    adapter: Adapter;
    handler: (error: WalletError) => void;
  } | null>(null);

  const detach = useCallback((): void => {
    const current = listenerRef.current;
    if (!current) return;
    current.adapter.off("error", current.handler);
    listenerRef.current = null;
  }, []);

  useEffect(() => detach, [detach]);

  // Close as soon as the wallet finishes connecting.
  useEffect(() => {
    if (connected && !connecting) {
      setPending(null);
      setFailure(null);
      detach();
      onClose();
    }
  }, [connected, connecting, onClose, detach]);

  /**
   * A wallet that never answers.
   *
   * This is not hypothetical: Solflare's mobile deep-link path assigns
   * `window.location` and returns without ever resolving, so `connect()` never
   * settles — nothing throws, `connecting` stays true forever, and the user is
   * left staring at a spinner. The only way to say anything useful is a timeout.
   */
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(
      () => {
        setPending(null);
        setFailure((current) =>
          current ??
          diagnoseConnectFailure({
            walletName: pending,
            userAgent: navigator.userAgent,
            isSecureContext: window.isSecureContext,
            errorMessage: null,
          }),
        );
      },
      pending === WALLET_CONNECT_ADAPTER_NAME
        ? WALLETCONNECT_TIMEOUT_MS
        : CONNECT_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [pending]);

  /**
   * Connect to a wallet the user named from the shortlist.
   *
   * The instruction goes to the adapter *before* the pick, because the pick is what
   * makes WalletProvider call `connect()` — and that call is what reads it. Doing
   * the connecting here as well would race that call, and one of the two would open
   * WalletConnect's whole directory on the way to a wallet the user had already
   * chosen.
   */
  const pickNamedWallet = (wallet: {
    id: WalletConnectWalletId;
    label: string;
  }): void => {
    const entry = wallets.find(
      (item) => item.adapter.name === WALLET_CONNECT_ADAPTER_NAME,
    );
    if (!entry || !("connectToWalletOnNextConnect" in entry.adapter)) return;

    (entry.adapter as WalletConnectWalletAdapter).connectToWalletOnNextConnect(
      wallet.id,
    );
    handlePick({ adapter: entry.adapter, readyState: entry.readyState });
  };

  const handlePick = (entry: {
    adapter: Adapter;
    readyState: WalletReadyState;
  }): void => {
    const name = entry.adapter.name;
    detach();
    setPending(name);
    setFailure(null);

    // Subscribe *before* selecting, so an immediate failure is captured.
    const handler = (error: WalletError): void => {
      setPending(null);
      setFailure(
        diagnoseConnectFailure({
          walletName: name,
          userAgent: navigator.userAgent,
          isSecureContext: window.isSecureContext,
          errorMessage: error instanceof Error ? error.message : null,
        }),
      );
    };

    try {
      entry.adapter.on("error", handler);
      listenerRef.current = { adapter: entry.adapter, handler };

      if (wallet?.adapter.name === name) {
        // Retrying the wallet that is already selected. `select` would be a
        // no-op here — WalletProvider only auto-connects when the *selected*
        // adapter changes — so the "try again" the error message suggests would
        // silently do nothing. Re-issue connect() ourselves; every adapter
        // no-ops if a connection is already in flight.
        void entry.adapter.connect().catch(() => undefined);
      } else {
        // `select` is enough: WalletProvider's autoConnect effect sees the new
        // adapter and calls `adapter.connect()`, which shows the wallet's own
        // approval prompt. Calling `connect()` here too would double-prompt.
        select(name);
      }
    } catch (error) {
      detach();
      setPending(null);
      setFailure(
        diagnoseConnectFailure({
          walletName: name,
          userAgent: navigator.userAgent,
          isSecureContext: window.isSecureContext,
          errorMessage: error instanceof Error ? error.message : null,
        }),
      );
    }
  };

  const detectedCount = wallets.filter(
    (entry) => entry.readyState !== WalletReadyState.NotDetected,
  ).length;

  // Wallet Standard wallets only register while their extension is installed,
  // so Jupiter would otherwise be invisible to anyone who has not installed it
  // yet. List it anyway with an Install link — unless the extension itself has
  // reported in. (Jupiter *Mobile* is a different wallet and does not count.)
  const jupiterExtensionListed = wallets.some(({ adapter }) => {
    const name = adapter.name.toLowerCase();
    return name.includes("jupiter") && !name.includes("mobile");
  });

return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-100 flex items-center justify-center bg-space-950/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Connect a wallet"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 14, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.97, y: 8, opacity: 0 }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
        className="glass glass-sheen w-full max-w-sm rounded-2xl p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              Connect a wallet
            </h2>
            <p className="mt-1 text-xs text-muted">
              Choose how you would like to connect.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/8 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-glow"
            aria-label="Close wallet picker"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Android, where the Mobile Wallet Adapter is present. Not shown *instead*
            of the links below, because MWA coverage is wallet-dependent: Jupiter
            completes the handshake, while Phantom opens and never starts the local
            socket the protocol needs (verified on a real device — the console shows
            `ERR_CONNECTION_REFUSED` on `ws://localhost:<port>/solana-wallet`).
            Hiding the fallback behind "this works" would leave Phantom users with a
            row that dead-ends. */}
        {hasMobileWalletAdapter && !walletLinks ? (
          <p className="mt-3 rounded-xl border border-success/25 bg-success/8 p-3 text-[11px] leading-relaxed text-muted">
            <strong className="font-medium text-foreground">
              Tap “Mobile Wallet Adapter” below
            </strong>{" "}
            — it opens the wallet you already have and asks you to approve there,
            without leaving this page. If that handshake does not complete, the
            links underneath open the whole page inside your wallet instead.
          </p>
        ) : null}

        {/* On a phone, outside a wallet's browser: the reliable route, and the only
            one on iOS. A mobile browser injects no provider, so the list underneath
            reads "not detected" for wallets the user already has installed — which
            reads as "you have not installed it", and that is the complaint this
            panel answers. Opening the page inside the wallet gives it the same
            provider a desktop extension would, and everything works from there. */}
        {walletLinks ? (
          <div className="mt-3 rounded-xl border border-violet-core/35 bg-violet-core/8 p-3">
            <p className="text-xs font-medium text-foreground">
              Open this page inside your wallet
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              The one route that works from a phone browser for every wallet,
              Phantom included. It runs this whole page inside the wallet, so
              there is nothing to connect afterwards.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(walletLinks).map(([name, href]) => (
                <a
                  key={name}
                  href={href}
                  className="rounded-lg border border-border bg-white/4 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-violet-core/45 hover:bg-white/8"
                >
                  Open in {name}
                </a>
              ))}
              {jupiterShortcut && walletConnectAvailable ? (
                <button
                  type="button"
                  onClick={() => pickNamedWallet(jupiterShortcut)}
                  disabled={Boolean(pending)}
                  className="rounded-lg border border-border bg-white/4 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-violet-core/45 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-glow disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Open in {jupiterShortcut.label}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Proactive: a plain-http origin is the most common reason a mobile
            connection silently dies, so say so before anything is clicked. */}
        {!isSecureContext ? (
          <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-warning/25 bg-warning/6 p-3 text-[11px] leading-relaxed text-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              This page is not on a secure origin, so browsers block the crypto
              APIs a wallet connection needs. Connections will likely fail —
              use https://, or localhost.
            </span>
          </p>
        ) : null}

        {/* Inline, not a toast: a toast vanishes before a user on a phone has
            read it, and this is the only explanation of what just went wrong. */}
        <AnimatePresence initial={false}>
          {failure ? (
            <motion.div
              key="connect-failure"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
              role="alert"
            >
              <div className="mt-3 rounded-xl border border-danger/25 bg-danger/6 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                  {failure.title}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  {failure.detail}
                </p>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {wallets.length === 0 ? (
          <p className="mt-4 rounded-xl border border-warning/25 bg-warning/6 p-3 text-xs text-warning">
            No wallet adapters are available. This usually means the page loaded
            before your extension injected itself — try refreshing.
          </p>
        ) : (
          <ul className="mt-4 space-y-1.5">
            {orderedWallets.map(({ adapter, readyState }) => (
              <Fragment key={adapter.name}>
                <WalletRow
                  name={adapter.name}
                  icon={adapter.icon}
                  url={adapter.url}
                  browseHref={walletLinks?.[adapter.name] ?? null}
                  note={
                    // With the named shortcuts gone, this row's whole job is to
                    // open the wallet list — and its ready-state line would read
                    // "Detected — try connecting", which is nonsense for a wallet
                    // nothing is ever injected for.
                    adapter.name === WALLET_CONNECT_ADAPTER_NAME
                      ? "Choose a wallet"
                      : null
                  }
                  readyState={readyState}
                  pending={pending === adapter.name}
                  disabled={Boolean(pending)}
                  onPick={() => handlePick({ adapter, readyState })}
                />
              </Fragment>
            ))}
            {jupiterExtensionListed || walletLinks ? null : (
              <WalletRow
                key={JUPITER_FALLBACK.name}
                name={JUPITER_FALLBACK.name}
                icon={JUPITER_FALLBACK.icon}
                url={JUPITER_FALLBACK.url}
                // NotDetected ⇒ the row renders disabled with an Install link.
                readyState={WalletReadyState.NotDetected}
                pending={false}
                disabled={Boolean(pending)}
                // Inert row (NotDetected ⇒ disabled), so the handler never fires.
                onPick={() => undefined}
              />
            )}
          </ul>
        )}

        {detectedCount === 0 && wallets.length > 0 && !walletLinks ? (
          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-subtle">
            <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
            None of these wallets are installed. Use the Install links, or try an
            in-app browser such as the one inside Phantom or Backpack on mobile.
          </p>
        ) : null}

        <p className="mt-4 flex items-start gap-1.5 border-t border-border/60 pt-3 text-[11px] leading-relaxed text-subtle">
          <ShieldCheck className="mt-px size-3 shrink-0 text-success" aria-hidden />
          Non-custodial. You approve every transaction in your own wallet, and
          Spacedust never sees your private key.
        </p>
      </motion.div>
    </motion.div>
  );
}
/** One wallet entry in the picker. */
function WalletRow({
  name,
  icon,
  url,
  browseHref,
  note,
  readyState,
  pending,
  disabled,
  onPick,
}: {
  name: WalletName;
  icon: string | undefined;
  url: string | undefined;
  /** Set on a phone: the wallet's own in-app browser, showing this page. */
  browseHref?: string | null;
  /** Replaces the ready-state line when that state is not the useful fact. */
  note?: string | null;
  readyState: WalletReadyState;
  pending: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const info = readyStateInfo(readyState);

  // On a phone, a row for an installed wallet reads "not detected" — true, and
  // useless: there is nothing to detect in a browser that has no extensions. When
  // we know how to open this page inside that wallet, the row *is* the way in, so
  // it stops being a disabled button and becomes the link. Tapping the row is what
  // people do; a small "Open" affordance beside a dead row is not.
  const openInWallet = browseHref ?? null;

  return (
    <li>
      <button
        type="button"
        onClick={
          openInWallet
            ? () => window.location.assign(openInWallet)
            : onPick
        }
        disabled={(!openInWallet && info.tone === "missing") || disabled}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border border-border bg-white/3 p-3 text-left transition-all duration-200",
          "hover:border-violet-core/45 hover:bg-white/6",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-glow",
          "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-border disabled:hover:bg-white/3",
        )}
      >
        {pending ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/6">
            <Loader2 className="size-4 animate-spin text-violet-glow" />
          </span>
        ) : icon ? (
          // Adapter icons are data: URIs shipped inside the adapter bundle, so
          // this is an inline SVG/PNG — no remote fetch, no SSRF surface.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={icon}
            alt=""
            width={36}
            height={36}
            className="size-9 shrink-0 rounded-lg"
          />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-core/15 text-xs font-semibold text-violet-glow">
            {name.charAt(0).toUpperCase()}
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span
            className={cn(
          "block text-[11px]",
          info.tone === "ready" && "text-success",
          info.tone === "missing" && "text-subtle",
        )}
          >
            {note ?? info.label}
          </span>
        </span>

        {info.tone === "missing" && (browseHref ?? url) ? (
          <a
            href={browseHref ?? url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(event) => event.stopPropagation()}
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-violet-core/40 hover:text-foreground"
          >
            {/* "Install" is the wrong word on a phone, where the app is already
                installed and what is needed is to open it. */}
            {browseHref ? "Open" : "Install"}
          </a>
        ) : null}
      </button>
    </li>
  );
}
