"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { Card } from "@/components/ui/card";
import { ConnectWalletCta } from "@/components/wallet/wallet-button";
import { DomainsPanel } from "@/components/salvage/domains-panel";
import { RentReclaimPanel } from "@/components/sweep/rent-reclaim-panel";
import { useWalletScan } from "@/hooks/use-wallet-scan";

/**
 * Salvage.
 *
 * One page for the two things a wallet leaves behind: token accounts it has
 * emptied — by a sweep, by a sale somewhere else, or by moving a balance out by
 * hand — and `.sol` names it no longer uses. Both hold rent and nothing else, and
 * both give it back.
 *
 * They are two panels with two signatures rather than one button, because they are
 * not the same kind of decision. Closing an empty account tidies up something that
 * is already empty. Deleting a domain gives the name away, and no amount of rent
 * makes that reversible. Presenting them as one action would blur the only
 * distinction on this page that matters.
 */
export function SalvageApp() {
  const { connected } = useWallet();
  const scan = useWalletScan();

  if (!connected) {
    return (
      <Card className="mx-auto max-w-md p-6 text-center">
        <p className="text-sm font-medium">
          Connect the wallet to see what is recoverable
        </p>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted">
          Salvage closes token accounts that hold no balance and deletes the
          `.sol` names you no longer use, returning the rent those accounts were
          holding.
        </p>
        <div className="mt-4 flex justify-center">
          <ConnectWalletCta />
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* The same panel Slingshot shows, unchanged apart from `whenEmpty`: closing
          an account is half of what this page is for, so when there is nothing to
          close it says so rather than rendering nothing at all. */}
      <RentReclaimPanel
        accounts={scan.scan?.emptyAccounts ?? []}
        scanError={scan.scan?.emptyAccountsError ?? null}
        onReclaimed={() => void scan.rescan()}
        onRescan={() => void scan.rescan()}
        whenEmpty="explain"
      />
      <DomainsPanel />
    </div>
  );
}
