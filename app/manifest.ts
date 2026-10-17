import type { MetadataRoute } from "next";
import { TOOLS } from "@/lib/config/tools";

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
  const name = process.env.NEXT_PUBLIC_APP_NAME || "Spacedust";

  return {
    name: `${name} — batch tools for a Solana wallet`,
    short_name: name,
    description:
      "Non-custodial Solana wallet tools: swap dust, send what has no market into The Void, send in batches, reclaim rent, revoke approvals, and scan any address read-only.",
    start_url: "/",
    display: "standalone",
    background_color: "#04050c",
    theme_color: "#04050c",
    // `logo-512.png` first: it is the one with the size the platform asks for,
    // and an SVG is accepted "as any" rather than pinned to a pixel size.
    icons: [
      { src: "/logo-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: TOOLS.map((tool) => ({
      name: tool.name,
      short_name: tool.name,
      description: tool.tagline,
      url: tool.href,
    })),
  };
}
