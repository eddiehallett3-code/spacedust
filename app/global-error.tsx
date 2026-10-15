"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * The last-resort boundary: errors thrown by the root layout itself.
 *
 * `error.tsx` renders *inside* the root layout, so it cannot catch a failure in
 * the layout that renders it — the fonts, the wallet providers, the navbar and the
 * starfield all sit outside its reach. This file fills that hole, and the price is
 * that it replaces the entire document: it renders its own `<html>` and `<body>`
 * and inherits none of the chrome the rest of the site takes for granted.
 *
 * Which is why it is built from as little as possible. No `Button`, no
 * `Container`, no `ToolEmblem`, no `next/link`, no icon package — a screen whose
 * job is to appear when the app's own code has failed should not depend on that
 * code. `next/link` is the sharpest example: it needs the router, and the router
 * lives in the layout that just died, so the links here are plain `<a>` tags that
 * force a full navigation.
 *
 * The palette is repeated inline on `<body>` as a floor. `globals.css` is imported
 * above so the page is properly styled, but if the stylesheet is the thing that
 * failed, the fallback is dark text on the dark surface rather than the white
 * flash that the stock 404 used to produce — the exact failure this page must not
 * repeat.
 *
 * The safety claim is deliberately conditional, for the same reason as
 * `error.tsx`: a crash here cannot have signed anything, because signing needs the
 * wallet's own approval window, but this code does not control that window and so
 * must not promise on its behalf.
 *
 * `metadata` is unavailable — this file replaces the root layout, and the metadata
 * it would replace is part of what failed — so the title is written directly.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The only record that exists. No third-party reporting by design: the
    // security page promises no analytics, so this line and the digest below are
    // what an operator has.
    console.error("[spacedust] root layout error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        // A floor, not the design: these two values match `--color-background`
        // and `--color-foreground` in `globals.css`.
        style={{ backgroundColor: "#04050c", color: "#e8ecf8" }}
        className="min-h-dvh bg-space-950 font-sans text-foreground antialiased"
      >
        <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col items-center justify-center px-4 py-16 text-center">
          {/* Drawn, not imported: three strokes on the same 24-box grid the tool
              emblems use, so this page carries no icon dependency. */}
          <svg
            viewBox="0 0 24 24"
            width="28"
            height="28"
            fill="none"
            stroke="#fbbf24"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 4.2 L21.2 19.6 L2.8 19.6 Z" />
            <path d="M12 10.2 V14.4" />
            <path d="M12 16.9 V17" />
          </svg>

          <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            The app failed to start
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted">
            Something in the page shell itself threw before anything could be
            drawn. If your wallet never asked you to approve something, nothing
            was signed — signing needs that prompt, and this screen cannot
            produce one.
          </p>

          <div className="mt-8 flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={reset}
              className="h-12 rounded-xl bg-linear-to-r from-violet-deep via-violet-core to-indigo-core px-6 text-[0.95rem] font-medium text-white shadow-[0_8px_28px_-10px_rgba(139,92,246,0.85)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-glow"
            >
              Try again
            </button>

            <div className="flex items-center gap-3 text-sm">
              {/* A full reload, not a route change. The client router is part of
                  the shell that failed, so nothing about an in-app navigation can
                  be trusted from here. */}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-glow"
              >
                Reload the page
              </button>
              <span className="text-subtle" aria-hidden>
                ·
              </span>
              {/* A plain anchor, not `next/link`: an in-app route change goes
                  through the client router, and the router is part of the shell
                  that just failed. Only a full document load can be trusted from
                  here — which is exactly what the rule below would rather this
                  were not, so it is disabled on purpose rather than by accident.
                  Keeping it an `<a>` also preserves the link affordances a button
                  would lose: open in a new tab, copy the address. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                className="text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-glow"
              >
                Go to the home page
              </a>
            </div>
          </div>

          {error.digest ? (
            <p className="mt-12 text-xs leading-relaxed text-subtle">
              If you report this, quote{" "}
              <code className="rounded bg-white/8 px-1.5 py-0.5 font-mono">
                {error.digest}
              </code>{" "}
              — it ties the failure to its entry in the server log.
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
