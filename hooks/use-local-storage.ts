"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * `useState` backed by localStorage.
 *
 * Two subtleties this handles that a naive version gets wrong:
 *
 *  1. **SSR hydration mismatch.** The server has no localStorage, so the first
 *     client render must use the same fallback the server used. We therefore
 *     only read storage inside `useEffect`, after hydration has already
 *     completed with the default value.
 *  2. **Corrupt or hostile storage.** A user (or an older app version) can leave
 *     anything in localStorage. Every read is validated by `validate`, and an
 *     invalid value falls back instead of crashing the app.
 */
export function useLocalStorage<T>(
  key: string,
  fallback: T,
  validate?: (value: unknown) => value is T,
  options?: {
    /**
     * `session` for a preference that should not outlive a visit.
     *
     * localStorage is the right default: a choice a user made deliberately
     * should still be there tomorrow. Some preferences are the opposite — an
     * interface depth, a temporary filter — and remembering those past the visit
     * that set them is a bug rather than a convenience.
     */
    storage?: "local" | "session";
  },
): [T, (value: T | ((previous: T) => T)) => void] {
  const [value, setValue] = useState<T>(fallback);
  const hydrated = useRef(false);
  const area = options?.storage ?? "local";

  /** Storage access can throw outright in private modes, so it is never assumed. */
  const storage = useCallback((): Storage | null => {
    try {
      return area === "session"
        ? window.sessionStorage
        : window.localStorage;
    } catch {
      return null;
    }
  }, [area]);

  useEffect(() => {
    try {
      const raw = storage()?.getItem(key);
      if (raw != null) {
        const parsed: unknown = JSON.parse(raw);
        if (validate ? validate(parsed) : true) {
          setValue(parsed as T);
        }
      }
    } catch {
      // Private browsing, quota exceeded, or corrupt JSON. Defaults are fine.
    }
    hydrated.current = true;
    // Intentionally runs once: `key` never changes for a given call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setStoredValue = useCallback(
    (next: T | ((previous: T) => T)) => {
      setValue((previous) => {
        const resolved =
          typeof next === "function"
            ? (next as (p: T) => T)(previous)
            : next;
        // Only persist after hydration, otherwise the effect above would
        // immediately overwrite what we just wrote with the fallback.
        if (hydrated.current) {
          try {
            storage()?.setItem(key, JSON.stringify(resolved));
          } catch {
            // Storage full or unavailable — in-memory state still works.
          }
        }
        return resolved;
      });
    },
    [key, storage],
  );

  return [value, setStoredValue];
}

// ── Validators for the values we persist ────────────────────────────────────

export function isNumberInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function isOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}