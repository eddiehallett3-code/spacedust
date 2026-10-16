"use client";

import { useEffect } from "react";
import {
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  registerMwa,
} from "@solana-mobile/wallet-standard-mobile";
import { isAndroidUserAgent } from "@/lib/solana/wallet-diagnostics";

/**
 * Mobile Wallet Adapter, registered as a Wallet Standard wallet.
 *
 * Renders `null`. Its whole job is to make "Mobile Wallet Adapter" appear in
 * `useWallet().wallets` on Android, which `WalletProvider` does automatically for
 * anything in the Wallet Standard registry.
 *
 * **This replaced the legacy `@solana-mobile/wallet-adapter-mobile`**, and the
 * reason is worth recording because it cost a full afternoon:
 *
 * Browsers are rolling out **Local Network Access** permissions, and MWA talks to
 * the wallet over `ws://localhost:<port>`. Without permission the socket is
 * refused and the connection *silently fails* — the wallet opens and shows nothing,
 * or shows an empty approval prompt. Solana Mobile's own documentation calls this
 * out and states the mitigation: `@solana-mobile/wallet-standard-mobile` v0.5.0 or
 * later, which asks for the permission before connecting. The legacy adapter never
 * did, so every attempt died at the socket with nothing on screen to explain it.
 *
 * Registering here rather than in `app/providers.tsx` for the reason the docs give:
 * `registerMwa` must not run during SSR. An effect is client-only by definition.
 *
 * Android only. Everywhere else the standard wallet would register, report itself
 * as not detected, and sit in the picker as a greyed-out row telling the user they
 * have not installed something — with the in-app-browser links being the real
 * answer on iOS.
 */
export function MobileWalletAdapter() {
  useEffect(() => {
    if (!isAndroidUserAgent(navigator.userAgent)) return;

    registerMwa({
      appIdentity: {
        name: process.env.NEXT_PUBLIC_APP_NAME || "Spacedust",
        uri: window.location.origin,
        // Relative, as the protocol requires: the wallet resolves it against
        // `uri`. An absolute URL is rejected outright.
        icon: "/logo-512.png",
      },
      authorizationCache: createDefaultAuthorizationCache(),
      chains: ["solana:mainnet"],
      chainSelector: createDefaultChainSelector(),
      /**
       * Deliberately **not** the library's default handler.
       *
       * `createDefaultWalletNotFoundHandler` renders the library's own embedded
       * modal — "We can't find a wallet." over a button that sends the whole page
       * to solanamobile.com/wallets. It fires on *any* connect that finds no
       * wallet, and the silent connect that runs when a page loads is one of
       * them, so a phone arriving at this site gets a third-party popup before it
       * has touched anything. Reported exactly that way: "before I even click
       * connect wallet I get a popup saying can't find wallets".
       *
       * Doing nothing here is the fix, and it loses nothing: the library throws
       * the same error immediately after this returns, so the picker's own
       * failure handling reports it — in the app's words, in the panel the user is
       * already looking at, with no navigation away from the site.
       */
      onWalletNotFound: async () => undefined,
    });
  }, []);

  return null;
}
