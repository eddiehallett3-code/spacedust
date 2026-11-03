"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { Card } from "@/components/ui/card";
import { ConnectWalletCta } from "@/components/wallet/wallet-button";
import { DomainsPanel } from "@/components/salvage/domains-panel";
import { ExcessRentPanel } from "@/components/salvage/excess-rent-panel";
import { PumpAccumulatorPanel } from "@/components/salvage/pump-accumulator-panel";
import { UncloseableAccountsPanel } from "@/components/salvage/uncloseable-panel";
import { WrappedSolPanel } from "@/components/salvage/wrapped-sol-panel";
import { RentReclaimPanel } from "@/components/sweep/rent-reclaim-panel";
import { useWalletScan } from "@/hooks/use-wallet-scan";

/**
 * Salvage.
 *
 * Rent recovery for a wallet: empty token accounts, Token-2022 rent refunds,
 * wrapped SOL, the diagnostic list of empty accounts the token program will not
 * let this wallet close, and the one irreversible action here — deleting an
 * unused `.sns` name.
 *
 * That last one used to sit behind an interface mode switch, on the argument
 * that a destructive action deserves a deliberate second step. The step is real,
 * but a mode toggle is a poor place for it: it hid a whole panel behind a control
 * in the navbar, and the panel already previews and simulates before anything is
 * signed. The warning belongs next to the button, which is where it is.
 */
export function SalvageApp() {
  const { connected, publicKey } = useWallet();
  const scan = useWalletScan({ includeExcessRent: true });

  if (!connected) {
    return (
      <Card className="mx-auto max-w-md p-6 text-center">
        <p className="text-sm font-medium">
          Connect the wallet to see what is recoverable
        </p>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted">
          Salvage retrieves rent, refunds the surplus rent on Token-2022
          accounts, unwraps wSOL and closes unused .sns names — returning
          rent the wallet already owns.
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
        isScanning={scan.isScanning}
        whenEmpty="explain"
      />

      <PumpAccumulatorPanel
        account={scan.scan?.pumpAccumulator ?? null}
        scanError={scan.scan?.pumpAccumulatorError ?? null}
        onClosed={() => void scan.rescan()}
      />

      {/* Part of Basic: a Token-2022 account can hold more lamports than its
          data size requires. A refund withdraws only the surplus above the
          account's own rent-exempt reserve, leaving the token and the account
          untouched, so this is a rent recovery, not a cleanup. It hides itself
          when no account qualifies. */}
      <ExcessRentPanel
        accounts={scan.scan?.excessRentAccounts ?? []}
        scanError={scan.scan?.excessRentError ?? null}
        onWithdrawn={() => void scan.rescan()}
      />

      {/* Part of Basic: unwrapping returns the wallet's own SOL and closes an
          account that only exists to hold it. It stays visible at zero so the
          page always describes the whole tool. */}
      <WrappedSolPanel
        onUnwrapped={() => void scan.rescan()}
        whenEmpty="explain"
      />

      <UncloseableAccountsPanel
        accounts={scan.scan?.emptyAccounts ?? []}
        owner={publicKey?.toBase58() ?? ""}
        scanError={scan.scan?.emptyAccountsError ?? null}
      />

      <section className="mt-5 space-y-5" aria-label="SNS names">
        <div className="rounded-xl border border-brand-core/20 bg-brand-core/6 px-4 py-3">
          <p className="text-sm font-medium text-brand-glow">SNS names</p>
          <p className="mt-1 text-2xs leading-relaxed text-muted">
            Give unused <code>.sns</code> names back to the open namespace. Name
            deletion is previewed and simulated before anything is signed.
          </p>
        </div>

        <DomainsPanel />
      </section>
    </div>
  );
}

