"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { apiFetch } from "@/lib/utils/api";
import { toFriendlyError, type FriendlyError } from "@/lib/utils/errors";
import type { WalletScan } from "@/types/token";

/**
 * Scans the connected wallet for dust.
 *
 * Notes on behaviour:
 *  - The scan is aborted if the wallet disconnects or the component unmounts,
 *    so a slow response cannot overwrite a newer one.
 *  - The result is kept from the previous wallet until a new one arrives, but
 *    it is cleared on wallet change so dust from wallet A never appears under
 *    wallet B.
 */
export function useWalletScan() {
  const { publicKey, connected } = useWallet();
  const owner = publicKey?.toBase58() ?? null;

  const [scan, setScan] = useState<WalletScan | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Guards against a stale response landing after a newer scan started.
  const requestIdRef = useRef(0);

  const scan_ = useCallback(async (): Promise<void> => {
    if (!owner) {
      setScan(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setIsScanning(true);
    setError(null);

    try {
      const result = await apiFetch<WalletScan>(
        `/api/tokens?owner=${encodeURIComponent(owner)}`,
        {
          signal: controller.signal,
          timeoutMs: 45_000,
          // Wallets rarely change within a few seconds, and this is the single
          // most expensive call in the app.
          cacheMs: 10_000,
        },
      );

      // Discard a response that arrived after a newer request began.
      if (requestId !== requestIdRef.current) return;
      setScan(result);
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (requestId !== requestIdRef.current) return;
      setScan(null);
      setError(toFriendlyError(caught));
    } finally {
      if (requestId === requestIdRef.current) {
        setIsScanning(false);
      }
    }
  }, [owner]);

  // Auto-scan on connect and on wallet change.
  useEffect(() => {
    if (!connected || !owner) {
      abortRef.current?.abort();
      setScan(null);
      setError(null);
      setIsScanning(false);
      return;
    }
    void scan_();
    return () => abortRef.current?.abort();
  }, [connected, owner, scan_]);

  /** Manual rescan, wired to the refresh button. */
  const rescan = useCallback(async (): Promise<void> => {
    abortRef.current?.abort();
    requestIdRef.current += 1; // invalidate any in-flight response
    await scan_();
  }, [scan_]);

  return {
    scan,
    tokens: useMemo(() => scan?.tokens ?? [], [scan]),
    // Kept separate all the way to the UI. Nothing here is ever swept, so this
    // must never be folded into `tokens`.
    nonFungibles: useMemo(() => scan?.nonFungibles ?? [], [scan]),
    native: scan?.native ?? null,
    isScanning,
    error,
    rescan,
    owner,
  };
}