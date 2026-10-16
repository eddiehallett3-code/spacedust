import { describe, expect, it } from "vitest";
import { isMobileUserAgent, looksLikeWalletInAppBrowser, walletBrowseLink, isAndroidUserAgent } from "@/lib/solana/wallet-diagnostics";

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
