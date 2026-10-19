"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RefundNote } from "@/components/legal/refund-note";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { SimulationReport } from "@/components/sweep/simulation-report";
import { WarningsList } from "@/components/sweep/warnings-list";
import { ConnectWalletCta } from "@/components/wallet/wallet-button";
import { useRevoke } from "@/hooks/use-revoke";
import { previewAction } from "@/lib/sweep/preview";
import { solscanAccountUrl } from "@/lib/solana/submit";
import { cn } from "@/lib/utils/cn";
import {
  formatAmount,
  formatSol,
  pluralize,
  truncateAddress,
} from "@/lib/utils/format";
import type { TokenApproval } from "@/lib/solana/approvals";
import { revocableApprovals, revokeSelectionKey } from "@/lib/solana/approvals";

/**
 * Revoke token approvals.
 *
 * A token account can carry a `delegate`: someone else allowed to move its
 * balance without another signature from you. Marketplaces set one when you list
 * an NFT. dApps ask for one whenever you click "approve". They do not expire —
 * which is the entire point of this screen.
 *
 * The wording throughout keeps the distinction the feature turns on: *we could
 * not check* is never presented as *there is nothing to revoke*. The first is a
 * fact about us; the second is a claim about the wallet, and only one of the two
 * is safe to get wrong.
 */
export function ApprovalsPanel() {
  const { connected } = useWallet();
  const revoke = useRevoke();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const {
    approvals,
    hasChecked,
    isBusy,
    phase,
    error,
    packed,
    simulations,
    warnings,
    estimatedFeeLamports,
    summary,
    outcomes,
    scan,
    prepare,
    execute,
    reset,
  } = revoke;

  // The page asks exactly one question, so it asks it as soon as a wallet exists
  // rather than making the user go find a button first.
  useEffect(() => {
    if (connected) void scan();
  }, [connected, scan]);

  // A rescan can remove rows. Drop any selection that no longer exists, so a
  // preview can never be built from approvals the user cannot see — the same
  // rule the sweep applies to a selection that moves under it.
  useEffect(() => {
    setSelected((previous) => {
      const live = new Set(approvals.map((approval) => approval.tokenAccount));
      const next = new Set([...previous].filter((account) => live.has(account)));
      return next.size === previous.size ? previous : next;
    });
  }, [approvals]);

  const selectedApprovals = useMemo(
    () => approvals.filter((approval) => selected.has(approval.tokenAccount)),
    [approvals, selected],
  );

  /**
   * A preview must never outlive the selection it was built from.
   *
   * `execute()` signs the batch that was *prepared*, not what is ticked now. The
   * panel already pruned selections when the approvals list changed, but not when
   * the user unticked a row: preview revokes A and B, untick B to keep a listing
   * alive, and B was revoked anyway. The same guard the two burn flows use
   * (`lib/sweep/preview.ts`) closes that gap.
   */
  const selectionKey = useMemo(
    () =>
      revokeSelectionKey(
        selectedApprovals.map((approval) => approval.tokenAccount),
      ),
    [selectedApprovals],
  );
  const selectionKeyRef = useRef(selectionKey);
  useEffect(() => {
    const action = previewAction({
      previousKey: selectionKeyRef.current,
      currentKey: selectionKey,
      isBusy,
      hasSummary: summary !== null,
      hasPreview: packed.length > 0,
    });
    if (action === "none") return;
    selectionKeyRef.current = selectionKey;
    if (action === "discard") reset();
  }, [selectionKey, isBusy, packed.length, summary, reset]);

  const toggle = useCallback((account: string, next: boolean): void => {
    setSelected((previous) => {
      const updated = new Set(previous);
      if (next) updated.add(account);
      else updated.delete(account);
      return updated;
    });
  }, []);

  // Frozen accounts are listed but cannot be selected: the token program refuses
  // to revoke them (verified on mainnet), so a preview built from one would fail.
  // The pane still shows them, because the delegate is live.
  const { revocable, frozen } = useMemo(
    () => revocableApprovals(approvals),
    [approvals],
  );

  const allSelected =
    revocable.length > 0 && selected.size === revocable.length;
  const revokedCount = outcomes.filter(
    (outcome) => outcome.status === "revoked",
  ).length;

  if (!connected) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-sm leading-relaxed text-muted">
            Connect a wallet to see every token account that has granted someone
            else permission to move its balance. Reading the list signs nothing.
          </p>
          <ConnectWalletCta size="md" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4 text-violet-glow" aria-hidden />
              Standing approvals
            </CardTitle>
            <p className="mt-1 text-xs leading-relaxed text-subtle">
              A delegate can move the balance it was granted without asking you
              again. Revoking clears the permission — it recovers nothing, and it
              cancels any open listing that relied on it.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={isBusy}
            onClick={() => void scan()}
          >
            <RefreshCw aria-hidden />
            {hasChecked ? "Recheck" : "Check"}
          </Button>
        </CardHeader>

        <CardContent className="pt-5">
          {error ? (
            <div className="flex items-start gap-2.5 text-sm text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="font-medium">{error.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                  {error.message}
                  {/* The distinction this whole screen turns on. */}
                  {!hasChecked
                    ? " We could not read the approvals, so this is not a clean bill of health."
                    : ""}
                </p>
              </div>
            </div>
          ) : null}

          {!error && !hasChecked ? (
            <p className="text-sm text-muted">
              {isBusy
                ? "Reading token accounts…"
                : "The approval list has not been read yet."}
            </p>
          ) : null}

          {!error && hasChecked && approvals.length === 0 ? (
            <p className="flex items-center gap-2.5 text-sm text-success">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              No token account in this wallet has a delegate set.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {approvals.length > 0 ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-sm font-medium text-muted">
              {pluralize(approvals.length, "approval")}
            </CardTitle>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(next) =>
                  setSelected(
                    next
                      ? new Set(
                          revocable.map((approval) => approval.tokenAccount),
                        )
                      : new Set(),
                  )
                }
                aria-label={allSelected ? "Deselect all" : "Select all"}
              />
              Select all
            </label>
          </CardHeader>

          <CardContent className="p-0 pt-3 sm:p-0 sm:pt-3">
            <ul className="divide-y divide-border/50 border-t border-border/60">
              {approvals.map((approval) => (
                <ApprovalRow
                  key={approval.tokenAccount}
                  approval={approval}
                  selected={selected.has(approval.tokenAccount)}
                  onToggle={toggle}
                />
              ))}
            </ul>
            {frozen.length > 0 ? (
              <p className="border-t border-border/60 px-5 py-2.5 text-[11px] leading-relaxed text-subtle sm:px-6">
                {pluralize(frozen.length, "frozen account")} cannot be revoked
                yet. The token program rejects a revoke while an account is
                frozen, so this permission stays live until the mint&apos;s
                freeze authority thaws it — nothing you sign today can clear it.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {approvals.length > 0 ? (
        <>
          <WarningsList warnings={warnings} unitLabel="approval" />

          {packed.length > 0 ? (
            <SimulationReport
              packed={packed}
              simulations={simulations}
              okCount={simulations.filter((simulation) => simulation.ok).length}
              unitLabel="revoke"
            />
          ) : null}

          <Card>
            <CardContent className="flex flex-col items-start gap-3">
              <p className="text-xs leading-relaxed text-muted">
                {packed.length > 0
                  ? `${pluralize(packed.length, "transaction")} prepared · network fee ≈ ${formatSol(
                      estimatedFeeLamports,
                    )}. Nothing is recovered, because nothing is sold.`
                  : "Preview builds the exact transactions. Nothing is signed until you approve them, and every one is simulated first."}
              </p>

              <RefundNote />

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={isBusy || selectedApprovals.length === 0}
                  onClick={() => void prepare(selectedApprovals)}
                >
                  {isBusy && phase === "planning"
                    ? "Simulating…"
                    : `Preview ${pluralize(selectedApprovals.length, "revoke")}`}
                </Button>

                <Button
                  disabled={
                    isBusy ||
                    packed.length === 0 ||
                    selectedApprovals.length === 0
                  }
                  onClick={() => void execute()}
                >
                  <ShieldCheck aria-hidden />
                  {phase === "awaiting-signature" || phase === "submitting"
                    ? "Waiting for wallet…"
                    : "Sign & revoke"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {summary ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="size-4 text-success" aria-hidden />
              {pluralize(revokedCount, "approval")} revoked
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-2 pt-4">
            {summary.failedCount > 0 ? (
              <p className="text-xs text-danger">
                {pluralize(summary.failedCount, "revoke")} did not land. Recheck
                to see what is still granted.
              </p>
            ) : null}
            <p className="text-xs leading-relaxed text-subtle">
              Network fee paid: {formatSol(summary.feeLamports)}. Nothing was
              recovered, because nothing was sold — what changed is who can move
              the balance.
            </p>
            <Button variant="ghost" size="sm" onClick={() => reset()}>
              Done
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * One standing approval.
 *
 * The mint and the delegate are addresses, because that is all the chain gives
 * us — a token account does not carry a symbol. Both are Solscan links instead of
 * bare strings, which is what makes an address-only row usable, and it also keeps
 * this screen honest about the fact that it is reporting accounts rather than
 * nicely-named tokens.
 *
 * The row is the checkbox: an 18px box is a poor thumb target, so the whole row
 * toggles and carries the ARIA state, with the visual checkbox as decoration —
 * the same pattern the dust list uses.
 */
function ApprovalRow({
  approval,
  selected,
  onToggle,
}: {
  approval: TokenApproval;
  selected: boolean;
  onToggle: (account: string, next: boolean) => void;
}) {
  const toggle = (): void => {
    // A frozen account cannot be revoked — the token program refuses — so the
    // row is inert rather than selectable. The reason sits under the list.
    if (approval.frozen) return;
    onToggle(approval.tokenAccount, !selected);
  };

  return (
    <li className="relative">
      <div
        role="checkbox"
        aria-checked={selected}
        aria-disabled={approval.frozen || undefined}
        aria-label={`Select the approval held by ${approval.delegate} over ${approval.mint}`}
        tabIndex={approval.frozen ? -1 : 0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== " " && event.key !== "Enter") return;
          // Space would otherwise scroll the page.
          event.preventDefault();
          toggle();
        }}
        className={cn(
          "flex items-center gap-3 px-5 py-2.5 transition-colors sm:px-6",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet-glow",
          approval.frozen
            ? "cursor-not-allowed opacity-60"
            : selected
              ? "cursor-pointer bg-violet-core/8"
              : "cursor-pointer hover:bg-white/3",
        )}
      >
        {/* Decoration: the row above owns the state, the focus and the click. */}
        <Checkbox
          checked={selected}
          disabled={approval.frozen}
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-xs">
              {truncateAddress(approval.mint, 4, 4)}
            </span>
            {approval.unlimited ? (
              <Badge variant="danger" size="sm">
                Unlimited
              </Badge>
            ) : (
              <Badge variant="muted" size="sm">
                Bounded
              </Badge>
            )}
            {approval.frozen ? (
              <Badge variant="warning" size="sm">
                Frozen
              </Badge>
            ) : null}
          </div>

          <p className="mt-0.5 truncate text-[11px] text-subtle">
            Delegate{" "}
            <span className="font-mono text-muted">
              {truncateAddress(approval.delegate, 4, 4)}
            </span>{" "}
            · account{" "}
            <span className="font-mono text-muted">
              {truncateAddress(approval.tokenAccount, 4, 4)}
            </span>
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-mono text-sm tabular-nums">
            {formatAmount(approval.balance, 4)}
          </p>
          <p
            className={cn(
              "text-[11px]",
              approval.unlimited ? "text-danger" : "text-subtle",
            )}
          >
            {approval.unlimited
              ? "all of it"
              : `allowance ${formatAmount(approval.delegatedAmount, 4)}`}
          </p>
        </div>

        {/* Outside the row's click target, so following a link never toggles. */}
        <a
          href={solscanAccountUrl(approval.tokenAccount)}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          aria-label="View this account on Solscan"
          className="shrink-0 rounded-md p-1 text-subtle transition-colors hover:text-foreground"
        >
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
    </li>
  );
}
