"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { STORAGE_KEYS } from "@/lib/utils/constants";

/**
 * An essential-storage notice, not a consent gate.
 *
 * Spacedust has no analytics, advertising or session-replay SDK, so there is no
 * optional tracking to consent to. This tells the visitor what the browser
 * stores, lets them dismiss the message, and links to the policy. If optional
 * analytics is ever added, this must become a real consent control first.
 *
 * It renders nothing during SSR and decides after hydration, so a visitor who
 * dismissed it does not see it flash on every navigation.
 *
 * POSITION. On a phone this used to sit at `bottom-3`, which is precisely where
 * the browser's own toolbar lives — iOS Safari's bar and Android's navigation
 * buttons covered the "Got it" button, so the notice could never be dismissed
 * and never went away. It now clears that chrome by a fixed margin plus the safe
 * area inset, and sits above the app's own sticky header in the stacking order.
 * `main` carries matching bottom padding, so nothing actionable ends up beneath
 * it either.
 */
export function CookieNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem(STORAGE_KEYS.cookieNotice) !== "1");
    } catch {
      // Storage blocked: show the notice rather than assume consent.
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  function dismiss(): void {
    try {
      window.localStorage.setItem(STORAGE_KEYS.cookieNotice, "1");
    } catch {
      // Applies for this page; it just will not survive a reload.
    }
    setVisible(false);
  }

  return (
    <div
      role="region"
      aria-label="Browser storage notice"
      className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] mx-auto flex max-w-2xl items-center gap-3 rounded-full border border-border/70 bg-space-850/95 px-3 py-2 shadow-xl backdrop-blur-xl sm:inset-x-6 sm:bottom-5 sm:px-4"
    >
      <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted">
        Essential storage only. No tracking.{" "}
        <Link
          href="/privacy"
          className="text-violet-glow underline underline-offset-2"
        >
          Privacy
        </Link>
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={dismiss}
        className="shrink-0 rounded-full px-3"
      >
        Got it
      </Button>
    </div>
  );
}
