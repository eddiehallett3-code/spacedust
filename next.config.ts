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
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
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
};

export default nextConfig;