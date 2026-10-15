"use client";

import { useEffect, useMemo } from "react";
import type { Adapter } from "@solana/wallet-adapter-base";
import { useWrappedReownAdapter } from "@jup-ag/jup-mobile-adapter";

/**
 * WalletConnect (Reown) bridge.
 *
 * Two adapters come out of one AppKit instance, and the difference matters:
 *
 *   - `reownAdapter` — the generic one. Its `connect()` opens AppKit's wallet
 *     list, drawn from the WalletConnect registry: Phantom, Solflare and
 *     hundreds of others, including wallets people already have on a phone. This
 *     is the one that makes a phone work with no browser extension and without
 *     the Mobile Wallet Adapter — which matters, because Phantom's MWA support
 *     opens the app and never starts the local socket the protocol needs.
 *   - `jupiterAdapter` — a proxy over the same adapter that connects straight to
 *     Jupiter Mobile, the wallet this bridge was first built for.
 *
 * WHY `enableWallets: true`: AppKit hides its wallet-list view when this is off,
 * so the modal would open with nothing in it and the generic adapter could never
 * reach a wallet. It was off while Jupiter was the only adapter here, because
 * Jupiter connects through its own wallet-button path and never needs the list.
 *
 * Loaded as an async chunk by `app/providers.tsx`, and only when
 * `NEXT_PUBLIC_REOWN_PROJECT_ID` is set: AppKit is large, and a deployment with
 * no project id should download none of it. Client-only (`ssr: false`) because
 * `createAppKit` touches the DOM during the hook's first render.
 */
export function ReownWalletBridge({
  projectId,
  onAdapters,
}: {
  projectId: string;
  /** Stable `setState` from the parent — called with both adapters. */
  onAdapters: (adapters: Adapter[]) => void;
}) {
  const appKitOptions = useMemo(() => {
    // Reown requires `metadata.url` to match the origin serving the app, and the
    // wallet checks it against the domain allowlisted for the project. A
    // mismatch is what makes a wallet show "Cannot verify" instead of a verified
    // domain, so this must stay the real origin rather than a configured one.
    const origin = window.location.origin;
    return {
      projectId,
      metadata: {
        name: "Spacedust",
        description: "Slingshot: swap dust tokens out of a Solana wallet.",
        url: origin,
        icons: [`${origin}/logo-512.png`],
      },
      enableWallets: true,
      features: { analytics: false },
    };
  }, [projectId]);

  const { reownAdapter, jupiterAdapter } = useWrappedReownAdapter({
    appKitOptions,
  });

  useEffect(() => {
    onAdapters([reownAdapter, jupiterAdapter]);
  }, [reownAdapter, jupiterAdapter, onAdapters]);

  return null;
}
