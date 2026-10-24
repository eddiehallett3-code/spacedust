"use client";

import { useEffect, useState } from "react";

/**
 * Whether the server is offering to advance network fees, and from where.
 *
 * Deliberately quiet: a failure, a slow response or no sponsor at all all mean
 * the same thing — the plan builds as an ordinary one, and a wallet without SOL
 * gets the exact-amount message instead. Nothing about the money path depends on
 * this call succeeding.
 */
export function useFeeSponsor(): { address: string | null } {
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/sponsor", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as {
          enabled?: unknown;
          sponsor?: unknown;
        };
        if (
          !cancelled &&
          body.enabled === true &&
          typeof body.sponsor === "string"
        ) {
          setAddress(body.sponsor);
        }
      } catch {
        // No sponsor. The (b) path covers it.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { address };
}
