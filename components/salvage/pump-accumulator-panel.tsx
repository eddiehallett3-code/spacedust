"use client";

import { ExternalLink, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  SectionTitle,
} from "@/components/ui/card";
import { SimulationReport } from "@/components/sweep/simulation-report";
import { SweepError } from "@/components/sweep/controls-column";
import { WarningsList } from "@/components/sweep/warnings-list";
import { usePumpAccumulatorClose } from "@/hooks/use-pump-accumulator-close";
import { solscanTxUrl } from "@/lib/solana/submit";
import { feeFromRentLamports } from "@/lib/solana/rent";
import { RECLAIM_RATE } from "@/lib/config/tools";
import { getPublicFeeWallet } from "@/lib/config/public-env";
import { RECLAIM_FEE_BPS } from "@/lib/utils/constants";
import { formatSol, truncateAddress } from "@/lib/utils/format";
import type { PumpAccumulator } from "@/types/salvage";

/**
 * The Pump.fun user volume account.
 *
 * Pump creates one program-owned account per wallet to track volume for fee
 * tiers. It holds no tokens — only rent — so it is invisible to the token scan
 * and to the empty-token-account scan. This card is the only place it appears.
 *
 * Closing it is a rent reclaim, not a burn or a swap. The direct Pump AMM
 * instruction returns the account's lamports to the owner; the one thing to
 * state plainly is that the volume tier it was tracking resets.
 */
export function PumpAccumulatorPanel({
  account,
  scanError,
  onClosed,
}: {
  account: PumpAccumulator | null;
  scanError: string | null;
  /** Called after a successful close, so the page can rescan. */
  onClosed: () => void;
}) {
  const close = usePumpAccumulatorClose();

  if (!account) {
    if (!scanError) return null;
    return (
      <Card>
        <CardHeader>
          <SectionTitle
            icon={<Flame className="size-4" aria-hidden />}
            title="Pump.fun account"
            description="Pump.fun keeps a small volume account per wallet. Its rent is recoverable when it is unused."
          />
        </CardHeader>
        <CardContent>
          <p className="rounded-xl border border-warning/25 bg-warning/8 px-3 py-2.5 text-[11px] leading-relaxed text-warning">
            {scanError}
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasPreview = close.packed.length > 0;
  const summary = close.summary;
  const rentLamports = hasPreview ? close.rentLamports : account.lamports;
  const reclaimFeeLamports = hasPreview
    ? close.reclaimFeeLamports
    : getPublicFeeWallet() === null
      ? 0
      : feeFromRentLamports(account.lamports, RECLAIM_FEE_BPS);
  const netRentLamports = hasPreview
    ? close.netRentLamports
    : account.lamports - reclaimFeeLamports;

  return (
    <Card>
      <CardHeader>
        <SectionTitle
          icon={<Flame className="size-4" aria-hidden />}
          title="Pump.fun account"
          description="Pump.fun keeps a small volume account per wallet. Closing it returns its rent; the volume tier it tracks resets."
        />
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-subtle">
          <span>Account</span>
          <span className="font-mono text-muted" title={account.address}>
            {truncateAddress(account.address, 4, 4)}
          </span>
          <span aria-hidden>·</span>
          <span>{formatSol(account.lamports)} rent inside</span>
        </p>

        {summary ? (
          <div className="rounded-xl border border-success/25 bg-success/6 p-3">
            <p className="text-sm font-medium">
              Pump.fun account closed ·{" "}
              {formatSol(summary.netRentLamports)} back in your wallet
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-subtle">
              {formatSol(summary.rentLamports)} freed
              {summary.reclaimFeeLamports > 0
                ? `, our ${RECLAIM_RATE} fee ${formatSol(summary.reclaimFeeLamports)}`
                : ""}
              , network fee {formatSol(summary.feeLamports)}.
            </p>
            {summary.signature ? (
              <a
                href={solscanTxUrl(summary.signature)}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border bg-white/3 px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-violet-core/40 hover:text-foreground"
              >
                {truncateAddress(summary.signature, 4, 4)}
                <ExternalLink className="size-3" aria-hidden />
                <span className="sr-only">View on Solscan</span>
              </a>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-white/2 p-3">
              <p className="text-[11px] text-subtle">Rent freed</p>
              <p className="mt-0.5 font-mono text-base tabular-nums">
                {formatSol(rentLamports)}
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
        )}

        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-subtle">
          <Flame className="mt-px size-3.5 shrink-0 text-violet-glow" aria-hidden />
          <span>
            This returns only the rent the account holds. Your Pump.fun tokens and
            balances are untouched.{" "}
            {getPublicFeeWallet() === null
              ? "No fee is taken — the whole deposit comes back to you."
              : `Spacedust takes ${RECLAIM_RATE} of the rent it returns — the same rate as closing an empty token account.`}
          </span>
        </p>

        {hasPreview && !summary ? (
          <div className="flex flex-col gap-3">
            <SimulationReport
              packed={close.packed}
              simulations={close.simulations}
              okCount={
                close.simulations.filter((simulation) => simulation.ok).length
              }
              unitLabel="close"
            />
            <WarningsList warnings={close.warnings} unitLabel="account" />
          </div>
        ) : null}

        <SweepError error={close.error} />

        <div className="flex flex-col gap-2 sm:flex-row">
          {summary ? (
            <Button
              size="md"
              variant="outline"
              className="w-full"
              onClick={() => {
                close.reset();
                onClosed();
              }}
            >
              Done
            </Button>
          ) : hasPreview ? (
            <>
              <Button
                size="md"
                className="flex-1"
                disabled={close.isBusy}
                onClick={() => void close.execute()}
              >
                {close.isBusy ? "Waiting for your wallet…" : "Sign & close"}
              </Button>
              <Button
                size="md"
                variant="outline"
                disabled={close.isBusy}
                onClick={close.reset}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="md"
              className="w-full"
              disabled={close.isBusy}
              onClick={() => void close.prepare(account)}
            >
              {close.isBusy ? (
                "Checking on chain…"
              ) : (
                <>
                  <Flame className="mr-1.5 size-3.5" aria-hidden />
                  Close Pump.fun account
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
