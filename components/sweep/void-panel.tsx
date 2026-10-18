"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, Info, Orbit } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, SectionTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { TokenLogo } from "@/components/scanner/token-logo";
import { SweepError } from "@/components/sweep/controls-column";
import { SimulationReport } from "@/components/sweep/simulation-report";
import { WarningsList } from "@/components/sweep/warnings-list";
import { solscanTxUrl } from "@/lib/solana/submit";
import { voidFeeFromRentLamports } from "@/lib/solana/rent";
import { sumForMints } from "@/lib/sweep/totals";
import { getPublicFeeWallet } from "@/lib/config/public-env";
import { TOAST_BRIEF_MS, TOAST_READ_MS, VOID_FEE_BPS } from "@/lib/utils/constants";
import { cn } from "@/lib/utils/cn";
import {
  formatAmount,
  formatSol,
  formatUsd,
  pluralize,
  truncateAddress,
} from "@/lib/utils/format";
import type { useVoid } from "@/hooks/use-void";
import type { DustToken } from "@/types/token";

type VoidApi = ReturnType<typeof useVoid>;

/**
 * Does this token look swappable?
 *
 * A priced, non-zero balance is very likely routable, so sending it into The
 * Void destroys value a swap could have recovered. It is only a *hint*: a thin
 * token can carry a price and still have no route, and only the user knows what
 * they want gone — so The Void lists it anyway and says so plainly, rather than
 * hiding it.
 */
function looksSwappable(token: DustToken): boolean {
  return !token.hasNoPrice && token.valueUsd > 0;
}

/**
 * The Void.
 *
 * Where tokens that *cannot* be swapped go to be destroyed for their rent. The
 * split is the point: a no-liquidity token has nothing to gain from a route,
 * so the only value left in the position is the rent its token account is
 * holding — small, and frequently more than the token itself is worth.
 *
 * This is a fully separate preview → sign → submit pipeline from the swap
 * flow. A burn and a swap never share a transaction, and the user chooses
 * which flow to run first.
 */
export function VoidPanel({
  tokens,
  selectedMints,
  onToggle,
  onSelectAll,
  onDeselectAll,
  theVoid,
  onBurnt,
}: {
  tokens: DustToken[];
  selectedMints: Set<string>;
  onToggle: (mint: string, next: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  theVoid: VoidApi;
  /** Called after a successful burn, so the caller can rescan the wallet. */
  onBurnt?: () => void;
}) {
  const {
    phase,
    packed,
    simulations,
    summary,
    error,
    warnings,
    progress,
    isBusy,
  } = theVoid;

  const selectedTokens = tokens.filter((token) => selectedMints.has(token.mint));
  const hasPreview = packed.length > 0;
  const showSuccess = summary !== null;

  // Rent and the fee come from the plan, which read **each account's own**
  // deposit — deposits differ between accounts, so a single figure multiplied by
  // a count understated both. Before a plan exists there is nothing to read, and
  // the panel estimates from the network's current minimum instead.
  const rentPerAccount = theVoid.tokenAccountRentLamports;
  const feeWalletConfigured = getPublicFeeWallet() !== null;

  const closedMints = new Set(packed.flatMap((tx) => tx.rentReclaimMints));
  const grossRentLamports = hasPreview
    ? sumForMints(theVoid.rentByMint, closedMints)
    : selectedTokens.length * rentPerAccount;
  const voidFeeLamports = !feeWalletConfigured
    ? 0
    : hasPreview
      ? sumForMints(theVoid.feeByMint, closedMints)
      : selectedTokens.length * voidFeeFromRentLamports(rentPerAccount);
  // Fees are on when a wallet is configured *and* the plan actually charged
  // something — a configured but unfunded wallet charges nothing, which the plan
  // already decided and warned about.
  const voidFeeEnabled =
    feeWalletConfigured && (hasPreview ? theVoid.feeByMint.size > 0 : true);
  const rentLamports = grossRentLamports - voidFeeLamports;
  const feeLamports = simulations.reduce(
    (sum, simulation) => sum + (simulation.feeLamports ?? 0),
    0,
  );
  const okCount = simulations.filter((simulation) => simulation.ok).length;

  const allSelected =
    tokens.length > 0 && selectedTokens.length === tokens.length;
  const someSelected = selectedTokens.length > 0 && !allSelected;

  // Tokens in this selection that a swap could actually have recovered. The
  // Void still allows them — "my token is routable" and "I want it gone" are
  // different statements — but the user is told exactly what they are throwing
  // away, with a number attached.
  const selectedSwappable = selectedTokens.filter(looksSwappable);
  const selectedSwappableUsd = selectedSwappable.reduce(
    (sum, token) => sum + token.valueUsd,
    0,
  );

  const handlePreview = async (): Promise<void> => {
    const count = await theVoid.prepare({ tokens: selectedTokens });
    if (count > 0) {
      toast.success("Preview ready", {
        duration: TOAST_BRIEF_MS,
        description:
          pluralize(count, "transaction") +
          " built and simulated. Review before signing.",
      });
    }
  };

  const handleExecute = async (): Promise<void> => {
    const ok = await theVoid.execute();
    if (ok) {
      toast.success("Sent into The Void", {
        // A result the user is meant to take in, not a tap confirmation, so it
        // gets longer than the 4-second default. See TOAST_READ_MS.
        duration: TOAST_READ_MS,
        description: "Your tokens are gone and the rent is back in your wallet.",
      });
      onBurnt?.();
    }
  };

  if (tokens.length === 0 && !showSuccess) return null;

  return (
    <Card>
      <CardHeader>
        <SectionTitle
          icon={<Orbit className="size-4.5" aria-hidden />}
          title="The Void"
          description="Every token with a balance is listed. Tokens flagged as having liquidity can be swapped — sending one into The Void destroys value Slingshot could have recovered, so those are never selected for you."
        />
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {showSuccess && summary ? (
          <VoidResult
            summary={summary}
            outcomes={theVoid.outcomes}
            onDone={theVoid.reset}
          />
        ) : (
          <>
            {/* ── Selection ─────────────────────────────────────────────── */}
            <div className="overflow-hidden rounded-xl border border-border/60">
              <div className="flex items-center gap-3 border-b border-border/60 bg-white/2 px-3 py-2">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onCheckedChange={(checked) =>
                    checked ? onSelectAll() : onDeselectAll()
                  }
                  aria-label={
                    allSelected ? "Deselect all tokens" : "Select all tokens"
                  }
                />
                <span className="flex-1 text-xs font-medium text-muted">
                  {pluralize(tokens.length, "token")} in this wallet ·{" "}
                  {pluralize(selectedTokens.length, "token selected", "tokens selected")}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={allSelected ? onDeselectAll : onSelectAll}
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </Button>
              </div>

              <ul
                className="max-h-[16rem] divide-y divide-border/40 overflow-y-auto"
                role="list"
              >
                {tokens.map((token) => {
                  const isSelected = selectedMints.has(token.mint);
                  // Whole-row toggle, same contract as the sweeper's token list:
                  // the row is the checkbox, so the tap target is the full row
                  // rather than the 18px box.
                  const toggle = (): void => onToggle(token.mint, !isSelected);
                  return (
                    <li key={token.mint}>
                      <div
                        role="checkbox"
                        aria-checked={isSelected}
                        aria-label={`Send ${token.symbol} into The Void`}
                        tabIndex={0}
                        onClick={toggle}
                        onKeyDown={(event) => {
                          if (event.key !== " " && event.key !== "Enter") return;
                          event.preventDefault();
                          toggle();
                        }}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors",
                          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet-glow",
                          isSelected ? "bg-violet-core/8" : "hover:bg-white/3",
                        )}
                      >
                        {/* Decorative: the row owns the state and the click. */}
                        <Checkbox
                          checked={isSelected}
                          tabIndex={-1}
                          aria-hidden
                          className="pointer-events-none"
                        />
                        <TokenLogo
                          src={token.logoUri}
                          symbol={token.symbol}
                          size={28}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                            <span className="truncate">{token.symbol}</span>
                            {looksSwappable(token) ? (
                              <Badge variant="warning" size="sm">
                                has liquidity
                              </Badge>
                            ) : (
                              <Badge variant="muted" size="sm">
                                no route
                              </Badge>
                            )}
                          </p>
                          <p className="truncate text-xs text-subtle">
                            {formatAmount(token.balance, 4)}
                            {looksSwappable(token)
                              ? ` · worth ${formatUsd(token.valueUsd)} — swap it instead`
                              : " · unswappable"}
                          </p>
                        </div>
                        <p className="shrink-0 font-mono text-[11px] text-subtle">
                          +{formatSol(theVoid.rentByMint.get(token.mint) ?? rentPerAccount)} rent
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* ── Facts before any signature ───────────────────────────── */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Selected"
                value={String(selectedTokens.length)}
                hint={pluralize(selectedTokens.length, "token")}
                accent={selectedTokens.length > 0}
              />
              <Stat
                label="Rent to you"
                value={formatSol(rentLamports)}
                hint={
                  voidFeeEnabled
                    ? `after ${(VOID_FEE_BPS / 100).toFixed(1)}% fee`
                    : "back in your wallet"
                }
                accent={rentLamports > 0}
              />
              {voidFeeEnabled ? (
                <Stat
                  label={`Spacedust fee (${(VOID_FEE_BPS / 100).toFixed(1)}%)`}
                  value={formatSol(voidFeeLamports)}
                  hint="of reclaimed rent"
                />
              ) : (
                <Stat
                  label="Transactions"
                  value={hasPreview ? String(packed.length) : "—"}
                  hint={hasPreview ? "own batch, no swaps" : "run preview"}
                />
              )}
              <Stat
                label="Network fee"
                value={hasPreview ? formatSol(feeLamports) : "—"}
                hint={hasPreview ? "estimated" : undefined}
              />
            </div>

            <SweepError error={error} />

            {selectedSwappable.length > 0 ? (
              <p className="flex items-start gap-1.5 rounded-lg border border-danger/25 bg-danger/8 px-2.5 py-2 text-[11px] leading-relaxed text-danger">
                <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>
                  <strong className="font-semibold">
                    {pluralize(selectedSwappable.length, "token")} in this
                    selection {selectedSwappable.length === 1 ? "has" : "have"}{" "}
                    liquidity
                  </strong>{" "}
                  (≈{formatUsd(selectedSwappableUsd)}). A swap would recover that
                  value — The Void destroys it. Untick them unless you really
                  want them gone.
                </span>
              </p>
            ) : null}

            {hasPreview ? (
              <div className="flex flex-col gap-3">
                <SimulationReport
                  packed={packed}
                  simulations={simulations}
                  okCount={okCount}
                  unitLabel="Void send"
                />
                <WarningsList warnings={warnings} />
              </div>
            ) : null}

            <p className="flex items-start gap-1.5 rounded-lg border border-warning/25 bg-warning/8 px-2.5 py-2 text-[11px] leading-relaxed text-warning">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>
                <strong className="font-semibold">
                  Sending into The Void is irreversible.
                </strong>{" "}
                These tokens are destroyed and cannot be recovered. Make sure
                you never hold (or plan to buy) any of these assets before
                signing.
              </span>
            </p>

            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-subtle">
              <Info className="mt-px size-3 shrink-0" aria-hidden />
              <span>
                Sends into The Void are built and signed separately from swaps —
                a Void send and a swap never share a transaction. Nothing is
                sent until you approve the preview.
              </span>
            </p>

            <div className="flex flex-col gap-2">
              {hasPreview ? (
                <Button
                  size="lg"
                  onClick={() => void handleExecute()}
                  disabled={isBusy}
                  loading={
                    phase === "awaiting-signature" ||
                    phase === "submitting" ||
                    phase === "confirming"
                  }
                  loadingText={
                    phase === "confirming"
                      ? "Confirming…"
                      : phase === "submitting"
                        ? `Sending ${progress.completed}/${progress.total}…`
                        : "Check your wallet…"
                  }
                  className="w-full"
                >
                  <Orbit className="size-4" aria-hidden />
                  Sign &amp; send {pluralize(selectedTokens.length, "token")}
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              ) : (
                <Button
                  size="lg"
                  onClick={() => void handlePreview()}
                  disabled={selectedTokens.length === 0 || isBusy}
                  loading={phase === "planning" || phase === "simulating"}
                  loadingText={
                    phase === "simulating" ? "Simulating…" : "Building sends…"
                  }
                  className="w-full"
                >
                  Preview &amp; simulate
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              )}

              {hasPreview ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={theVoid.reset}
                  disabled={isBusy}
                >
                  Change selection
                </Button>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Post-burn result. Numbers come from the confirmed submissions, not from the
 * preview — same rule as the sweep summary.
 */
function VoidResult({
  summary,
  outcomes,
  onDone,
}: {
  summary: NonNullable<VoidApi["summary"]>;
  outcomes: VoidApi["outcomes"];
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-xl border border-success/25 bg-success/8 p-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-violet-core to-cyan-core shadow-[0_8px_30px_-12px_rgba(139,92,246,0.9)]">
          <CheckCircle2 className="size-6 text-white" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {pluralize(summary.burnedCount, "token")} sent into The Void
          </p>
          <p className="text-xs leading-relaxed text-muted">
            {formatSol(summary.rentReclaimedLamports)} of rent reclaimed
            {summary.voidFeeLamports > 0
              ? ` after The Void's fee (${formatSol(summary.voidFeeLamports)})`
              : ""}
            {summary.failedCount > 0
              ? ` · ${pluralize(summary.failedCount, "token")} failed`
              : ""}
          </p>
        </div>
      </div>

      {/* Failed tokens are never quietly swallowed. */}
      {outcomes.some((outcome) => outcome.status === "failed") ? (
        <ul className="space-y-1 rounded-xl border border-warning/25 bg-warning/6 px-3 py-2 text-[11px] text-muted">
          {outcomes
            .filter((outcome) => outcome.status === "failed")
            .map((outcome) => (
              <li key={outcome.mint} className="flex gap-1.5">
                <span aria-hidden>•</span>
                <span className="min-w-0 break-words">
                  <strong className="font-medium text-foreground">
                    {outcome.symbol}
                  </strong>
                  {outcome.error ? ` — ${outcome.error}` : " — not submitted."}
                </span>
              </li>
            ))}
        </ul>
      ) : null}

      {summary.signatures.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-subtle">
            Transactions
          </p>
          <div className="flex flex-wrap gap-1.5">
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
        </div>
      ) : null}

      <Button size="md" variant="outline" className="w-full" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

/** Compact stat tile, matching the sweep panel's grid. */
function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-white/2 p-2.5">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-subtle">
        {accent ? <Orbit className="size-3" aria-hidden /> : null}
        <span className="truncate">{label}</span>
      </p>
      <p
        className={
          accent
            ? "mt-1 font-mono text-sm tabular-nums"
            : "mt-1 font-mono text-sm tabular-nums text-muted"
        }
      >
        {value}
      </p>
      {hint ? <p className="truncate text-[10px] text-subtle">{hint}</p> : null}
    </div>
  );
}


