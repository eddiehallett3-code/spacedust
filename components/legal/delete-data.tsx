"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/components/ui/button";

/**
 * Delete the browser-side data this app keeps.
 *
 * There is no Spacedust account, so there is no server record to delete. What
 * exists is local: preferences, sweep history, hidden assets, the local tally,
 * pending lookup-table cleanup addresses, the cookie-notice flag, and whatever
 * WalletConnect/Reown stored for the connection. This clears all of it for this
 * origin, disconnects the wallet and reloads. On-chain data is public and cannot
 * be deleted, which the copy says.
 */
export function DeleteData({ contactEmail }: { contactEmail: string | null }) {
  const { disconnect } = useWallet();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function erase(): Promise<void> {
    setBusy(true);

    try {
      await disconnect();
    } catch {
      // No connected wallet, or the adapter refused; the storage clear still runs.
    }

    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      // Storage can be blocked; the browser's own site settings remain the fallback.
    }

    try {
      for (const cookie of document.cookie.split(";")) {
        const name = cookie.split("=")[0]?.trim();
        if (name) {
          document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
        }
      }
    } catch {
      // Cookies may be disabled; nothing to clear.
    }

    try {
      const factory = indexedDB as IDBFactory & {
        databases?: () => Promise<Array<{ name?: string }>>;
      };
      const databases = (await factory.databases?.()) ?? [];
      await Promise.all(
        databases.map(
          (database) =>
            new Promise<void>((resolve) => {
              if (!database.name) {
                resolve();
                return;
              }
              const request = indexedDB.deleteDatabase(database.name);
              request.onsuccess = request.onerror = request.onblocked = () =>
                resolve();
            }),
        ),
      );
    } catch {
      // IndexedDB may be unavailable; localStorage/sessionStorage are already gone.
    }

    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch {
      // Cache Storage is optional.
    }

    try {
      if (navigator.serviceWorker) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
    } catch {
      // No service worker support.
    }

    window.location.reload();
  }

  if (!confirming) {
    return (
      <div className="space-y-3">
        <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
          Delete my data
        </Button>
        <p className="text-xs leading-relaxed text-muted">
          This removes this app&apos;s local data from this browser and
          disconnects your wallet. It cannot change anything on the blockchain.
        </p>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="rounded-xl border border-danger/25 bg-danger/6 p-4"
    >
      <p className="text-sm leading-relaxed text-muted">
        This disconnects your wallet and deletes this app&apos;s local storage,
        session storage, cookies, caches and IndexedDB databases for this site.
        That includes preferences, sweep history, hidden assets, the local tally,
        pending lookup-table cleanup addresses and WalletConnect session data. It
        does not delete anything on chain, and it cannot delete data held by your
        wallet provider.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        There is no Spacedust account to delete. If you have sent us a support
        email and want it removed,{" "}
        {contactEmail ? (
          <>
            email{" "}
            <a
              href={`mailto:${contactEmail}`}
              className="text-violet-glow underline"
            >
              {contactEmail}
            </a>
            .
          </>
        ) : (
          <span>use the legal contact on the privacy page.</span>
        )}
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button variant="danger" size="sm" disabled={busy} onClick={() => void erase()}>
          {busy ? "Deleting…" : "Disconnect and delete"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
