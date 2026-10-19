"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SimulationReport } from "@/components/sweep/simulation-report";
import { WarningsList } from "@/components/sweep/warnings-list";
import { BatchReport } from "@/components/payload/batch-report";
import { RefundNote } from "@/components/legal/refund-note";
import { solscanTxUrl } from "@/lib/solana/submit";
import { PAYLOAD_RATE } from "@/lib/config/tools";
import { formatSol, pluralize, truncateAddress } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { usePayload } from "@/hooks/use-payload";

/**
 * The last screen before a signature.
 *
 * It shows two things the other flows do not have to: what the send *costs*, and
 * the possibility that it costs more than it returns. A batch send is not a money
 * -making action — the assets leave the wallet — so the only figure that belongs
 * here is the rent, and the honest form of it is the net: what the closes free,
 * less Payload's fee, less the deposits the recipient's accounts need.
 *
 * That net can be negative, and it commonly is: a wallet that has never held a
 * mint needs an account, and the sender pays that account's rent-exempt deposit.
 * Saying so here is the point — the alternative is finding out on Solscan.
 */
export function SendPreview({
  payload,
  itemCount,
  canPrepare,
  canSend,
  blockedReason,
  sendBlockedReason,
  onPrepare,
  onSend,
  onFinish,
}: {
  payload: ReturnType<typeof usePayload>;
  itemCount: number;
  canPrepare: boolean;
  canSend: boolean;
  /** Why the preview action is unavailable, when it is. */
  blockedReason: string | null;
  /** Why signing is unavailable, when the preview itself was fine. */
  sendBlockedReason: string | null;
  onPrepare: () => void;
  onSend: () => void;
  /** Clear the finished batch so another one can be built. */
  onFinish: () => void;
}) {
  const prepared = payload.packed.length > 0;
  /**
   * One signature per transaction submitted, which is what makes a batch
   * traceable: four items sent in two transactions produce two ids, and the
   * report below says which item rode in which.
   */
  const signatures = payload.summary?.signatures ?? [];
  const lines = [
    {
      label: "Rent freed by closing emptied accounts",
      value: formatSol(payload.rentLamports),
    },
    {
      label: `Payload's fee, ${PAYLOAD_RATE} of that rent`,
      value: `− ${formatSol(payload.feeLamports)}`,
    },
    {
      label: "Paid at the destination to create accounts",
      value: `− ${formatSol(payload.recipientAccountLamports)}`,
    },
    {
      label: "Network and priority fees (paid either way)",
      value: `− ${formatSol(payload.networkFeeLamports)}`,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>The batch</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <BatchReport payload={payload} />

        {prepared ? (
          <>
            <dl className="space-y-1.5 rounded-xl border border-border/60 p-3 text-xs">
              {lines.map((line) => (
                <div key={line.label} className="flex justify-between gap-3">
                  <dt className="text-muted">{line.label}</dt>
                  <dd className="shrink-0 font-mono">{line.value}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-border/60 pt-1.5">
                <dt className="font-medium">Net on rent</dt>
                <dd
                  className={cn(
                    "shrink-0 font-mono font-medium",
                    payload.netLamports < 0 ? "text-warning" : "text-success",
                  )}
                >
                  {formatSol(payload.netLamports)}
                </dd>
              </div>
            </dl>
            <RefundNote />

            {payload.netIsNegative ? (
              <div className="rounded-xl border border-warning/25 bg-warning/6 p-3">
                <p className="flex items-start gap-1.5 text-xs font-medium text-warning">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                  This batch frees less rent than it costs to deliver.
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">
                  The recipient needs an account for at least one mint, and the
                  sender pays that deposit. Sending to a wallet that already holds
                  these mints removes the cost — and sending a *valuable* asset is
                  worth doing regardless of rent.
                </p>
              </div>
            ) : null}

            <WarningsList warnings={payload.warnings} unitLabel="item" />

            <SimulationReport
              packed={payload.packed}
              simulations={payload.simulations}
              okCount={payload.simulations.filter((s) => s.ok).length}
              unitLabel="send"
            />
          </>
        ) : null}

        {payload.phase === "success" ? (
          <div className="rounded-xl border border-success/25 bg-success/6 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-success">
              <CheckCircle2 className="size-3.5" aria-hidden />
              Batch sent
            </p>

            {signatures.length > 0 ? (
              <>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                  {pluralize(signatures.length, "transaction")} — open one on
                  Solscan to see exactly what moved, or copy its id.
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {signatures.map((signature) => (
                    <li key={signature}>
                      <TransactionId signature={signature} />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={onFinish}>
                Send another batch
              </Button>
            </div>
          </div>
        ) : (
          <>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canPrepare || payload.isBusy}
            onClick={onPrepare}
          >
            {payload.isBusy && !prepared ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />
            ) : null}
            {prepared
              ? "Rebuild the preview"
              : `Preview ${pluralize(itemCount, "item")}`}
          </Button>

          <Button
            size="sm"
            disabled={!canSend || !prepared || payload.isBusy}
            onClick={onSend}
          >
            <Send className="mr-1.5 size-3.5" aria-hidden />
            Sign &amp; send
          </Button>

        </div>

        {/* A disabled button with no reason leaves the user guessing whether they
            missed a step — and the reason is usually something they can act on. */}
        {blockedReason ?? sendBlockedReason ? (
          <p className="text-[11px] leading-relaxed text-muted">
            {blockedReason ?? sendBlockedReason}
          </p>
        ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One transaction id, as something a person can actually use.
 *
 * Three ways to check it, because they answer different needs: the id is on
 * screen so it can be read out or matched, clicking copies it whole, and the
 * link opens the transaction. A truncated id alone is useless for a support
 * conversation, and a link alone cannot be copied into one.
 */
function TransactionId({ signature }: { signature: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        title="Copy the full transaction id"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(signature);
            setCopied(true);
            setTimeout(() => setCopied(false), 1_500);
          } catch {
            // A blocked clipboard is not worth an error: the id is on screen and
            // the Solscan link next to it works either way.
          }
        }}
        className="font-mono text-xs text-foreground transition-colors hover:text-violet-glow"
      >
        {truncateAddress(signature, 8, 8)}
      </button>
      {copied ? (
        <span className="text-[11px] text-success">copied</span>
      ) : null}
      <a
        href={solscanTxUrl(signature)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[11px] text-violet-glow transition-colors hover:text-violet-core hover:underline"
      >
        Solscan
        <ExternalLink className="size-3" aria-hidden />
      </a>
    </span>
  );
}
