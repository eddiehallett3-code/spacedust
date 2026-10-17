"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, Lock, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { solscanTxUrl } from "@/lib/solana/submit";
import { formatSol, pluralize, truncateAddress } from "@/lib/utils/format";
import type { usePayload } from "@/hooks/use-payload";

/**
 * What the batch is about to do, and what it did.
 *
 * One row per item, before and after the signature. Two things are deliberate:
 *
 *  - **A refused row keeps its reason.** Nothing disappears silently, and a
 *    refusal the planner made — a frozen account, a leaf whose proof could not be
 *    fetched — is the most useful sentence on the screen.
 *  - **Rent is attributed per item, not totalled.** Whether a row freed its rent
 *    depends on its own account being emptied and closed, and whether it cost
 *    anything depends on the recipient already having an account for that mint.
 *    One NFT can cost more in deposit than it frees. A cNFT has neither side of
 *    that: it is a leaf, not an account, so its row is rent-free either way.
 */
export function BatchReport({
  payload,
}: {
  payload: ReturnType<typeof usePayload>;
}) {
  const results = payload.executions;
  const summary = payload.summary;

  // Before the signature the rows come from the plan; afterwards they come from
  // what actually happened, which is the only thing worth trusting at that point.
  const rows =
    results.length > 0
      ? results.map((item) => ({
          key: item.mint,
          label: item.label,
          detail: truncateAddress(item.mint),
          status: item.status,
          reason: item.error,
          signature: item.signature,
          rent: item.rentLamports,
          cost: item.recipientAccountLamports,
        }))
      : payload.outcomes.map((item) => ({
          key: item.mint,
          label: item.label,
          detail: truncateAddress(item.mint),
          status: item.sending ? ("sending" as const) : ("skipped" as const),
          reason: item.refused,
          signature: null,
          rent: item.reclaimsRent ? item.rentLamports : 0,
          cost: item.recipientAccountRentLamports,
        }));

  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      {summary ? (
        <div className="rounded-xl border border-border/60 p-3">
          <p className="text-sm font-medium">
            {summary.sentCount} sent
            {summary.failedCount > 0 ? `, ${summary.failedCount} failed` : ""}
            {summary.skippedCount > 0 ? `, ${summary.skippedCount} skipped` : ""}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {pluralize(summary.closedCount, "account")} closed, returning{" "}
            {formatSol(summary.rentLamports)}. After the fee and the deposits paid
            at the destination, the rent side of this batch is{" "}
            <span
              className={
                summary.netRentLamports < 0 ? "text-warning" : "text-success"
              }
            >
              {formatSol(summary.netRentLamports)}
            </span>
            .
          </p>
        </div>
      ) : null}

      <ul className="max-h-[22rem] space-y-1 overflow-y-auto pr-1">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-start gap-3 rounded-xl px-2 py-2 text-xs"
          >
            <span className="mt-0.5 shrink-0">
              {row.status === "sent" ? (
                <CheckCircle2 className="size-3.5 text-success" aria-hidden />
              ) : row.status === "failed" ? (
                <X className="size-3.5 text-danger" aria-hidden />
              ) : row.status === "sending" ? (
                <CheckCircle2 className="size-3.5 text-muted" aria-hidden />
              ) : (
                <AlertTriangle className="size-3.5 text-warning" aria-hidden />
              )}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium text-foreground">
                  {row.label}
                </span>
                <span className="font-mono text-subtle">{row.detail}</span>
                {row.rent > 0 ? (
                  <Badge variant="success" size="sm">
                    <Lock className="size-3" aria-hidden />
                    {formatSol(row.rent)}
                  </Badge>
                ) : null}
                {row.cost > 0 ? (
                  <Badge variant="muted" size="sm">
                    − {formatSol(row.cost)} to receive
                  </Badge>
                ) : null}
                {row.signature ? (
                  <>
                    <span className="font-mono text-[11px] text-subtle">
                      {truncateAddress(row.signature, 6, 6)}
                    </span>
                    <a
                      href={solscanTxUrl(row.signature)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-violet-glow hover:underline"
                    >
                      Solscan
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </>
                ) : null}
              </span>

              {row.reason ? (
                <span className="mt-0.5 block leading-relaxed text-muted">
                  {row.reason}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
