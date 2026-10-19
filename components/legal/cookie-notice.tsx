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
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-xl border border-border/70 bg-space-850/95 p-3 shadow-xl backdrop-blur-xl sm:inset-x-6 sm:bottom-5 sm:p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-muted">
          No analytics, advertising or session-replay cookies. Spacedust uses
          only essential browser storage for your wallet connection and
          preferences.{" "}
          <Link
            href="/privacy"
            className="text-violet-glow underline underline-offset-2"
          >
            Privacy policy
          </Link>
          .
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={dismiss}
          className="shrink-0 self-end sm:self-auto"
        >
          Got it
        </Button>
      </div>
    </div>
  );
}
