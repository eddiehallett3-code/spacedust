import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

/**
 * The files that decide what a site looks like before it is open.
 *
 * A missing `/favicon.ico` is invisible in the browser — the tab quietly falls
 * back to a blank page icon — but Jupiter's in-wallet browser and several other
 * crawlers request that path without reading the manifest. Spacedust shipped
 * without it, which is why the dApp appeared in Jupiter's search with no logo.
 * These assertions are deliberately about the files, not the metadata object:
 * `next build` will happily generate links to paths that do not exist.
 */

describe("icons and manifest", () => {
  it("serves /favicon.ico for browsers that never read the manifest", () => {
    expect(existsSync(path.join(process.cwd(), "public", "favicon.ico"))).toBe(
      true,
    );
  });

  it("serves a 192px PNG icon for loaders that cannot render SVG", () => {
    expect(existsSync(path.join(process.cwd(), "public", "icon.png"))).toBe(
      true,
    );
  });

  it("serves the blind Apple touch-icon requests", () => {
    for (const name of [
      "apple-touch-icon.png",
      "apple-touch-icon-precomposed.png",
    ]) {
      expect(existsSync(path.join(process.cwd(), "public", name)), name).toBe(
        true,
      );
    }
  });

  it("lists icons that actually exist, including the 192px install icon", () => {
    const icons = manifest().icons ?? [];

    expect(icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/logo-192.png", sizes: "192x192" }),
        expect.objectContaining({ src: "/logo-512.png", sizes: "512x512" }),
      ]),
    );

    for (const icon of icons) {
      if (!icon.src) continue;
      const file = path.join("public", icon.src);
      expect(existsSync(path.join(process.cwd(), file)), icon.src).toBe(true);
    }
  });
});
