"use client";

import { useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";
import type { Adapter, WalletAdapter } from "@solana/wallet-adapter-base";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletModalProvider } from "@/components/wallet/wallet-modal";

/**
 * Client-side providers.
 *
 * Wallet adapters are constructed inside `useMemo` and each is registered
 * defensively. A single wallet extension throwing on construction must not be
 * able to take down the whole app — the user should still be able to connect
 * with the wallets that *do* work.
 *
 * Jupiter's browser extension needs no adapter of its own: it registers as a
 * Wallet Standard wallet, and `WalletProvider` merges every registered
 * standard wallet into `wallets` automatically (see `useStandardWalletAdapters`
 * in @solana/wallet-adapter-react). Jupiter *Mobile* — the phone wallet, joined
 * by QR code — is the one piece that needs wiring, below.
 */

const RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";

/**
 * Free project id from https://dashboard.reown.com — powers the WalletConnect
 * modal behind "Jupiter Mobile". Optional: without it the adapter is simply
 * never loaded, and everything else keeps working.
 */
const REOWN_PROJECT_ID =
  process.env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim() || null;

/**
 * Async chunk: Reown's AppKit is large, so it must not land in the main bundle
 * for deployments that do not configure a project id. `ssr: false` because
 * `createAppKit` touches the DOM; the bridge renders `null`, so nothing about
 * the server-rendered page changes either way.
 */
const JupiterMobileBridge = dynamic(
  () =>
    import("@/components/wallet/jupiter-mobile-bridge").then(
      (module) => module.JupiterMobileBridge,
    ),
  { ssr: false },
);


function buildAdapters(): WalletAdapter[] {
  const adapters: WalletAdapter[] = [];

  const register = (label: string, factory: () => WalletAdapter) => {
    try {
      adapters.push(factory());
    } catch (error) {
      console.warn(
        `[spacedust] Skipped ${label} wallet adapter:`,
        error instanceof Error ? error.message : error,
      );
    }
  };

  // Browser extensions. Also covers in-app browsers on mobile.
  register("Phantom", () => new PhantomWalletAdapter());
  register("Solflare", () => new SolflareWalletAdapter());

  // Backpack's adapter package is deprecated upstream — Backpack now registers
  // as a Wallet Standard wallet, which `WalletProvider` auto-merges into the
  // list. We keep the legacy adapter too, so Backpack still appears if the
  // standard registry has not picked it up yet.
  register("Backpack", () => new BackpackWalletAdapter());

  return adapters;
}

export function Providers({ children }: { children: ReactNode }) {
  // Built once per browser session; the optional Jupiter Mobile adapter is
  // appended when its chunk finishes loading (see `JupiterMobileBridge`).
  const [jupiterMobile, setJupiterMobile] = useState<Adapter | null>(null);

  const wallets = useMemo(() => {
    const adapters: WalletAdapter[] = buildAdapters();
    return jupiterMobile ? [...adapters, jupiterMobile] : adapters;
  }, [jupiterMobile]);

  // NOTE: we deliberately do NOT use `WalletModalProvider` from
  // `@solana/wallet-adapter-react-ui`. Its modal depends on that package's
  // `styles.css` for all of its positioning, and that stylesheet was never
  // imported — so the overlay rendered unstyled and unclickable, which is why
  // the Connect button did nothing. `WalletModalProvider` below owns its own
  // open state and takes no props.
  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      {/*
        `autoConnect` MUST be true.

        `WalletProvider` only calls `adapter.connect()` after the user picks a
        wallet when `autoConnect` is truthy — see `handleAutoConnectRequest` in
        @solana/wallet-adapter-react, which returns early when it is falsy.
        With `autoConnect={false}` the Connect button silently does nothing.

        This does NOT mean "prompt on page load". On a first visit the provider
        calls `adapter.autoConnect()`, which resolves quietly unless the user has
        already approved this site. Only after an explicit pick does it call
        `connect()` and show the wallet's approval prompt.
      */}
      <WalletProvider wallets={wallets} autoConnect onError={onAdapterError}>
        {REOWN_PROJECT_ID ? (
          <JupiterMobileBridge
            projectId={REOWN_PROJECT_ID}
            onAdapter={setJupiterMobile}
          />
        ) : null}
        <WalletModalProvider>
          <TooltipProvider delayDuration={200}>
            {children}
            {/* Toasts: top-centre on mobile. */}
            <Toaster
              position="top-center"
              richColors
              closeButton
              theme="dark"
              toastOptions={{
                classNames: {
                  toast: "!bg-space-850/95 !border-white/10 !text-foreground !backdrop-blur-xl",
                  description: "!text-muted",
                },
              }}
            />
          </TooltipProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

/**
 * Adapter errors are noisy and usually benign (an extension is locked, or the
 * user cancelled inside the wallet). Logging is enough — surfacing them as a
 * thrown error would tear down the whole provider tree.
 */
function onAdapterError(error: Error): void {
  console.warn("[spacedust] wallet adapter error:", error.message);
}