import type { NextConfig } from "next";
import { LOGO_REMOTE_PATTERNS } from "./lib/utils/logo-hosts";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /**
   * Where build output goes. Defaults to `.next`, as Next intends.
   *
   * WHY THIS IS OVERRIDABLE: `next dev` and `next build` both write to `.next`.
   * Run a production build while a dev server is live and the two compilations
   * interleave — the result is a manifest naming module ids that only exist in
   * the other build, which the browser reports as `Cannot read properties of
   * undefined (reading 'call')` from inside the webpack runtime, with a stack
   * that points at framework code and says nothing about the cause. Clearing
   * `.next` and restarting is the only cure, so it is worth not causing: set
   * `NEXT_DIST_DIR` to build into a directory of its own.
   *
   *   NEXT_DIST_DIR=.next-verify npm run build && npx next start -p 3100
   *
   * Nothing in the app reads this; it exists so a verification build cannot
   * disturb a dev server that is already running.
   */
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  images: {
    // Token logos render as plain `<img>` (see `TokenLogo`) so an unknown host
    // can never crash the page — but the allow-list below still matters: it
    // constrains the optimizer's own server-side fetch (the SSRF surface)
    // should any other `next/image` usage ever touch a remote URL.
    remotePatterns: LOGO_REMOTE_PATTERNS,
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  /**
   * Three dependencies that exist only in Node, pulled in optionally by the
   * WalletConnect/AppKit stack: `pino-pretty` for logger output, `lokijs` and
   * `encoding` for storage. They are never reached in a browser, and Reown's own
   * Next.js instructions say to mark them external — bundling the WalletConnect
   * chunk otherwise fails to resolve them.
   *
   * Added with the WalletConnect bridge, which is the first thing in this app to
   * pull that stack into a build at all.
   */
  webpack: (config) => {
    if (Array.isArray(config.externals)) {
      config.externals.push("pino-pretty", "lokijs", "encoding");
    }
    return config;
  },
  async headers() {
    /**
     * Wallet-facing brand files.
     *
     * They are public, so `Access-Control-Allow-Origin: *` is correct here: a
     * wallet extension or dApp browser fetches them from its own origin. The
     * cache is one week; a replacement is published under a new filename
     * (`dapp-icon-*`), so a stale cached blank never survives an update.
     */
    const iconHeaders = [
      "/dapp-icon-512.png",
      "/dapp-icon-192.png",
      "/dapp-icon-180.png",
      "/dapp-icon-512-maskable.png",
      "/favicon.ico",
      "/logo-512.png",
      "/logo-192.png",
      "/logo-512-maskable.png",
      "/icon.png",
      "/apple-touch-icon.png",
    ].map((source) => ({
      source,
      headers: [
        { key: "Access-Control-Allow-Origin", value: "*" },
        {
          key: "Cache-Control",
          value: "public, max-age=604800, stale-while-revalidate=86400",
        },
      ],
    }));

    return [
      ...iconHeaders,
      {
        /**
         * The landing saucer is a 3.2 MB GLB, and it is fetched on every
         * landing-page visit by the copy that is on screen. Serving it with the
         * same one-week cache as the sounds avoids re-downloading it on a soft
         * navigation or a refresh. The `-v1` in the filename is deliberate: an
         * updated model is published under a new name, exactly like the audio
         * files above, so an in-place overwrite can never leave a stale copy in
         * a browser cache.
         */
        source: "/3d/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=86400",
          },
        ],
      },
      {
        /**
         * The success cue must be ready the instant a transaction lands.
         *
         * Vercel serves files under `public/` with `max-age=0`, so a WebView
         * that was suspended while the wallet app approved can re-fetch the
         * 29 KB mp3 and start it seconds late. A one-week cache keeps the cue
         * local. The filenames are stable, so replacing an audio file is
         * deliberately a rename-and-update rather than an in-place overwrite.
         */
        source: "/sounds/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=86400",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            /**
             * HSTS, pinned here rather than left to the platform.
             *
             * Vercel already sends this exact value, so declaring it changes
             * nothing today — which is the point: the browser rule that makes the
             * first request of a session unforgeable would otherwise be a
             * property of the host, and a move or a plan change could drop it
             * silently. A site that can be served over plain http once is a site
             * whose wallet connection can be downgraded.
             *
             * `max-age=63072000` is two years, matching what Vercel already
             * sends, plus `includeSubDomains`.
             *
             * The `includeSubDomains` half was deliberately withheld until there
             * was a subdomain: it commits every name under the apex to HTTPS, so
             * adding it before `www` existed bought nothing and would have been a
             * promise about hosts that did not resolve. `www.spacedust.cc` now
             * holds its own certificate and redirects to the apex, so the promise
             * is one it can keep — and it closes the gap where a plain-http `www`
             * link could be intercepted before the redirect happens.
             *
             * It is still a commitment: any future subdomain has to speak HTTPS on
             * day one. That is fine for product hosts and would not be fine for a
             * host kept deliberately HTTP-only.
             *
             * Deliberately no `preload` — that is a one-way door taking months to
             * unwind, and a decision to take on purpose rather than by default.
             */
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          {
            /**
             * `camera=(self)`, NOT `camera=()`.
             *
             * WHY THIS IS NOT JUST A LOCKDOWN LIST: `camera=()` denies the camera
             * to *every* origin, the document's own included. That is not a
             * hardening choice, it is a switch that turns a feature off — and this
             * header was `camera=()` while a QR scanner was added to the app, so
             * the scanner could never have worked, in any browser, for anybody.
             *
             * The reason it is worth a comment rather than a fix: a
             * policy-denied feature does not present as a policy problem. It
             * presents as a *permission* problem. `permissions.query({ name:
             * "camera" })` answers `denied`, `getUserMedia` throws
             * `NotAllowedError`, and the site's own camera permission stays
             * granted — so the browser's site settings and its camera preview both
             * look perfectly correct, and every setting a user could check says
             * "allow". The cause is one header, and the symptom is a lie.
             *
             * `camera=(self)` keeps the point of the header: no other origin may
             * use this document's camera, and an embedded copy of this app cannot
             * inherit it. The other two stay closed outright, because nothing here
             * asks for a microphone or a location, so denying them costs nothing
             * and removes something an injected script could reach for.
             */
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  /**
   * Conventional manifest aliases.
   *
   * Next publishes the app manifest at `/manifest.webmanifest`, and the document
   * links that absolute URL. Some dApp-browser crawlers still probe
   * `/manifest.json` or `/site.webmanifest` directly; serving the same document
   * from those paths costs nothing and removes one more reason for a wallet to
   * see a dApp with no icon or name.
   */
  async rewrites() {
    return [
      { source: "/manifest.json", destination: "/manifest.webmanifest" },
      { source: "/site.webmanifest", destination: "/manifest.webmanifest" },
    ];
  },
};

export default nextConfig;