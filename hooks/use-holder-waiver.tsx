"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  HOLDER_REQUIRED,
  unavailableStatus,
  type HolderStatus,
} from "@/lib/fees/holder-membership";
import { resetHolderWaiver, setHolderWaiver } from "@/lib/fees/holder-waiver";

/**
 * Asks the server whether the connected wallet holds enough Turtles, and sets the
 * session waiver from the answer.
 *
 * Mounted once, in the provider tree, so the fee is right on every panel without
 * each one asking. Components that want to *show* the status call this too — the
 * module-level cache below means the second caller does not cause a second
 * request.
 *
 * The order of effects matters: the waiver is cleared on disconnect and before
 * each new address is checked, so switching wallets can never inherit the last
 * one's answer. Failure is silent by design — a wallet that could not be checked
 * is charged the normal fee, which is the status quo for everyone who is not a
 * holder.
 */

const cache = new Map<string, HolderStatus>();

export function useHolderWaiver(): HolderStatus & { loading: boolean } {
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const [status, setStatus] = useState<HolderStatus>(
    address ? cache.get(address) ?? unavailableStatus() : unavailableStatus(),
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      resetHolderWaiver();
      setStatus(unavailableStatus());
      setLoading(false);
      return;
    }

    // Never let a previous wallet's waiver survive a switch, even for the frame
    // before the fetch resolves.
    resetHolderWaiver();

    const cached = cache.get(address);
    if (cached) {
      setStatus(cached);
      setHolderWaiver(cached.entitled);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const response = await fetch(
          `/api/membership?owner=${encodeURIComponent(address)}`,
          { signal: controller.signal },
        );
        const body = (await response.json()) as Partial<HolderStatus>;

        const next: HolderStatus = {
          entitled: body.entitled === true,
          held: typeof body.held === "number" ? body.held : 0,
          required: typeof body.required === "number" ? body.required : HOLDER_REQUIRED,
          collection: body.collection ?? "",
        };

        if (cancelled) return;
        cache.set(address, next);
        setStatus(next);
        setHolderWaiver(next.entitled);
      } catch {
        // Aborted, offline, or a 502: not a holder as far as this session knows.
        if (cancelled) return;
        setStatus(unavailableStatus());
        resetHolderWaiver();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [address]);

  return { ...status, loading };
}

/** Renders nothing; keeps the waiver in sync from the provider tree. */
export function HolderWaiverSync() {
  useHolderWaiver();
  return null;
}
