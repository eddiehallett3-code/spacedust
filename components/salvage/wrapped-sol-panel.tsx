"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SponsorAdvanceNote } from "@/components/salvage/sponsor-advance-note";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, SectionTitle } from "@/components/ui/card";
import { SweepError } from "@/components/sweep/controls-column";
import { SimulationReport } from "@/components/sweep/simulation-report";
import { WarningsList } from "@/components/sweep/warnings-list";
import { useUnwrapWrappedSol } from "@/hooks/use-unwrap-wsol";
import { RECLAIM_RATE } from "@/lib/config/tools";
import { getPublicFeeWallet } from "@/lib/config/public-env";
import {
  planWrappedSolUnwraps,
  wrappedSolFeeLamports,
} from "@/lib/salvage/plan-unwrap";
import { solscanTxUrl } from "@/lib/solana/submit";
import { apiFetch } from "@/lib/utils/api";
import { toFriendlyError, type FriendlyError } from "@/lib/utils/errors";
import { formatSol, pluralize, truncateAddress } from "@/lib/utils/format";
import type { WrappedSolAccount } from "@/types/salvage";

/**
 * Wrapped SOL, and the only non-destructive way back to native SOL.
 *
 * A wSOL account is invisible to both of the other scans: the token list skips
 * the native mint, and the empty-account reader skips it because it has a
 * balance. So a wallet can hold SOL that its owner cannot see, in an account
 * whose rent is also stranded, and no other panel on the page will mention it.
 *
 * Closing the account *is* the unwrap. The panel says that plainly, and shows
 * the wrapped amount, the rent and the fee separately so nobody has to work out
 * whether we took a cut of their SOL. We do not: the fee is charged on the rent
 * only, the same rent-reclaim rate as an empty token account.
 */
export function WrappedSolPanel({
  onUnwrapped,
  whenEmpty = "explain",
}: {
  onUnwrapped: () => void;
  /** `hide` keeps Basic free of a second “nothing here” card. */
  whenEmpty?: "explain" | "hide";
}) {
  const { publicKey } = useWallet();
  const unwrap = useUnwrapWrappedSol();
  const resetUnwrap = unwrap.reset;

  const [accounts, setAccounts] = useState<WrappedSolAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);

  const owner = publicKey?.toBase58() ?? null;

  const load = useCallback(async (): Promise<void> => {
    if (!owner) {
      setAccounts([]);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    resetUnwrap();
    try {
      const result = await apiFetch<{ accounts: WrappedSolAccount[] }>(
        `/api/wrapped-sol?owner=${encodeURIComponent(owner)}`,
        { cacheMs: 0 },
      );
      setAccounts(result.accounts);
    } catch (caught) {
      setLoadError(toFriendlyError(caught));
      setAccounts([]);
    } finally {
      setIsLoading(false);
    }
  }, [owner, resetUnwrap]);

  useEffect(() => {
    void load();
  }, [load]);

  const plan = useMemo(
    () => planWrappedSolUnwraps(accounts, owner ?? ""),
    [accounts, owner],
  );

  const hasPreview = unwrap.packed.length > 0;

  /**
   * The last sentence of the footnote, which has to be true in both worlds.
   *
   * "Paid on top" is right for an ordinary unwrap and wrong for a sponsored one:
   * there, Spacedust pays the fee and takes it back out of the wrapped account's
   * rent, which is the very money the sentence is describing.
   */
  const networkClause =
    unwrap.sponsorRepaymentLamports > 0
      ? "the network fee is advanced by Spacedust and repaid out of that rent"
      : "the network fee is paid on top";
  const chosen = plan.closeable;
  const estimatedFee =
    getPublicFeeWallet() === null
      ? 0
      : chosen.reduce(
          (sum, account) => sum + wrappedSolFeeLamports(account),
          0,
        );

  if (!owner) {
    return (
      <Card>
        <CardHeader>
          <SectionTitle
            icon={<ArrowDownToLine className="size-4" aria-hidden />}
            title="Wrapped SOL"
            description="Unwrap wSOL back to native SOL and close the empty token account."
          />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">
            Connect a wallet to see whether it holds wrapped SOL.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (
    whenEmpty === "hide" &&
    !loadError &&
    accounts.length === 0
  ) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <SectionTitle
          icon={<ArrowDownToLine className="size-4" aria-hidden />}
          title="Wrapped SOL"
          description="Wrapped SOL is real SOL held in a token account. Closing that account unwraps it and returns its rent."
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void load()}
              disabled={isLoading || unwrap.isBusy}
            >
              <RefreshCw
                className={`mr-1.5 size-3.5 ${isLoading ? "animate-spin" : ""}`}
                aria-hidden
              />
              Rescan
            </Button>
          }
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="flex items-start gap-1.5 rounded-xl border border-violet-core/20 bg-violet-core/6 p-3 text-[11px] leading-relaxed text-muted">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-violet-glow" aria-hidden />
          <span>
            This is an unwrap, not a sale. The close returns the wrapped SOL and
            the account&apos;s rent to your wallet in one transaction. Nothing is
            swapped, approved or sent to a third party.
          </span>
        </p>

        {loadError ? <SweepError error={loadError} /> : null}

        <div className="max-h-[24rem] space-y-1 overflow-y-auto pr-1">
          {accounts.map((account) => {
            const skip = plan.skipped.find(
              (entry) => entry.account.address === account.address,
            );
            return (
              <div
                key={account.address}
                className={`flex items-start gap-3 rounded-xl px-2 py-2 ${
                  skip ? "opacity-70" : "hover:bg-white/4"
                }`}
              >
                <span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[6px] border border-border-strong">
                  {!skip ? (
                    <span className="size-2 rounded-full bg-emerald-400" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">
                      {formatSol(account.amountLamports)}
                    </span>
                    <Badge variant="muted" size="sm">
                      wSOL
                    </Badge>
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {truncateAddress(account.address, 4, 4)} · returns{" "}
                    {formatSol(account.lamports)} including{" "}
                    {formatSol(account.rentLamports)} rent
                  </span>
                  {skip ? (
                    <span className="block text-xs leading-relaxed text-warning">
                      Cannot close: {skip.reason}.
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}

          {isLoading ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              Looking for wrapped SOL…
            </p>
          ) : null}

          {!isLoading && accounts.length === 0 && !loadError ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              No wrapped SOL in this wallet.
            </p>
          ) : null}
        </div>

        {chosen.length > 0 || hasPreview ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-border bg-white/2 p-3">
                <p className="text-[11px] text-subtle">Wrapped SOL</p>
                <p className="mt-0.5 font-mono text-base tabular-nums">
                  {formatSol(unwrap.wrappedLamports || plan.wrappedLamports)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-white/2 p-3">
                <p className="text-[11px] text-subtle">Rent returned</p>
                <p className="mt-0.5 font-mono text-base tabular-nums">
                  {formatSol(unwrap.rentLamports || plan.rentLamports)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-white/2 p-3">
                <p className="text-[11px] text-subtle">Our fee</p>
                <p className="mt-0.5 font-mono text-base tabular-nums">
                  {formatSol(hasPreview ? unwrap.reclaimFeeLamports : estimatedFee)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-white/2 p-3">
                <p className="text-[11px] text-subtle">You receive</p>
                <p className="mt-0.5 font-mono text-base tabular-nums">
                  {formatSol(
                    hasPreview
                      ? unwrap.netReturnedLamports
                      : plan.wrappedLamports + plan.rentLamports - estimatedFee,
                  )}
                </p>
              </div>
            </div>

            <SponsorAdvanceNote
              feeLamports={unwrap.estimatedFeeLamports}
              repaymentLamports={unwrap.sponsorRepaymentLamports}
            />

            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-subtle">
              <ShieldCheck className="mt-px size-3.5 shrink-0 text-success" aria-hidden />
              <span>
                {getPublicFeeWallet() === null
                  ? `No fee is taken. The wrapped SOL and its rent are returned to you in full; ${networkClause}.`
                  : `Spacedust takes ${RECLAIM_RATE} of the rent only. The wrapped SOL itself is returned in full; ${networkClause}.`}
              </span>
            </p>

            {hasPreview ? (
              <div className="flex flex-col gap-3">
                <SimulationReport
                  packed={unwrap.packed}
                  simulations={unwrap.simulations}
                  okCount={unwrap.simulations.filter((item) => item.ok).length}
                  unitLabel="close"
                />
                <WarningsList warnings={unwrap.warnings} unitLabel="account" />
              </div>
            ) : null}

            <SweepError error={unwrap.error} />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={chosen.length === 0 || unwrap.isBusy}
                onClick={() => void unwrap.prepare(chosen)}
              >
                Preview {pluralize(chosen.length, "unwrap")}
              </Button>
              <Button
                size="sm"
                disabled={!hasPreview || unwrap.isBusy}
                onClick={() => void unwrap.execute()}
              >
                <ArrowDownToLine className="mr-1.5 size-3.5" aria-hidden />
                Unwrap and close {pluralize(unwrap.closeCount, "account")}
              </Button>
            </div>
          </>
        ) : null}

        {unwrap.summary ? (
          <div className="rounded-xl border border-success/25 bg-success/6 p-3">
            <p className="text-sm font-medium">
              {pluralize(unwrap.summary.closedCount, "account")} closed ·{" "}
              {formatSol(unwrap.summary.netReturnedLamports)} back in your wallet
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-subtle">
              {unwrap.summary.failedCount > 0
                ? `${pluralize(unwrap.summary.failedCount, "account")} could not be closed. `
                : ""}
              {formatSol(unwrap.summary.wrappedLamports)} unwrapped,{" "}
              {formatSol(unwrap.summary.rentLamports)} rent freed, our fee{" "}
              {formatSol(unwrap.summary.reclaimFeeLamports)}, network fee{" "}
              {formatSol(unwrap.summary.feeLamports)}
              {unwrap.sponsorRepaymentLamports > 0
                ? ", which Spacedust advanced and took back out of this rent"
                : ""}
              .
            </p>
            {unwrap.summary.signatures.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {unwrap.summary.signatures.map((signature) => (
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
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => {
                resetUnwrap();
                onUnwrapped();
                void load();
              }}
            >
              Done
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}


