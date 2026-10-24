"use client";

import { ExternalLink, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  SectionTitle,
} from "@/components/ui/card";
import { SimulationReport } from "@/components/sweep/simulation-report";
import { SponsorAdvanceNote } from "@/components/salvage/sponsor-advance-note";
import { SweepError } from "@/components/sweep/controls-column";
import { WarningsList } from "@/components/sweep/warnings-list";
import { useExcessRent } from "@/hooks/use-excess-rent";
import { solscanTxUrl } from "@/lib/solana/submit";
import { feeFromRentLamports } from "@/lib/solana/rent";
import { RECLAIM_RATE } from "@/lib/config/tools";
import { getPublicFeeWallet } from "@/lib/config/public-env";
import { RECLAIM_FEE_BPS } from "@/lib/utils/constants";
import { formatSol, pluralize, truncateAddress } from "@/lib/utils/format";
import type { ExcessRentAccount } from "@/types/salvage";

/**
 * Rent refund.
 *
 * A Token-2022 account can hold more lamports than its data size requires: an
 * old deposit, a program credit, or a manual top-up. `WithdrawExcessLamports`
 * returns only the surplus above the account's own rent-exempt reserve, and
 * leaves the account and its tokens exactly where they are.
 *
 * The user-facing name is "rent refund", because that is what happens to the
 * person reading the card: rent comes back and nothing is cleaned up or given
 * away. The internal names stay `excess*` — the instruction really is
 * `WithdrawExcessLamports`, and renaming the code to match a label would make
 * the mapping to Token-2022 harder to follow, not easier.
 *
 * This card surfaces those accounts and prices the same 1.5% reclaim fee the
 * other rent flows charge.
 */
export function ExcessRentPanel({
  accounts,
  scanError,
  onWithdrawn,
}: {
  accounts: ExcessRentAccount[];
  scanError: string | null;
  /** Called after a successful withdrawal, so the page can rescan. */
  onWithdrawn: () => void;
}) {
  const withdraw = useExcessRent();

  if (accounts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <SectionTitle
            icon={<Landmark className="size-4" aria-hidden />}
            title="Rent refund"
            description="Token accounts can hold lamports above their own rent-exempt reserve. A refund withdraws only that surplus — the account stays open and the tokens stay where they are."
          />
        </CardHeader>
        <CardContent>
          {scanError ? (
            <p className="rounded-xl border border-warning/25 bg-warning/8 px-3 py-2.5 text-[11px] leading-relaxed text-warning">
              {scanError}
            </p>
          ) : (
            <p className="rounded-xl border border-border bg-white/2 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
              No rent refunds found. This checks Token-2022 accounts for lamports
              above their own rent-exempt reserve.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  const hasPreview = withdraw.packed.length > 0;
  const summary = withdraw.summary;

  const scannedExcess = accounts.reduce(
    (sum, account) => sum + account.excessLamports,
    0,
  );
  const scannedFee =
    getPublicFeeWallet() === null
      ? 0
      : accounts.reduce(
          (sum, account) =>
            sum + feeFromRentLamports(account.excessLamports, RECLAIM_FEE_BPS),
          0,
        );
  const excessLamports = hasPreview ? withdraw.excessLamports : scannedExcess;
  const reclaimFeeLamports = hasPreview
    ? withdraw.reclaimFeeLamports
    : scannedFee;
  const netRentLamports = hasPreview
    ? withdraw.netRentLamports
    : scannedExcess - scannedFee;

  return (
    <Card>
      <CardHeader>
        <SectionTitle
          icon={<Landmark className="size-4" aria-hidden />}
          title="Rent refund"
          description="Token accounts can hold lamports above their own rent-exempt reserve. A refund withdraws only that surplus — the account stays open and the tokens stay where they are."
        />
      </CardHeader>

      <CardContent className="flex flex-col gap-4">

        {summary ? (
          <div className="rounded-xl border border-success/25 bg-success/6 p-3">
            <p className="text-sm font-medium">
              Rent refunded · {formatSol(summary.netRentLamports)} back in your
              wallet
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-subtle">
              {pluralize(summary.accountCount, "account")} processed
              {summary.failedCount > 0
                ? ` · ${pluralize(summary.failedCount, "account")} failed`
                : ""}
              , {formatSol(summary.excessLamports)} refunded
              {summary.reclaimFeeLamports > 0
                ? `, our ${RECLAIM_RATE} fee ${formatSol(summary.reclaimFeeLamports)}`
                : ""}
              , network fee {formatSol(summary.feeLamports)}
              {summary.sponsorRepaymentLamports > 0
                ? ", which Spacedust advanced and took back out of this rent"
                : ""}
              .
            </p>
            {summary.signatures.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {summary.signatures.map((signature) => (
                  <a
                    key={signature}
                    href={solscanTxUrl(signature)}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-white/3 px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-violet-core/40 hover:text-foreground"
                  >
                    {truncateAddress(signature, 4, 4)}
                    <ExternalLink className="size-3" aria-hidden />
                    <span className="sr-only">View on Solscan</span>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-border bg-white/2 p-3">
                <p className="text-[11px] text-subtle">Refund</p>
                <p className="mt-0.5 font-mono text-base tabular-nums">
                  {formatSol(excessLamports)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-white/2 p-3">
                <p className="text-[11px] text-subtle">Fee</p>
                <p className="mt-0.5 font-mono text-base tabular-nums">
                  {formatSol(reclaimFeeLamports)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-white/2 p-3">
                <p className="text-[11px] text-subtle">You receive</p>
                <p className="mt-0.5 font-mono text-base tabular-nums">
                  {formatSol(netRentLamports)}
                </p>
              </div>
            </div>

            <SponsorAdvanceNote
              feeLamports={withdraw.estimatedFeeLamports}
              repaymentLamports={withdraw.sponsorRepaymentLamports}
            />

            <details className="rounded-xl border border-border bg-white/2 px-3 py-2">
              <summary className="cursor-pointer list-none text-[11px] font-medium text-muted [&::-webkit-details-marker]:hidden">
                {pluralize(accounts.length, "account")} with a refund due — review
              </summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto border-t border-border/50 pt-2 text-[11px]">
                {accounts.map((account) => (
                  <li
                    key={account.address}
                    className="flex items-center justify-between gap-2"
                  >
                    <span
                      className="min-w-0 truncate text-muted"
                      title={`${account.label ?? account.mint} · ${account.address}`}
                    >
                      {account.label ?? truncateAddress(account.mint, 4, 4)}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted">
                      {formatSol(account.excessLamports)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}

        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-subtle">
          <Landmark
            className="mt-px size-3.5 shrink-0 text-violet-glow"
            aria-hidden
          />
          <span>
            This withdraws only the surplus above each account&apos;s current
            rent-exempt reserve. Nothing is closed, sold or transferred, and the
            token balance stays exactly where it is.{" "}
            {getPublicFeeWallet() === null
              ? "No fee is taken — the whole refund comes back to you."
              : `Spacedust takes ${RECLAIM_RATE} of the rent it refunds.`}
          </span>
        </p>

        {hasPreview && !summary ? (
          <div className="flex flex-col gap-3">
            <SimulationReport
              packed={withdraw.packed}
              simulations={withdraw.simulations}
              okCount={
                withdraw.simulations.filter((simulation) => simulation.ok)
                  .length
              }
              unitLabel="withdraw"
            />
            <WarningsList warnings={withdraw.warnings} unitLabel="account" />
          </div>
        ) : null}

        <SweepError error={withdraw.error} />

        <div className="flex flex-col gap-2 sm:flex-row">
          {summary ? (
            <Button
              size="md"
              variant="outline"
              className="w-full"
              onClick={() => {
                withdraw.reset();
                onWithdrawn();
              }}
            >
              Done
            </Button>
          ) : hasPreview ? (
            <>
              <Button
                size="md"
                className="flex-1"
                disabled={withdraw.isBusy}
                onClick={() => void withdraw.execute()}
              >
                {withdraw.isBusy
                  ? "Waiting for your wallet…"
                  : "Sign & refund"}
              </Button>
              <Button
                size="md"
                variant="outline"
                disabled={withdraw.isBusy}
                onClick={withdraw.reset}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="md"
              className="w-full"
              disabled={withdraw.isBusy}
              onClick={() => void withdraw.prepare(accounts)}
            >
              {withdraw.isBusy
                ? "Checking on chain…"
                : `Refund rent from ${pluralize(accounts.length, "account")}`}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

