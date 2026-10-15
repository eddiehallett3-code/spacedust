"use client";

import {
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
  diagnoseConnectFailure,
  type ConnectFailure,
} from "@/lib/solana/wallet-diagnostics";
import { cn } from "@/lib/utils/cn";

/**
 * How long to wait for a wallet before assuming the request went nowhere.
 *
 * Generous on purpose — a real approval prompt needs time to reach the user's
 * phone. This exists to catch the case where the wallet never answers at all,
 * not to rush a slow approval.
 */
const CONNECT_TIMEOUT_MS = 15_000;

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
    const timer = setTimeout(() => {
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
    }, CONNECT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pending]);

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
            {wallets.map(({ adapter, readyState }) => (
              <WalletRow
                key={adapter.name}
                name={adapter.name}
                icon={adapter.icon}
                url={adapter.url}
                readyState={readyState}
                pending={pending === adapter.name}
                disabled={Boolean(pending)}
                onPick={() => handlePick({ adapter, readyState })}
              />
            ))}
            {jupiterExtensionListed ? null : (
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

        {detectedCount === 0 && wallets.length > 0 ? (
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
  readyState,
  pending,
  disabled,
  onPick,
}: {
  name: WalletName;
  icon: string | undefined;
  url: string | undefined;
  readyState: WalletReadyState;
  pending: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const info = readyStateInfo(readyState);

  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        disabled={info.tone === "missing" || disabled}
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
            {info.label}
          </span>
        </span>

        {info.tone === "missing" && url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(event) => event.stopPropagation()}
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-violet-core/40 hover:text-foreground"
          >
            Install
          </a>
        ) : null}
      </button>
    </li>
  );
}
