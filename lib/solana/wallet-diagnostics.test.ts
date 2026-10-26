import { describe, expect, it } from "vitest";
import {
  isAndroidUserAgent,
  isMobileUserAgent,
  isSolanaMobileWebShell,
  looksLikeWalletInAppBrowser,
  visibleWalletNames,
  walletBrowseLink,
} from "@/lib/solana/wallet-diagnostics";

/**
 * The mobile wallet path.
 *
 * A phone browser has no wallet extension, so every adapter reports "not
 * detected" and the picker can only offer an Install link for a wallet the user
 * already has installed. The way out is to open the page *inside* the wallet,
 * where a provider is injected — and that is what these links do.
 *
 * The shapes asserted below are copied from the adapters' own source
 * (`@solana/wallet-adapter-phantom`, `-solflare`) because a wrong URL here fails
 * exactly like the bug it is meant to fix: the wallet opens and nothing happens.
 */

const PAGE = "https://spacedust.cc/slingshot?ref=test";
const ORIGIN = "https://spacedust.cc";

describe("walletBrowseLink", () => {
  it("builds Phantom's browse link, URL-encoded", () => {
    expect(walletBrowseLink("Phantom", PAGE, ORIGIN)).toBe(
      `https://phantom.app/ul/browse/${encodeURIComponent(PAGE)}?ref=${encodeURIComponent(ORIGIN)}`,
    );
  });

  it("builds Solflare's browse link", () => {
    expect(walletBrowseLink("Solflare", PAGE, ORIGIN)).toBe(
      `https://solflare.com/ul/v1/browse/${encodeURIComponent(PAGE)}?ref=${encodeURIComponent(ORIGIN)}`,
    );
  });

  it("builds Backpack's browse link", () => {
    // Not a guess, and worth spelling out because this test used to assert the
    // opposite: `backpack.app`'s own `apple-app-site-association` declares
    // `/ul/*` and `/ul/v1/*` — the same declaration iOS reads to decide the app
    // may open a link — so the browse link exists and follows the same shape as
    // Phantom's and Solflare's.
    expect(walletBrowseLink("Backpack", PAGE, ORIGIN)).toBe(
      `https://backpack.app/ul/v1/browse/${encodeURIComponent(PAGE)}?ref=${encodeURIComponent(ORIGIN)}`,
    );
  });

  it("encodes the page URL so its own query string survives", () => {
    const link = walletBrowseLink("Phantom", PAGE, ORIGIN);

    // The `?ref=test` belongs to the page being opened, not to the deep link, so
    // it must be escaped — otherwise the wallet receives a truncated address.
    expect(link).toContain("%3Fref%3Dtest");
    expect(link?.endsWith(`?ref=${encodeURIComponent(ORIGIN)}`)).toBe(true);
  });

  it("matches the wallet name loosely enough for suffixed adapter names", () => {
    expect(walletBrowseLink("Phantom (Legacy)", PAGE, ORIGIN)).toContain("phantom.app");
    expect(walletBrowseLink("Solflare (Legacy)", PAGE, ORIGIN)).toContain("solflare.com");
    expect(walletBrowseLink("Backpack (Legacy)", PAGE, ORIGIN)).toContain("backpack.app");
  });

  it("returns null rather than guessing a link for a wallet that has none", () => {
    // Jupiter publishes no browse link: jup.ag's own universal-link declaration
    // lists /swap/*, /tokens/*, /portfolio/* and its gamification paths, and no
    // /ul/* at all. A guessed URL is worse than no button — it does nothing,
    // silently — so Jupiter is reached through WalletConnect instead, which opens
    // the app directly.
    expect(walletBrowseLink("Jupiter", PAGE, ORIGIN)).toBeNull();
  });
});

describe("the mobile checks these links depend on", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const ANDROID =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
  const DESKTOP =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

  it("recognises phones", () => {
    expect(isMobileUserAgent(IPHONE)).toBe(true);
    expect(isMobileUserAgent(ANDROID)).toBe(true);
    expect(isMobileUserAgent(DESKTOP)).toBe(false);
  });

  it("tells a wallet's own browser from an ordinary phone browser", () => {
    // The distinction the whole panel turns on: inside Phantom's browser the
    // adapter works, so telling the user to open it there would be noise.
    expect(looksLikeWalletInAppBrowser(`${ANDROID} Phantom`)).toBe(true);
    expect(looksLikeWalletInAppBrowser(ANDROID)).toBe(false);
    expect(looksLikeWalletInAppBrowser(IPHONE)).toBe(false);
  });

  it("separates Android from other phones", () => {
    // Only Android can use the Mobile Wallet Adapter, so this decides between a
    // native connect and an in-app-browser link. Getting it wrong in either
    // direction leaves the user with no working option.
    expect(isAndroidUserAgent(ANDROID)).toBe(true);
    expect(isAndroidUserAgent(IPHONE)).toBe(false);
    expect(isAndroidUserAgent(DESKTOP)).toBe(false);
  });
});


describe("which rows the picker shows", () => {
  // Registration order, as `useWallet().wallets` reports it: the configured
  // extension adapters first, WalletConnect last.
  const EVERY_ADAPTER = [
    "Phantom",
    "Solflare",
    "Backpack",
    "Jupiter",
    "WalletConnect",
  ];

  it("lists every adapter when there is no browse panel to fall back on", () => {
    // Desktop, or inside a wallet's own browser: the extension is injected, so
    // "not detected" means "not installed" and the Install links are honest.
    expect(
      visibleWalletNames({
        names: EVERY_ADAPTER,
        hasWalletLinks: false,
        hasMobileWalletAdapter: false,
      }),
    ).toEqual(EVERY_ADAPTER);
  });

  it("reduces a phone browser to WalletConnect when MWA is not registered", () => {
    // iOS, where the protocol does not exist: the panel above the list is the
    // route, and the only row that can finish is WalletConnect.
    expect(
      visibleWalletNames({
        names: EVERY_ADAPTER,
        hasWalletLinks: true,
        hasMobileWalletAdapter: false,
      }),
    ).toEqual(["WalletConnect"]);
  });

  it("keeps the Mobile Wallet Adapter on a phone, above WalletConnect", () => {
    // The bug this replaced: the row was filtered out along with the extensions,
    // so Android visitors were offered only the route that leaves the page —
    // even though the registered adapter connects natively, in place.
    expect(
      visibleWalletNames({
        names: ["WalletConnect", "Phantom", "Mobile Wallet Adapter"],
        hasWalletLinks: true,
        hasMobileWalletAdapter: true,
      }),
    ).toEqual(["Mobile Wallet Adapter", "WalletConnect"]);
  });

  it("still drops the extension rows on a phone", () => {
    // They can only say "Install" about an app the visitor may already have,
    // which is the complaint the browse panel exists to answer.
    expect(
      visibleWalletNames({
        names: ["Phantom", "Backpack", "Mobile Wallet Adapter", "WalletConnect"],
        hasWalletLinks: true,
        hasMobileWalletAdapter: true,
      }),
    ).toEqual(["Mobile Wallet Adapter", "WalletConnect"]);
  });

  it("keeps registration order when nothing is filtered", () => {
    // The desktop list must not be reordered by the mobile ranking.
    expect(
      visibleWalletNames({
        names: ["WalletConnect", "Phantom", "Mobile Wallet Adapter"],
        hasWalletLinks: false,
        hasMobileWalletAdapter: true,
      }),
    ).toEqual(["WalletConnect", "Phantom", "Mobile Wallet Adapter"]);
  });
});

describe("isSolanaMobileWebShell", () => {
  // Measured on a Galaxy S24 FE running Android 16: the shell appends its
  // marker, and `registerMwa` refuses to register inside a WebView without it.
  const ANDROID_WEBVIEW =
    "Mozilla/5.0 (Linux; Android 16; SM-S721B Build/BP4A.251205.006; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0.8059.43 Mobile Safari/537.36";

  it("recognises the marker the shell appends", () => {
    expect(
      isSolanaMobileWebShell(`${ANDROID_WEBVIEW} Solana Mobile Web Shell`),
    ).toBe(true);
  });

  it("does not claim a plain Android WebView", () => {
    // A `; wv)` token alone says nothing about MWA support, and guessing from it
    // was how the picker came to treat an app shell as a wallet's own browser.
    expect(isSolanaMobileWebShell(ANDROID_WEBVIEW)).toBe(false);
  });

  it("does not match a browser", () => {
    expect(
      isSolanaMobileWebShell(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
      ),
    ).toBe(false);
  });
});
