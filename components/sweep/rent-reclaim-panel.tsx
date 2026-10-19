"use client";

import { motion } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { ExternalLink, Landmark, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, SectionTitle } from "@/components/ui/card";
import { SweepError } from "@/components/sweep/controls-column";
import { SimulationReport } from "@/components/sweep/simulation-report";
import { WarningsList } from "@/components/sweep/warnings-list";
import { useClose } from "@/hooks/use-close";
import { solscanTxUrl } from "@/lib/solana/submit";
import { planEmptyAccountCloses } from "@/lib/sweep/empty-accounts";
import { feeFromRentLamports } from "@/lib/solana/rent";
import { RECLAIM_RATE } from "@/lib/config/tools";
import { RefundNote } from "@/components/legal/refund-note";
import { RECLAIM_FEE_BPS } from "@/lib/utils/constants";
import { formatSol, pluralize, truncateAddress } from "@/lib/utils/format";
import type { EmptyTokenAccount } from "@/types/token";

/**
 * Rent left behind.
 *
 * A wallet that sold a token somewhere else, or moved one out by hand, leaves
 * the token account behind: empty, still holding its rent, and invisible — no
 * balance means the token list has nothing to show and a sweep has no swap to
 * attach a close to. This card is the only way back to that rent.
 *
 * It is deliberately unconditional. The other three flows need a selection, a
 * price or a route; this one needs none of that, so it appears whenever the
 * scan found empty accounts, even in a wallet with no dust at all.
 *
 * This used to be free: the user is recovering their own deposit rather than
 * trading, which was the reasoning for charging nothing. It now takes the same
 * 1.5% of reclaimed rent that The Void does, priced per account from that
 * account's own balance — the rate lives in `RECLAIM_FEE_BPS`, so the panel and
 * the flow that builds the closes cannot disagree about it. The panel states it,
 * because a fee nobody mentions until the result screen is the kind of thing
 * users rightly resent.
 */
export function RentReclaimPanel({
  accounts,
  scanError,
  onReclaimed,
  onRescan,
  whenEmpty = "hide",
}: {
  accounts: EmptyTokenAccount[];
  /** Set when the scan could not check for these accounts at all. */
  scanError: string | null;
  /** Called once accounts have landed closed, so the app can rescan. */
  onReclaimed: () => void;
  /** Optional: a rescan affordance, offered in the empty state. */
  onRescan?: () => void;
  /**
   * What to render when there is nothing to close.
   *
   * On Slingshot this card is a bonus beside the sweep, so it stays hidden — an
   * empty card there is noise. On Salvage it is half of what the page is *for*, and
   * a page that silently omits one of its two jobs reads as though the feature is
   * missing. Same component either way, so the rules and the fee cannot drift apart
   * between the two places this runs.
   */
  whenEmpty?: "hide" | "explain";
}) {
  const { publicKey } = useWallet();
  const reclaim = useClose();

  // The same rule the closer uses, so the number here and the number the plan
  // produces cannot disagree — which is the only way this card can overstate
  // what it is about to return.
  const plan = planEmptyAccountCloses(
    accounts,
    publicKey?.toBase58() ?? "",
  );

  const hasPreview = reclaim.packed.length > 0;
  const isBusy = reclaim.isBusy;

  // A failed read is not an empty wallet. Saying "none" when we could not look
  // would be the one wrong thing this card could do.
  if (scanError) {
    return (
      <Card>
        <CardHeader>
          <SectionTitle
            title="Rent left behind"
            description="Empty token accounts still hold their rent — about 0.002 SOL each — until they are closed."
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

  if (accounts.length === 0 && reclaim.summary === null) {
    if (whenEmpty === "hide") return null;

    return (
      <Card>
        <CardHeader>
          <SectionTitle
            icon={<Landmark className="size-4" aria-hidden />}
            title="Empty token accounts"
            description="Accounts you have emptied somewhere else hold their rent and nothing else, until they are closed."
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="rounded-xl border border-border bg-white/2 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
            <strong className="font-medium text-foreground">
              Nothing to close right now.
            </strong>{" "}
            An account only appears here once it has been emptied and left behind —
            sold on a DEX, bridged out, moved by hand, or swept by Slingshot. Both
            scanners drop a zero balance, so a wallet that is tidy has no way to show
            you this. Come back after your next sale or transfer.
          </p>
          {onRescan ? (
            <div>
              <Button variant="outline" size="sm" onClick={onRescan}>
                <RefreshCw className="mr-1.5 size-3.5" aria-hidden />
                Rescan the wallet
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <SectionTitle
          icon={<Landmark className="size-4" aria-hidden />}
          title="Rent left behind"
          description={
            hasPreview
              ? `Closing ${pluralize(reclaim.closeCount, "empty account")} returns the rent they are holding.`
              : `${pluralize(plan.closeable.length, "empty token account")} still hold their rent. Closing them returns it.`
          }
        />
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border bg-white/2 p-3">
            <p className="text-[11px] text-subtle">Rent freed</p>
            <p className="mt-0.5 font-mono text-base tabular-nums">
              {formatSol(reclaim.summary ? reclaim.summary.rentLamports : plan.lamports)}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-white/2 p-3">
            <p className="text-[11px] text-subtle">Fee</p>
            <p className="mt-0.5 font-mono text-base tabular-nums">
              {formatSol(
                reclaim.summary
                  ? reclaim.summary.reclaimFeeLamports
                  : feeFromRentLamports(plan.lamports, RECLAIM_FEE_BPS),
              )}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-white/2 p-3">
            <p className="text-[11px] text-subtle">You receive</p>
            <p className="mt-0.5 font-mono text-base tabular-nums">
              {formatSol(
                reclaim.summary
                  ? reclaim.summary.netRentLamports
                  : plan.lamports -
                      feeFromRentLamports(plan.lamports, RECLAIM_FEE_BPS),
              )}
            </p>
          </div>
        </div>

        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-subtle">
          <ShieldCheck className="mt-px size-3.5 shrink-0 text-success" aria-hidden />
          <span>
            Spacedust takes {RECLAIM_RATE} of the rent it returns, which is the same
            rate The Void charges — closing an empty account is the same kind of job
            in both places. Nothing is sold, burned or approved, and the only other
            cost is the network fee.
          </span>
        </p>
        <RefundNote />
        {hasPreview ? (
          <div className="flex flex-col gap-3">
            <SimulationReport
              packed={reclaim.packed}
              simulations={reclaim.simulations}
              okCount={reclaim.simulations.filter((item) => item.ok).length}
              unitLabel="close"
            />
            <WarningsList warnings={reclaim.warnings} unitLabel="account" />
          </div>
        ) : null}

        <SweepError error={reclaim.error} />

        {reclaim.summary ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-success/25 bg-success/6 p-3"
          >
            <p className="text-sm font-medium">
              {pluralize(reclaim.summary.closedCount, "account")} closed ·{" "}
              {formatSol(reclaim.summary.netRentLamports)} back in your wallet
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-subtle">
              {reclaim.summary.failedCount > 0
                ? `${pluralize(reclaim.summary.failedCount, "account")} could not be closed. `
                : ""}
              {formatSol(reclaim.summary.rentLamports)} freed, our{" "}
              {RECLAIM_RATE} fee {formatSol(reclaim.summary.reclaimFeeLamports)},
              network fee {formatSol(reclaim.summary.feeLamports)}.
            </p>
            {reclaim.summary.signatures.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {reclaim.summary.signatures.map((signature) => (
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
          </motion.div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          {reclaim.summary ? (
            <Button
              size="md"
              variant="outline"
              className="w-full"
              onClick={() => {
                // Rescan rather than trust the local list: the chain is the only
                // thing that knows which accounts are actually gone.
                reclaim.reset();
                onReclaimed();
              }}
            >
              Done
            </Button>
          ) : hasPreview ? (
            <>
              <Button
                size="md"
                className="flex-1"
                disabled={isBusy}
                onClick={() => void reclaim.execute()}
              >
                {isBusy
                  ? "Waiting for your wallet…"
                  : `Sign & close ${pluralize(reclaim.closeCount, "account")}`}
              </Button>
              <Button
                size="md"
                variant="outline"
                disabled={isBusy}
                onClick={reclaim.reset}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="md"
              className="w-full"
              disabled={isBusy || plan.closeable.length === 0}
              onClick={() => void reclaim.prepare({ accounts: plan.closeable })}
            >
              {isBusy
                ? "Checking on chain…"
                : `Close ${pluralize(plan.closeable.length, "account")}`}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
