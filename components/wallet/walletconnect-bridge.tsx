"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Adapter } from "@solana/wallet-adapter-base";
import { SolanaAdapter } from "@reown/appkit-adapter-solana";
import { solana } from "@reown/appkit/networks";
import {
  createAppKit,
  useAppKit,
  useAppKitAccount,
  useAppKitProvider,
  useAppKitState,
  useDisconnect,
} from "@reown/appkit/react";
import {
  WalletConnectWalletAdapter,
  type WalletConnectProvider,
} from "@/components/wallet/walletconnect-adapter";

/**
 * WalletConnect bridge.
 *
 * One AppKit instance, one adapter, and the whole point is what the adapter reads:
 * **live** values, never a snapshot. The library this replaced handed its adapter
 * a capture of AppKit's state taken on the first render, so half a second after
 * opening the wallet list it concluded the list was closed and failed the
 * connection — see `components/wallet/walletconnect-adapter.ts`.
 *
 * `enableWallets` has to be true: AppKit hides its wallet-list view otherwise, and
 * the list is the only way to reach a wallet. It is a wallet-directory list drawn
 * from WalletConnect's registry — Phantom, Solflare and hundreds more — which is
 * what makes a phone work with no browser extension and without the Mobile Wallet
 * Adapter.
 *
 * Loaded as an async chunk by `app/providers.tsx`, and only when
 * `NEXT_PUBLIC_REOWN_PROJECT_ID` is set: AppKit is large, and a deployment with no
 * project id should download none of it. Client-only (`ssr: false`) because
 * `createAppKit` touches the DOM during render.
 */

/**
 * AppKit may only be created once per page.
 *
 * This is module scope rather than component scope because the bridge is mounted
 * inside a provider tree that React re-mounts in development (StrictMode), and a
 * second `createAppKit` for the same project is a config conflict, not a second
 * connection.
 */
let appKitCreated = false;

function createAppKitOnce(projectId: string): void {
  if (appKitCreated) return;
  appKitCreated = true;

  createAppKit({
    adapters: [new SolanaAdapter({ wallets: [] })],
    networks: [solana],
    projectId,
    metadata: {
      // Reown requires this to match the origin serving the app, and the wallet
      // checks it against the domain allowlisted for the project: a mismatch is
      // what makes a wallet show "Cannot verify" instead of a verified domain.
      name: "Spacedust",
      description: "Slingshot: swap dust tokens out of a Solana wallet.",
      url: window.location.origin,
      icons: [`${window.location.origin}/logo-512.png`],
    },
    enableWallets: true,
    features: { analytics: false },
  });
}

/** What the adapter reads; replaced on every render, so it is never stale. */
interface LiveAppKit {
  address: string | null;
  modalOpen: boolean;
  loading: boolean;
  walletProvider: WalletConnectProvider | null;
  open: () => void;
  close: () => void;
  disconnect: () => Promise<void>;
}

export function WalletConnectBridge({
  projectId,
  onAdapters,
}: {
  projectId: string;
  /** Stable `setState` from the parent — called with the adapter. */
  onAdapters: (adapters: Adapter[]) => void;
}) {
  useMemo(() => createAppKitOnce(projectId), [projectId]);

  const { open, close } = useAppKit();
  const appKitState = useAppKitState();
  const { address } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider("solana");
  const { disconnect } = useDisconnect();

  const live = useRef<LiveAppKit>(null as unknown as LiveAppKit);
  // Written during render on purpose: the adapter is only ever called from an
  // event, and it must never read a value older than the render in progress.
  live.current = {
    address: address ?? null,
    modalOpen: appKitState.open,
    loading: appKitState.loading,
    // Structural type: this file needs four methods, not AppKit's whole provider.
    walletProvider: (walletProvider as WalletConnectProvider | null) ?? null,
    open: () => void open(),
    close: () => close(),
    disconnect: async () => {
      await disconnect();
    },
  };

  // Built once. Every member reads `live.current` at call time, so an adapter kept
  // across re-renders still sees the current wallet list, account and provider.
  const adapter = useMemo(
    () =>
      new WalletConnectWalletAdapter({
        openWalletList: () => live.current.open(),
        closeWalletList: () => live.current.close(),
        disconnectSession: () => live.current.disconnect(),
        readState: () => {
          const { address, modalOpen, loading } = live.current;
          return { address, modalOpen, loading };
        },
        readProvider: () => live.current.walletProvider,
      }),
    [],
  );

  useEffect(() => {
    onAdapters([adapter]);
  }, [adapter, onAdapters]);

  return null;
}
