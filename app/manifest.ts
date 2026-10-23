import type { MetadataRoute } from "next";
import { TOOLS } from "@/lib/config/tools";
import {
  DAPP_ICON_192_PATH,
  DAPP_ICON_PATH,
  DAPP_MASKABLE_ICON_PATH,
  getAppName,
  getSiteUrl,
} from "@/lib/config/site";

/**
 * The web app manifest.
 *
 * Missing until launch, which meant "Add to Home Screen" produced a bookmark with
 * no name, no colour and no icon — the browser falls back to the page title and a
 * screenshot. It is a small file that decides how the app looks once it leaves the
 * browser, which for a tool people return to is worth the twenty lines.
 *
 * The shortcuts come from `TOOLS`, so they are the same six tools the nav and the
 * landing page show and a tool that changes route cannot leave a stale entry here.
 * Colours are the ones in `globals.css` and `app/layout.tsx`'s `themeColor`, typed
 * rather than imported: this file is read by the platform, not by the app, so it
 * cannot read CSS variables and a mismatch would be invisible until someone added
 * the app to a home screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  const name = getAppName();
  const site = getSiteUrl();

  return {
    id: "/",
    scope: "/",
    name: `${name} — batch tools for a Solana wallet`,
    short_name: name,
    description:
      "Non-custodial Solana wallet tools: swap dust, send what has no market into The Void, send in batches, reclaim rent, revoke approvals, and scan any address read-only.",
    start_url: "/",
    display: "standalone",
    background_color: "#04050c",
    theme_color: "#04050c",
    lang: "en",
    dir: "ltr",
    categories: ["finance", "utilities"],
    // PNG only: Android's install prompt and several in-wallet browsers ask for
    // raster icons; an SVG is valid "as any" but not rendered by every image
    // loader, so the manifest does not advertise one.
    //
    // Absolute URLs on purpose. A dApp browser may read the manifest outside the
    // document; a relative `/dapp-icon-v2-512.png` would then resolve against the
    // wallet's origin instead of ours.
    icons: [
      {
        src: `${site}${DAPP_ICON_192_PATH}`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${site}${DAPP_ICON_PATH}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${site}${DAPP_MASKABLE_ICON_PATH}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: TOOLS.map((tool) => ({
      name: tool.name,
      short_name: tool.name,
      description: tool.tagline,
      url: `${site}${tool.href}`,
    })),
  };
}
