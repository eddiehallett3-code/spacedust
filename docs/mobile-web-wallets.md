# Mobile wallet detection

What a phone visitor gets from the wallet picker, and what the libraries now
expect. Everything here was measured on a Galaxy S24 FE running Android 16,
with Phantom, Solflare, Backpack, Jupiter and Magic Eden installed.

## On Android Chrome, the picker collapses to WalletConnect

The dialog shows an "Open this page inside your wallet" panel — Open in Phantom,
Solflare, Backpack, Jupiter — plus a WalletConnect row. The **Mobile Wallet
Adapter row never appears**, and neither do the extension rows.

That is deliberate, in `components/wallet/wallet-modal.tsx`:

```js
const visible = walletLinks ? wallets.filter((e) => e.adapter.name === WALLET_CONNECT_ADAPTER_NAME) : wallets;
```

The justification recorded beside it is that a phone browser cannot complete
MWA: Phantom opens and never starts the local socket, with
`ERR_CONNECTION_REFUSED` on `ws://localhost:<port>/solana-wallet`. That was true
of the adapter this app replaced. It is the failure Local Network Access
introduced, and `@solana-mobile/wallet-standard-mobile` addressed it in v0.5.0
by asking for the permission first; this app ships v0.7.0.

The vendor documentation now states the opposite of what the filter assumes:

> "Once registered, MWA will appear as a wallet option for users browsing on
> Android Chrome. The connection is handled locally via Android Intents (same as
> native Android apps)."
> — <https://docs.solanamobile.com/get-started/web/installation>

> "The mitigation is already built into the library — **no code changes are
> needed**. Just update the package version…" with a one-time permission prompt
> per browser.
> — <https://docs.solanamobile.com/recipes/mobile-wallet-adapter/local-network-access>

So the collapse is hiding the best remaining option from every Android visitor,
on evidence that no longer holds. It has not been changed yet: the prompt itself
has never been watched appearing on a real device, and that should happen before
flipping the behaviour.

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

## Unresolved

Inside a WebView whose user agent did carry the marker, with `walletLinks` null
(so every adapter should have been listed), the Mobile Wallet Adapter row was
still absent. `registerMwa`'s gates all pass in that environment — secure
context, `/android/i`, `isWebView`, `isSolanaMobileWebShell` — and the wallet
advertises `standard:connect`, `standard:events` and `solana:signTransaction`,
which is exactly what `isWalletAdapterCompatibleStandardWallet` requires. So the
registration is either not running or being dropped afterwards, and nothing
reports it. A `console.log` beside the `registerMwa` call, on a preview deploy,
is the next measurement.

## What to change, in order

1. A `isSolanaMobileWebShell` helper, so the `; wv)` clause does not claim a
   shell that is not a wallet browser. Unit-tested in
   `wallet-diagnostics.test.ts`, which already covers these predicates.
2. Do not collapse the list to WalletConnect when the Mobile Wallet Adapter is
   present — the intent is written at line 235 of the picker but the filter does
   not consult it.
3. Offer MWA in Android Chrome, once the local-network prompt has been seen
   working on a device.
