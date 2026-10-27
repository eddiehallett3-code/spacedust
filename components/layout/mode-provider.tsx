"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  isOneOf,
  useLocalStorage,
} from "@/hooks/use-local-storage";
import { STORAGE_KEYS } from "@/lib/utils/constants";

export type SiteMode = "basic" | "pro";

interface ModeContextValue {
  mode: SiteMode;
  isPro: boolean;
  setMode: (mode: SiteMode) => void;
  toggleMode: () => void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

/**
 * One interface-depth preference for the whole site.
 *
 * Basic is the default, and it is the default on **every visit**: Pro is kept in
 * `sessionStorage`, so it survives navigation and a reload but not the end of the
 * visit. Closing the tab, or coming back tomorrow, starts Basic again.
 *
 * It used to live in localStorage, which meant one click of the Pro switch put a
 * returning visitor into the destructive UI days later, on a site whose whole
 * argument is that nothing is destroyed unless it was chosen. The switch exists to
 * be reached for deliberately, not to be remembered.
 *
 * A leftover Pro value may still sit in localStorage from before this change, so
 * it is removed on mount rather than left for a future reader to find.
 *
 * The provider renders Basic during SSR; the preference is applied after
 * hydration, which is why the switch is a progressive enhancement rather than a
 * server branch.
 */
export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useLocalStorage<SiteMode>(
    STORAGE_KEYS.siteMode,
    "basic",
    (value): value is SiteMode => isOneOf(value, ["basic", "pro"]),
    { storage: "session" },
  );

  useEffect(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEYS.siteMode);
    } catch {
      // Private mode: nothing to clean up.
    }
  }, []);

  const toggleMode = useCallback(() => {
    setMode((previous) => (previous === "pro" ? "basic" : "pro"));
  }, [setMode]);

  const value = useMemo<ModeContextValue>(
    () => ({
      mode,
      isPro: mode === "pro",
      setMode,
      toggleMode,
    }),
    [mode, setMode, toggleMode],
  );

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode(): ModeContextValue {
  const value = useContext(ModeContext);
  if (value === null) {
    throw new Error("useMode must be used inside a ModeProvider.");
  }
  return value;
}
