import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import {
  DAPP_ICON_180_PATH,
  DAPP_ICON_192_PATH,
  DAPP_ICON_PATH,
  DAPP_MASKABLE_ICON_PATH,
  getSiteUrl,
} from "@/lib/config/site";

/**
 * The files that decide what a site looks like before it is open.
 *
 * A missing `/favicon.ico` is invisible in the browser — the tab quietly falls
 * back to a blank page icon — but Jupiter's in-wallet browser and several other
 * crawlers request that path without reading the manifest. Spacedust shipped
 * without it, which is why the dApp appeared in Jupiter's search with no logo.
 *
 * The URLs must also be absolute. A crawler reading the manifest outside our
 * document resolves a relative path against the wallet's own origin, not ours,
 * which is the other way a valid icon can render as a blank tile.
 */

const ICON_FILES = [
  DAPP_ICON_192_PATH,
  DAPP_ICON_PATH,
  DAPP_ICON_180_PATH,
  DAPP_MASKABLE_ICON_PATH,
];

function publicFile(urlOrPath: string): string {
  const pathname = urlOrPath.startsWith("http")
    ? new URL(urlOrPath).pathname
    : urlOrPath;
  return path.join(process.cwd(), "public", pathname.replace(/^\//, ""));
}

describe("icons and manifest", () => {
  it("serves /favicon.ico for browsers that never read the manifest", () => {
    expect(existsSync(publicFile("/favicon.ico"))).toBe(true);
  });

  it("serves every dApp icon file referenced by metadata", () => {
    for (const file of ICON_FILES) {
      expect(existsSync(publicFile(file)), file).toBe(true);
    }
  });

  it("serves the blind Apple touch-icon requests", () => {
    for (const name of [
      "apple-touch-icon.png",
      "apple-touch-icon-precomposed.png",
    ]) {
      expect(existsSync(publicFile(name)), name).toBe(true);
    }
  });

  it("lists absolute icon URLs that actually exist", () => {
    const icons = manifest().icons ?? [];
    const sources = icons.map((icon) => icon.src ?? "");

    expect(sources).toEqual(
      expect.arrayContaining([
        `${getSiteUrl()}${DAPP_ICON_192_PATH}`,
        `${getSiteUrl()}${DAPP_ICON_PATH}`,
        `${getSiteUrl()}${DAPP_MASKABLE_ICON_PATH}`,
      ]),
    );

    for (const src of sources) {
      // A relative src is the exact failure this test exists to catch.
      expect(src.startsWith(`${getSiteUrl()}/`), src).toBe(true);
      expect(existsSync(publicFile(src)), src).toBe(true);
    }
  });
});
