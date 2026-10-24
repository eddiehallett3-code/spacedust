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
import { useMode } from "@/components/layout/mode-provider";
import { useWalletScan } from "@/hooks/use-wallet-scan";

/**
 * Salvage.
 *
 * Basic mode is the routine recovery: empty token accounts, Token-2022 rent
 * refunds, wrapped SOL, and the diagnostic list of empty accounts the token
 * program will not let this wallet close. Pro adds the one irreversible action
 * here: deleting an unused `.sns` name. The split is about consequence, not
 * difficulty: giving a name back to the open namespace deserves a deliberate
 * switch; an unwrap or a close does not.
 */
export function SalvageApp() {
  const { connected, publicKey } = useWallet();
  const { isPro } = useMode();
  const scan = useWalletScan({ includeExcessRent: true });

  if (!connected) {
    return (
      <Card className="mx-auto max-w-md p-6 text-center">
        <p className="text-sm font-medium">
          Connect the wallet to see what is recoverable
        </p>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted">
          Salvage retrieves rent, refunds the surplus rent on Token-2022
          accounts, unwraps wSOL and closes unused .sns names in Pro — returning
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

      {isPro ? (
        <section className="space-y-5" aria-label="SNS names">
          <div className="rounded-xl border border-violet-core/20 bg-violet-core/6 px-4 py-3">
            <p className="text-sm font-medium text-violet-glow">Pro cleanup</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Give unused <code>.sns</code> names back to the open namespace. Name deletion
              is previewed and simulated before anything is signed.
            </p>
          </div>

          <DomainsPanel />
        </section>
      ) : (
        <p className="rounded-xl border border-border bg-white/2 px-4 py-3 text-[11px] leading-relaxed text-subtle">
          Pro mode adds <code>.sns</code> name deletion. Turn it on in the navbar
          when you need it.
        </p>
      )}
    </div>
  );
}

