# Mobile wallet detection

What a phone visitor gets from the wallet picker, and what the libraries now
expect. Everything here was measured on a Galaxy S24 FE running Android 16,
with Phantom, Solflare, Backpack, Jupiter and Magic Eden installed.

## Fixed: the picker no longer collapses past the Mobile Wallet Adapter

The dialog showed an "Open this page inside your wallet" panel — Open in Phantom,
Solflare, Backpack, Jupiter — plus a WalletConnect row, and **no Mobile Wallet
Adapter row at all**. The filter behind it was:

```js
const visible = walletLinks ? wallets.filter((e) => e.adapter.name === WALLET_CONNECT_ADAPTER_NAME) : wallets;
```

The justification recorded beside it was that a phone browser cannot complete
MWA: Phantom opens and never starts the local socket, with
`ERR_CONNECTION_REFUSED` on `ws://localhost:<port>/solana-wallet`. That was the
failure Local Network Access introduced, and
`@solana-mobile/wallet-standard-mobile` addressed it in v0.5.0 by asking for the
permission first; this app ships v0.7.0.

The vendor documentation now states the opposite of what the filter assumes:

> "Once registered, MWA will appear as a wallet option for users browsing on
> Android Chrome. The connection is handled locally via Android Intents (same as
> native Android apps)."
> — <https://docs.solanamobile.com/get-started/web/installation>

> "The mitigation is already built into the library — **no code changes are
> needed**. Just update the package version…" with a one-time permission prompt
> per browser.
> — <https://docs.solanamobile.com/recipes/mobile-wallet-adapter/local-network-access>

The collapse was hiding the best remaining option from every Android visitor, on
evidence that had stopped holding. It is now gone: the rule lives in
`visibleWalletNames` (`lib/solana/wallet-diagnostics.ts`), which keeps a
registered Mobile Wallet Adapter and puts it **above** WalletConnect, because it
is the only route that finishes without leaving the page. Extension rows are
still dropped on a phone — they can only say "Install" about an app the visitor
may already have. Eight unit tests cover the rule, including the desktop case,
where nothing is filtered.

What has *not* been confirmed on a device since the change is the thing the
library depends on: the one-time Local Network Access prompt appearing in Chrome
before the handshake. The row is now offered; whether the handshake completes
against a real Phantom is the next measurement, and it needs a phone.

## A WebView is assumed to be a wallet's in-app browser

`lib/solana/wallet-diagnostics.ts`:

```js
const androidWebView = ua.includes("android") && /;\s*wv\)/.test(ua);
return knownWallet || androidWebView;
```

Any Android WebView counts as a wallet in-app browser. Measured inside an
Android WebView on the device above, that flag flips: the picker drops the
"open inside your wallet" panel and lists extension rows instead, telling the
visitor to install Phantom, Backpack and Jupiter — all three already installed,
which `pm list packages` confirms.

The same phone in Chrome takes the other branch and shows the panel. So the
`; wv)` clause is a guess that misfires on WebViews that are not wallets.

Separately, `registerMwa` refuses to register inside a generic Android WebView at
all:

```js
if (getIsLocalAssociationSupported() && (!isWebView(ua) || isSolanaMobileWebShell(ua)))
```

Only a user agent containing `Solana Mobile Web Shell` gets the wallet. That is
correct as a policy — MWA needs the WebView's intent bridge — but it means any
WebView wrapper that is not Solana Mobile's own needs that marker in its user
agent before the wallet will register.

## Not pursued: the WebView wrapper

The Android APK route was dropped, so this half is a record rather than a to-do.
It is kept because it cost a device session to find and it would cost another to
rediscover.

Inside a WebView whose user agent carried the `Solana Mobile Web Shell` marker —
with `walletLinks` null, so every adapter should have been listed — the Mobile
Wallet Adapter row was still absent. `registerMwa`'s gates all pass in that
environment: secure context, `/android/i`, `isWebView`, `isSolanaMobileWebShell`.
The wallet advertises `standard:connect`, `standard:events` and
`solana:signTransaction`, which is what `isWalletAdapterCompatibleStandardWallet`
requires. So the registration either never ran or was dropped afterwards, and
nothing reported it — the same WebView forwards other console output to logcat,
and a reload produced no MWA warning at all. A `console.log` beside the
`registerMwa` call on a preview deploy is where that trail resumes.

## What is left

1. **Watch the permission prompt on a real phone.** Android Chrome, connect,
   approve local network access once, then confirm the handshake completes. That
   is the only claim in this document still taken on trust.
2. **Re-run the picker on iOS** to confirm the fallback is unchanged: no MWA
   adapter exists there, so the list should still reduce to WalletConnect under
   the browse panel.
3. If a WebView wrapper is ever revisited, wire `isSolanaMobileWebShell` into
   `looksLikeWalletInAppBrowser` — a shell is not a wallet's browser, and the
   `; wv)` token alone cannot tell the two apart.
