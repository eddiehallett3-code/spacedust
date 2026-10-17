"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { Card } from "@/components/ui/card";
import { ConnectWalletCta } from "@/components/wallet/wallet-button";
import { RentReclaimPanel } from "@/components/sweep/rent-reclaim-panel";
import { useWalletScan } from "@/hooks/use-wallet-scan";

/**
 * Salvage.
 *
 * The rent left in token accounts this wallet has emptied — by a sweep, by a sale
 * somewhere else, or by moving a balance out by hand. The account still exists,
 * still holds its rent-exempt deposit, and nothing but a close will ever release
 * it.
 *
 * One panel and one decision, because there is now one kind of decision here.
 * This page also used to delete unused `.sol` names, and that is a different act
 * in kind: closing an empty account tidies away something with nothing in it,
 * while deleting a name gives the name away for good. Every sentence had to say
 * which of the two it meant, which is a cost paid on every visit for a feature
 * that almost nobody would use.
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
          Salvage closes token accounts that hold no balance, returning the rent
          each one has been holding since it was emptied.
        </p>
        <div className="mt-4 flex justify-center">
          <ConnectWalletCta />
        </div>
      </Card>
    );
  }

  return (
    <RentReclaimPanel
      accounts={scan.scan?.emptyAccounts ?? []}
      scanError={scan.scan?.emptyAccountsError ?? null}
      onReclaimed={() => void scan.rescan()}
      onRescan={() => void scan.rescan()}
      whenEmpty="explain"
    />
  );
}

