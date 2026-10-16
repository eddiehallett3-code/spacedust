/**
 * Wallet connection diagnostics.
 *
 * A failed wallet connection is the single most opaque thing this app can do,
 * and on mobile it fails *silently*: nothing throws, nothing renders, the
 * spinner just spins. Two real examples this was written for:
 *
 *  - A plain mobile browser injects no wallet extension, so a legacy adapter
 *    sits at `NotDetected` and can never connect — the user sees a dead button.
 *  - A page served over plain http on a LAN address is not a *secure context*,
 *    so `crypto.subtle` does not exist and any handshake that needs it fails
 *    before it reaches the wallet.
 *
 * Everything here is a pure function of the environment it is handed, so the
 * messaging can be tested without a browser.
 */

export interface ConnectFailure {
  title: string;
  detail: string;
}

/** Cap an upstream throwable so a wall of text cannot wreck the modal. */
function clip(value: string, max = 200): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** Coarse device class. iPadOS reports as a Mac, so treat touch-Macs as mobile. */
export function isMobileUserAgent(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return (
    ua.includes("iphone") ||
    ua.includes("ipad") ||
    ua.includes("ipod") ||
    ua.includes("android") ||
    ua.includes("mobile")
  );
}

/**
 * Is the page running in a wallet's own in-app browser (a webview)?
 *
 * Deliberately conservative. Apple removed the reliable "Safari is absent in a
 * webview" tell back in iOS 13, so sniffing iOS webviews generically cannot be
 * done without misclassifying ordinary iOS Chrome (whose UA also omits
 * `Version/`). A false positive would tell a Safari user to "check the wallet
 * app for a pending prompt" when no wallet was ever involved — so we only claim
 * a webview when a wallet identifies itself, or on Android, where the `; wv)`
 * token is trustworthy.
 */
export function looksLikeWalletInAppBrowser(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  const knownWallet =
    ua.includes("phantom") ||
    ua.includes("solflare") ||
    ua.includes("backpack") ||
    ua.includes("sollet") ||
    ua.includes("glow");
  const androidWebView = ua.includes("android") && /;\s*wv\)/.test(ua);
  return knownWallet || androidWebView;
}

/**
 * Is this Android?
 *
 * Separate from `isMobileUserAgent` because only Android can use the Mobile Wallet
 * Adapter, and the two produce different advice: Android gets a native connect,
 * iOS gets an in-app-browser link. Treating them as one "mobile" case is what
 * leaves a phone user with no working option at all.
 */
export function isAndroidUserAgent(userAgent: string): boolean {
  return userAgent.toLowerCase().includes("android");
}

/**
 * The name the Mobile Wallet Adapter adapter reports.
 *
 * Here rather than in `app/providers.tsx` because the wallet picker needs it too,
 * and the picker is imported *by* the providers — a constant shared the other way
 * would make that a cycle. It is also the string the user sees in the picker, so
 * it is worth having one spelling of it.
 */
export const MOBILE_WALLET_ADAPTER_NAME = "Mobile Wallet Adapter";

/**
 * The name our WalletConnect adapter reports.
 *
 * Same reason `MOBILE_WALLET_ADAPTER_NAME` lives here: the picker needs it, and
 * the picker is imported *by* the providers, so a constant shared the other way
 * would make that a cycle. It is also a string the user sees, which is worth one
 * spelling of.
 *
 * Ours rather than a library's: the adapter in
 * `components/wallet/walletconnect-adapter.ts` is this app's own, and it reports
 * exactly this name. The picker matches on it to decide ordering, the subtitle and
 * the connect timeout, so the two must not drift.
 */
export const WALLET_CONNECT_ADAPTER_NAME = "WalletConnect";


/**
 * The "open this page in your wallet" deep link, for wallets that publish one.
 *
 * Taken from the adapters themselves rather than from documentation — both
 * `@solana/wallet-adapter-phantom` and `-solflare` build exactly this shape when
 * their own `connect()` decides the wallet is installed but not injected — so the
 * format cannot drift from what those wallets actually implement. A guessed URL
 * here would fail in precisely the way the user is already frustrated by: the
 * wallet opens and nothing happens.
 *
 * Why it is needed at all: a mobile browser has no wallet extension, so every
 * adapter reports "not detected" — even when the wallet is installed — and the
 * picker can offer nothing better than an Install link for an app the user has
 * already got. These links open the current page *inside* the wallet's own
 * browser, where the provider is injected and connecting works exactly as it does
 * from a desktop extension.
 *
 * Returns null for a wallet with no known browse link. The caller then shows
 * nothing rather than a button that would silently do nothing — which is why this
 * is a lookup of two wallets and not a template for any wallet name.
 */
export function walletBrowseLink(
  walletName: string,
  pageUrl: string,
  origin: string,
): string | null {
  // The wallet is matched loosely because adapter names carry suffixes
  // ("Phantom", "Phantom (Legacy)"), and `ref` is the origin so the wallet can
  // attribute the visit.
  const name = walletName.toLowerCase();
  const target = encodeURIComponent(pageUrl);
  const ref = encodeURIComponent(origin);

  if (name.includes("phantom")) {
    return `https://phantom.app/ul/browse/${target}?ref=${ref}`;
  }

  if (name.includes("solflare")) {
    return `https://solflare.com/ul/v1/browse/${target}?ref=${ref}`;
  }

  // Same shape, and not a guess: `backpack.app`'s own
  // `apple-app-site-association` declares `/ul/*` and `/ul/v1/*`, which is the
  // declaration iOS itself uses to decide the app may open those links.
  //
  // Jupiter is deliberately absent. Its site declares `/swap/*`, `/tokens/*`,
  // `/portfolio/*` and its gamification paths — and no `/ul/*` at all — so there
  // is no verified link that opens *this* page inside Jupiter's browser. Inventing
  // one would fail exactly the way this panel exists to prevent, so Jupiter is
  // reached by its WalletConnect row, which opens the app directly.
  if (name.includes("backpack")) {
    return `https://backpack.app/ul/v1/browse/${target}?ref=${ref}`;
  }

  return null;
}

/**
 * Explain a wallet connection that produced no result.
 *
 * `errorMessage` is the adapter's own error when it reported one; when it is
 * absent the connection simply never answered, which is the case that most
 * needs interpreting.
 */
export function diagnoseConnectFailure(input: {
  walletName: string;
  userAgent: string;
  /** `window.isSecureContext`. False for plain http on anything but localhost. */
  isSecureContext: boolean;
  errorMessage?: string | null;
}): ConnectFailure {
  const { walletName, userAgent, isSecureContext, errorMessage } = input;
  const mobile = isMobileUserAgent(userAgent);
  const inWalletBrowser = looksLikeWalletInAppBrowser(userAgent);

  // 1. A concrete error from the adapter is the best evidence we have, so lead
  //    with it and add the environment hint that explains it.
  if (errorMessage && errorMessage.trim().length > 0) {
    const hint = !isSecureContext
      ? " This page is not a secure origin, which blocks the cryptography a wallet connection needs."
      : mobile
        ? " If the wallet app never opened, try the wallet's own in-app browser instead."
        : " Check the extension is unlocked and allowed on this site.";
    return {
      title: `Could not connect to ${walletName}`,
      detail: `${clip(errorMessage)}${hint}`,
    };
  }

  // 2. No answer at all. The cause is almost always the environment.
  if (!isSecureContext) {
    return {
      title: "Connecting a wallet needs HTTPS",
      detail:
        "This page is served over plain http, so the browser withholds the crypto APIs a wallet connection uses and the request never reaches your wallet. Open the site over https:// (or on localhost, which browsers treat as secure).",
    };
  }

  if (mobile && !inWalletBrowser) {
    return {
      title: `No response from ${walletName}`,
      detail:
        "Mobile browsers have no wallet extension, so nothing gets injected into this page. If your wallet app just opened, this page is now loading inside it — connect there. Otherwise open this site in your wallet's own in-app browser (in Phantom, tap the browser tab and enter the address), or connect with a WalletConnect wallet such as Jupiter Mobile.",
    };
  }

  if (mobile && inWalletBrowser) {
    return {
      title: `No response from ${walletName}`,
      detail:
        "The wallet accepted the request but never replied. Check the wallet app itself for a pending approval prompt, then try again.",
    };
  }

  return {
    title: `No response from ${walletName}`,
    detail:
      "Make sure the extension is installed, unlocked, and allowed on this site, then try again.",
  };
}
