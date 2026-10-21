"use client";

import {
  createContext,
  useCallback,
  useContext,
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
 * Basic is the default. Pro is stored in localStorage so a user who explicitly
 * asks for the deeper controls does not have to find the switch on every page.
 * The provider renders Basic during SSR; the preference is applied after
 * hydration, which is why the switch is a progressive enhancement rather than a
 * server branch.
 */
export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useLocalStorage<SiteMode>(
    STORAGE_KEYS.siteMode,
    "basic",
    (value): value is SiteMode => isOneOf(value, ["basic", "pro"]),
  );

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
