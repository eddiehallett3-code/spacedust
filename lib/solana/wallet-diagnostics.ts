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
        "Mobile browsers have no wallet extension, so nothing gets injected into this page. Open this site inside your wallet's own in-app browser — in Phantom, tap the browser tab and enter the address — or connect with a WalletConnect wallet such as Jupiter Mobile.",
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
