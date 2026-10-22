"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { Card } from "@/components/ui/card";
import { ConnectWalletCta } from "@/components/wallet/wallet-button";
import { DomainsPanel } from "@/components/salvage/domains-panel";
import { UncloseableAccountsPanel } from "@/components/salvage/uncloseable-panel";
import { WrappedSolPanel } from "@/components/salvage/wrapped-sol-panel";
import { RentReclaimPanel } from "@/components/sweep/rent-reclaim-panel";
import { useMode } from "@/components/layout/mode-provider";
import { useWalletScan } from "@/hooks/use-wallet-scan";

/**
 * Salvage.
 *
 * Basic mode is the routine recovery: close token accounts that hold no balance
 * and unwrap wrapped SOL. Both give back something the wallet already owns —
 * rent from an empty account, and the SOL behind a wSOL balance — without
 * destroying an asset.
 *
 * Pro adds the one irreversible action here, deleting an unused `.sns` name,
 * plus the diagnostic list of empty accounts this wallet cannot close. The split
 * is about consequence, not difficulty: giving a name back to the open namespace
 * deserves a deliberate switch; an unwrap does not.
 */
export function SalvageApp() {
  const { connected, publicKey } = useWallet();
  const { isPro } = useMode();
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
    <div className="space-y-5">
      <RentReclaimPanel
        accounts={scan.scan?.emptyAccounts ?? []}
        scanError={scan.scan?.emptyAccountsError ?? null}
        onReclaimed={() => void scan.rescan()}
        onRescan={() => void scan.rescan()}
        whenEmpty="explain"
      />

      {/* Part of Basic: unwrapping returns the wallet's own SOL and closes an
          account that only exists to hold it. When there is none, the panel
          removes itself rather than adding a second empty-state card. */}
      <WrappedSolPanel
        onUnwrapped={() => void scan.rescan()}
        whenEmpty="hide"
      />

      {isPro ? (
        <section className="space-y-5" aria-label="Pro cleanup">
          <div className="rounded-xl border border-violet-core/20 bg-violet-core/6 px-4 py-3">
            <p className="text-sm font-medium text-violet-glow">Pro cleanup</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Give unused `.sns` names back to the open namespace, and see which
              empty accounts the token program will not let this wallet close.
              Name deletion is previewed and simulated before anything is signed;
              the diagnostics list is read-only.
            </p>
          </div>

          <DomainsPanel />

          <UncloseableAccountsPanel
            accounts={scan.scan?.emptyAccounts ?? []}
            owner={publicKey?.toBase58() ?? ""}
            scanError={scan.scan?.emptyAccountsError ?? null}
          />
        </section>
      ) : (
        <p className="rounded-xl border border-border bg-white/2 px-4 py-3 text-[11px] leading-relaxed text-subtle">
          Pro mode adds `.sns` name deletion and a list of accounts this wallet
          cannot close. Turn on Pro in the navbar when you need them.
        </p>
      )}
    </div>
  );
}

