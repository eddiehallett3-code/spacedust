"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AlertTriangle, ExternalLink, Globe, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, SectionTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { SweepError } from "@/components/sweep/controls-column";
import { SimulationReport } from "@/components/sweep/simulation-report";
import { WarningsList } from "@/components/sweep/warnings-list";
import { useSalvage } from "@/hooks/use-salvage";
import { solscanTxUrl } from "@/lib/solana/submit";
import { feeFromRentLamports } from "@/lib/solana/rent";
import { RECLAIM_RATE } from "@/lib/config/tools";
import { RECLAIM_FEE_BPS } from "@/lib/utils/constants";
import { apiFetch } from "@/lib/utils/api";
import { toFriendlyError, type FriendlyError } from "@/lib/utils/errors";
import { formatSol, pluralize, truncateAddress } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { SalvageDomain } from "@/types/salvage";

/**
 * SNS names, and the rent their name accounts hold.
 *
 * This panel has to do one thing that no other panel in the app has to do: make it
 * unmistakable that the action is destructive. A token account close tidies up an
 * idle account. Deleting a domain **gives the name back** — it returns to the open
 * namespace where anyone can register it, its records and subdomains go with it,
 * and SNS's own documentation says plainly that they do not recommend it.
 *
 * So: nothing is pre-selected, every domain is a deliberate tick, the warning sits
 * above the list rather than in fine print, and the button says "delete" rather
 * than anything softer. The alternative — treating a name like dust because both
 * happen to hold rent — is how somebody loses a domain they wanted.
 */
export function DomainsPanel() {
  const { publicKey, connected } = useWallet();
  const salvage = useSalvage();
  const resetSalvage = salvage.reset;

  const [domains, setDomains] = useState<SalvageDomain[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const owner = publicKey?.toBase58() ?? null;
  const MAX_DELETE_SELECTION = 50;

  const load = useCallback(async (): Promise<void> => {
    if (!owner) {
      setDomains([]);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    resetSalvage();
    try {
      const result = await apiFetch<{
        domains: SalvageDomain[];
        truncated: boolean;
      }>(`/api/domains?owner=${encodeURIComponent(owner)}`, {
        cacheMs: 0,
      });
      setDomains(result.domains);
      setTruncated(result.truncated);
      // A rescan invalidates any selection: the list may have changed underneath it,
      // and a delete is not something to carry over from a previous view.
      setSelected(new Set());
    } catch (caught) {
      setLoadError(toFriendlyError(caught));
      setDomains([]);
    } finally {
      setIsLoading(false);
    }
  }, [owner, resetSalvage]);

  useEffect(() => {
    void load();
  }, [load]);

  const refusedReason = useCallback(
    (domain: SalvageDomain): string | null => {
      if (domain.tokenized) {
        return "This domain is wrapped as an NFT, which is the form marketplaces trade. Sending its delete is not built yet.";
      }
      if (domain.owner !== null && owner !== null && domain.owner !== owner) {
        return `The registry says this name belongs to ${truncateAddress(domain.owner, 4, 4)}, not to the connected wallet.`;
      }
      return null;
    },
    [owner],
  );

  const selectable = useMemo(
    () => domains.filter((domain) => refusedReason(domain) === null),
    [domains, refusedReason],
  );

  const chosen = useMemo(
    () => selectable.filter((domain) => selected.has(domain.address)),
    [selectable, selected],
  );

  const selectedRent = chosen.reduce(
    (sum, domain) => sum + Math.max(0, domain.lamports),
    0,
  );
  const selectedFee = chosen.reduce(
    (sum, domain) =>
      sum + feeFromRentLamports(Math.max(0, domain.lamports), RECLAIM_FEE_BPS),
    0,
  );

  const toggle = (address: string): void => {
    // A preview belongs to the selection it was built from. Changing the ticks
    // after a preview must not leave a delete button pointing at a stale batch.
    resetSalvage();
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(address)) next.delete(address);
      else if (next.size < MAX_DELETE_SELECTION) next.add(address);
      return next;
    });
  };

  const prepared = salvage.packed.length > 0;

  if (!connected) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <SectionTitle
            icon={<Globe className="size-4" aria-hidden />}
            title="Unused SNS names"
            description={
              domains.length > 0
                ? `${pluralize(domains.length, "domain")} found. Select up to ${MAX_DELETE_SELECTION} at a time; deleting one returns the rent its name account holds — and gives the name up.`
                : "Anything you are no longer using can be given back for the rent its account holds."
            }
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={isLoading}
            onClick={() => void load()}
          >
            <RefreshCw
              className={cn("mr-1.5 size-3.5", isLoading && "animate-spin")}
              aria-hidden
            />
            {isLoading ? "Looking…" : "Rescan"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {domains.length > 0 ? (
          <p className="flex items-start gap-1.5 rounded-xl border border-warning/25 bg-warning/6 p-3 text-[11px] leading-relaxed text-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              <strong className="font-semibold">
                Deleting a domain cannot be undone.
              </strong>{" "}
              The name goes back to the open namespace, where anyone can register
              it, and its records and subdomains go with it. Only the rent held in
              the name account comes back — the registration price does not. SNS
              themselves say they do not recommend deleting domains, so read each
              one before you tick it.
            </span>
          </p>
        ) : null}

        <p className="text-[11px] leading-relaxed text-subtle">
          SNS now displays existing names with a <code>.sns</code> suffix; legacy{" "}
          <code>.sol</code> resolution is paused during the migration. The delete
          acts on the name account itself, so the suffix is a label rather than a
          second asset.
        </p>

        {loadError ? <SweepError error={loadError} /> : null}

        <div className="max-h-[26rem] space-y-1 overflow-y-auto pr-1">
          {selectable.map((domain) => (
            <label
              key={domain.address}
              className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/4"
            >
              <Checkbox
                checked={selected.has(domain.address)}
                onCheckedChange={() => toggle(domain.address)}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-sm">
                  {domain.name}.sns
                </span>
                <span className="block truncate text-xs text-muted">
                  {domain.bytes} bytes ·{" "}
                  {truncateAddress(domain.address, 4, 4)}
                </span>
              </span>
              <Badge variant="success" size="sm">
                {formatSol(domain.lamports)}
              </Badge>
            </label>
          ))}

          {/* Refused, with the reason: nothing looks like it vanished from the
              wallet, and a wrapped domain says why it is not on offer. */}
          {domains
            .filter((domain) => refusedReason(domain) !== null)
            .map((domain) => (
              <div
                key={domain.address}
                className="flex items-start gap-3 rounded-xl px-2 py-2 opacity-70"
              >
                <span className="mt-0.5 size-[18px] shrink-0 rounded-[6px] border border-border-strong" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm">
                      {domain.name}.sns
                    </span>
                    {domain.tokenized ? (
                      <Badge variant="muted" size="sm">
                        NFT-wrapped
                      </Badge>
                    ) : null}
                  </span>
                  <span className="block text-xs leading-relaxed text-warning">
                    {refusedReason(domain)}
                  </span>
                </span>
              </div>
            ))}

          {!isLoading && domains.length === 0 && !loadError ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              No .sns domains in this wallet.
            </p>
          ) : null}

          {isLoading ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              Looking up your domains…
            </p>
          ) : null}
        </div>

        {truncated ? (
          <p className="text-[11px] text-subtle">
            Showing the first 250 domains. Delete some, then rescan for the rest.
          </p>
        ) : null}

        {chosen.length > 0 || prepared ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-border bg-white/2 p-3">
                <p className="text-[11px] text-subtle">Rent freed</p>
                <p className="mt-0.5 font-mono text-base tabular-nums">
                  {formatSol(prepared ? salvage.rentLamports : selectedRent)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-white/2 p-3">
                <p className="text-[11px] text-subtle">Fee</p>
                <p className="mt-0.5 font-mono text-base tabular-nums">
                  {formatSol(prepared ? salvage.reclaimFeeLamports : selectedFee)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-white/2 p-3">
                <p className="text-[11px] text-subtle">You receive</p>
                <p className="mt-0.5 font-mono text-base tabular-nums">
                  {formatSol(
                    prepared
                      ? salvage.netRentLamports
                      : selectedRent - selectedFee,
                  )}
                </p>
              </div>
            </div>

            <p className="text-[11px] leading-relaxed text-subtle">
              Spacedust takes {RECLAIM_RATE} of the rent these deletes return, the
              same rate as closing an empty account. Network fees are paid on top,
              and the registration price of a name is never recoverable — only the
              rent its account holds.
            </p>

            {prepared ? (
              <div className="flex flex-col gap-3">
                <SimulationReport
                  packed={salvage.packed}
                  simulations={salvage.simulations}
                  okCount={salvage.simulations.filter((item) => item.ok).length}
                  unitLabel="delete"
                />
                <WarningsList warnings={salvage.warnings} unitLabel="domain" />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={chosen.length === 0 || salvage.isBusy}
                onClick={() => void salvage.prepare(chosen)}
              >
                Preview {pluralize(chosen.length, "delete")}
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={!prepared || salvage.isBusy}
                onClick={() => void salvage.execute()}
              >
                <Trash2 className="mr-1.5 size-3.5" aria-hidden />
                Delete {pluralize(salvage.deleteCount, "domain")} for good
              </Button>
            </div>
          </>
        ) : null}

        <SweepError error={salvage.error} />

        {salvage.summary ? (
          <div className="rounded-xl border border-success/25 bg-success/6 p-3">
            <p className="text-sm font-medium">
              {pluralize(salvage.summary.deletedCount, "domain")} deleted ·{" "}
              {formatSol(salvage.summary.netRentLamports)} back in your wallet
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-subtle">
              {salvage.summary.failedCount > 0
                ? `${pluralize(salvage.summary.failedCount, "domain")} could not be deleted. `
                : ""}
              {formatSol(salvage.summary.rentLamports)} freed, our {RECLAIM_RATE}{" "}
              fee {formatSol(salvage.summary.reclaimFeeLamports)}, network fee{" "}
              {formatSol(salvage.summary.feeLamports)}.
            </p>
            {salvage.summary.signatures.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {salvage.summary.signatures.map((signature) => (
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
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                salvage.reset();
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

