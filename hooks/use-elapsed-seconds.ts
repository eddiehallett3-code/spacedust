"use client";

import { useEffect, useState } from "react";

/**
 * Seconds since `active` turned true, or 0 when it is off.
 *
 * The point is honesty about a wait rather than a progress bar: the client cannot
 * see which phase the server is in — the scan is one request — so anything that
 * claimed to be "pricing tokens, 40% done" would be invented. A clock that counts
 * is not invented, and a person waiting forty-nine seconds for a large wallet is
 * much better off being told that forty-nine seconds is normal.
 *
 * Ticks once a second, and only while active: an idle page has no interval running.
 */
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [active]);

  return seconds;
}
