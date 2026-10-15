"use client";

import { useEffect, useMemo } from "react";
import type { Adapter } from "@solana/wallet-adapter-base";
import { useWrappedReownAdapter } from "@jup-ag/jup-mobile-adapter";

/**
 * Jupiter Mobile bridge.
 *
 * Jupiter's phone wallet connects through Reown's WalletConnect modal rather
 * than a browser extension, so it needs a project id and pulls in AppKit. It
 * lives in its own file so `app/providers.tsx` can load it as an async chunk —
 * deployments without `NEXT_PUBLIC_REOWN_PROJECT_ID` never download any of it,
 * and the desktop extension needs none of this: it registers itself as a
 * Wallet Standard wallet and `WalletProvider` picks it up automatically.
 *
 * The component renders `null`; its only job is to hand the adapter (a plain
 * wallet-adapter `Adapter`) up to the `WalletProvider` that owns the app's
 * wallet list. It must be client-only (`ssr: false` in the dynamic import)
 * because `createAppKit` touches the DOM during the hook's first render.
 */
export function JupiterMobileBridge({
  projectId,
  onAdapter,
}: {
  projectId: string;
  /** Stable `setState` from the parent — called once with the adapter. */
  onAdapter: (adapter: Adapter) => void;
}) {
  const appKitOptions = useMemo(() => {
    // Reown requires `metadata.url` to match the origin serving the app.
    const origin = window.location.origin;
    return {
      projectId,
      metadata: {
        name: "Spacedust",
        description: "Slingshot: swap dust tokens out of a Solana wallet.",
        url: origin,
        icons: [`${origin}/logo-512.png`],
      },
      // The Jupiter adapter opens this modal pre-filtered to Jupiter, so
      // Reown's own multi-wallet list would only duplicate our picker.
      enableWallets: false,
      features: { analytics: false },
    };
  }, [projectId]);

  const { jupiterAdapter } = useWrappedReownAdapter({ appKitOptions });

  useEffect(() => {
    onAdapter(jupiterAdapter);
  }, [jupiterAdapter, onAdapter]);

  return null;
}
