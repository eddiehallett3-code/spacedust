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
 * Mounted once in the provider tree so the fee is right on every panel, and
 * called again by the two places that *show* the status. The cache below holds
 * the in-flight promise rather than the result, which is what makes those extra
 * callers free: three components asking at the same moment share one request
 * instead of firing three, and the index is the thing being paid for.
 *
 * The order of effects matters: the waiver is cleared before each new address is
 * checked, so switching wallets can never inherit the last wallet's answer.
 * Failure is silent by design — a wallet that could not be checked is charged the
 * normal fee, which is what every non-holder pays anyway.
 */

const lookups = new Map<string, Promise<HolderStatus>>();

async function fetchStatus(address: string): Promise<HolderStatus> {
  const response = await fetch(
    `/api/membership?owner=${encodeURIComponent(address)}`,
  );
  const body = (await response.json()) as Partial<HolderStatus>;

  return {
    entitled: body.entitled === true,
    held: typeof body.held === "number" ? body.held : 0,
    required:
      typeof body.required === "number" ? body.required : HOLDER_REQUIRED,
    collection: body.collection ?? "",
  };
}

function statusFor(address: string): Promise<HolderStatus> {
  const existing = lookups.get(address);
  if (existing) return existing;

  const promise = fetchStatus(address).catch((error: unknown) => {
    // A failed check is not cached: the next mount retries, and until then the
    // wallet is simply not a holder.
    lookups.delete(address);
    throw error;
  });

  lookups.set(address, promise);
  return promise;
}

export function useHolderWaiver(): HolderStatus & { loading: boolean } {
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const [status, setStatus] = useState<HolderStatus>(unavailableStatus);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      resetHolderWaiver();
      setStatus(unavailableStatus());
      setLoading(false);
      return;
    }

    // Never let a previous wallet's waiver survive a switch, even for the frame
    // before the answer arrives.
    resetHolderWaiver();
    setLoading(true);

    let cancelled = false;

    void statusFor(address)
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        setHolderWaiver(next.entitled);
      })
      .catch(() => {
        if (cancelled) return;
        setStatus(unavailableStatus());
        resetHolderWaiver();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  return { ...status, loading };
}

/** Renders nothing; keeps the waiver in sync from the provider tree. */
export function HolderWaiverSync() {
  useHolderWaiver();
  return null;
}
