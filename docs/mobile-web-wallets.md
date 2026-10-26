# Mobile wallet detection

What a phone visitor gets from the wallet picker, and what the libraries now
expect. Everything here was measured on a Galaxy S24 FE running Android 16,
with Phantom, Solflare, Backpack, Jupiter and Magic Eden installed.

## Tried and reverted: offering the Mobile Wallet Adapter on phones

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
permission first; this app ships v0.7.0. The vendor documentation agrees with the
filter's critics:

> "Once registered, MWA will appear as a wallet option for users browsing on
> Android Chrome. The connection is handled locally via Android Intents (same as
> native Android apps)."
> — <https://docs.solanamobile.com/get-started/web/installation>

So the row was added, above WalletConnect, and shipped. **It did not work.** On
the device above, in Android Chrome, the row appeared, the wallet opened, and
nothing answered: the picker's own timeout reported *"No response from Mobile
Wallet Adapter"*. The revert followed the same day.

The lesson is not that the library is wrong — the flow is wallet-dependent, and
the earlier report named Phantom as the wallet that opens and never answers. It
is that documentation is not a device test. A row reading "Detected — try
connecting" is a promise, and a promise that times out costs the user more than
never being offered the choice.

State now, and the rule in `visibleWalletNames`
(`lib/solana/wallet-diagnostics.ts`): on a phone, the browse panel plus
WalletConnect. The Mobile Wallet Adapter is filtered out with the extension rows,
and the comment there records what would reverse it — a phone test in which the
Local Network Access prompt appears and the handshake completes, naming the
wallet that completed it.

Four unit tests pin the current behaviour, including one that asserts the adapter
is *not* offered even when it registered, so the next person to read the vendor
docs meets the device result before the temptation to reopen it.

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

1. **If MWA is ever revisited, try a wallet other than Phantom first.** The
   browser flow is wallet-dependent, and the one tested — Phantom, the most
   likely one a visitor has — opened and never answered. Jupiter Mobile is the
   wallet the codebase's own notes credit with completing it. A test that names
   the wallet is the only kind that counts: "MWA works in Chrome" is a claim
   about a protocol, not about anybody's app.
2. **Re-run the picker on iOS** to confirm the fallback is unchanged: no MWA
   adapter exists there, so the list reduces to WalletConnect under the browse
   panel.
3. If a WebView wrapper is ever revisited, wire `isSolanaMobileWebShell` into
   `looksLikeWalletInAppBrowser` — a shell is not a wallet's browser, and the
   `; wv)` token alone cannot tell the two apart.
