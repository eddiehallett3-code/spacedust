"use client";

import { useCallback, useEffect, useState } from "react";
import { HISTORY_MAX_ENTRIES, STORAGE_KEYS } from "@/lib/utils/constants";
import type { SweepHistoryEntry } from "@/types/sweep";

/**
 * Sweep history, persisted in localStorage.
 *
 * This is a convenience, never a source of truth. Entries are advisory UI only:
 * nothing here is trusted for a financial calculation, and a corrupted or
 * hand-edited entry can at worst render wrong text — never move funds.
 */

/** Broadcast whenever an instance of `useSweepHistory` writes new entries. */
const SWEEP_HISTORY_EVENT = "spacedust:sweep-history-changed";

/** Read and validate the persisted history. Corrupt rows are dropped, never trusted. */
function readEntries(): SweepHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.sweepHistory);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(isHistoryEntry).slice(0, HISTORY_MAX_ENTRIES);
      }
    }
  } catch {
    // Corrupt storage. Start clean rather than crashing the app.
  }
  return [];
}

function isHistoryEntry(value: unknown): value is SweepHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<SweepHistoryEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.createdAt === "number" &&
    Number.isFinite(entry.createdAt) &&
    typeof entry.totalOutput === "number" &&
    Array.isArray(entry.signatures) &&
    Array.isArray(entry.mints)
  );
}

export function useSweepHistory() {
  const [entries, setEntries] = useState<SweepHistoryEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Read only after mount: reading during render would cause a hydration
  // mismatch, because the server has no localStorage.
  useEffect(() => {
    setEntries(readEntries());
    setHydrated(true);
  }, []);

  // Several components hold their own instance of this hook (the shell records
  // entries, the panel renders them). React state does not travel between
  // instances, so every write broadcasts a custom event that makes the others
  // re-read — otherwise a fresh sweep would only appear after a page reload.
  // The native `storage` event covers the cross-tab case for free.
  useEffect(() => {
    const resync = (): void => setEntries(readEntries());
    window.addEventListener(SWEEP_HISTORY_EVENT, resync);
    window.addEventListener("storage", resync);
    return () => {
      window.removeEventListener(SWEEP_HISTORY_EVENT, resync);
      window.removeEventListener("storage", resync);
    };
  }, []);

  const persist = useCallback((next: SweepHistoryEntry[]): void => {
    setEntries(next);
    try {
      window.localStorage.setItem(STORAGE_KEYS.sweepHistory, JSON.stringify(next));
      window.dispatchEvent(new Event(SWEEP_HISTORY_EVENT));
    } catch {
      // Storage full. History is best-effort.
    }
  }, []);

  const addEntry = useCallback(
    (entry: SweepHistoryEntry): void => {
      persist([entry, ...entries].slice(0, HISTORY_MAX_ENTRIES));
    },
    [entries, persist],
  );

  const clearHistory = useCallback((): void => {
    persist([]);
  }, [persist]);

  return { entries, addEntry, clearHistory, hydrated };
}