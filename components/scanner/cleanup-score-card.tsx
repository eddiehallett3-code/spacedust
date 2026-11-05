"use client";

import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { scoreWallet } from "@/lib/score/cleanup-score";
import type { WalletScan } from "@/types/token";
import type { RecoverableBreakdown } from "@/lib/sweep/recoverable";

/**
 * The one number the scan adds up to.
 *
 * Every factor is shown with the points it cost, because a bare score of 47 tells
 * a person nothing except that they are being judged. Reading "Rent left in empty
 * accounts — 12 of 30" explains the number and points at the tool that fixes it.
 *
 * The footnote is load-bearing rather than legal boilerplate: it says what the
 * score counts, so nobody reads a low score as "this wallet is compromised".
 */
export function CleanupScoreCard({
  scan,
  recoverable,
}: {
  scan: WalletScan;
  recoverable: RecoverableBreakdown;
}) {
  const result = scoreWallet({
    tokens: scan.tokens.map((token) => ({
      valueUsd: token.valueUsd,
      hasNoPrice: token.hasNoPrice,
      poolLike: token.poolLike,
      staked: token.staked !== null,
      frozen: token.frozen,
      hazards: token.hazards?.map((hazard) => ({ severity: hazard.severity })),
    })),
    emptyRentLamports: recoverable.emptyRentLamports,
    excessRentLamports: recoverable.excessRentLamports,
    approvalsCount: scan.approvalsCount ?? null,
    solPriceUsd: recoverable.solPriceUsd ?? null,
  });

  const tone =
    result.band.tone === "success"
      ? "text-success"
      : result.band.tone === "warning"
        ? "text-warning"
        : "text-danger";

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle className="text-sm font-medium text-muted">Cleanup score</CardTitle>
        <p className={cn("text-xs font-medium", tone)}>{result.band.label}</p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex items-end gap-2">
          <span className={cn("font-mono text-4xl tabular-nums leading-none", tone)}>
            {result.score}
          </span>
          <span className="pb-1 text-2xs text-subtle">out of 100</span>
        </div>

        <ul className="flex flex-col gap-2">
          {result.factors.map((factor) => (
            <li key={factor.key} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium">{factor.label}</p>
                <p className="mt-0.5 text-2xs leading-relaxed text-subtle">
                  {factor.detail}
                </p>
              </div>
              <p
                className={cn(
                  "shrink-0 font-mono text-xs tabular-nums",
                  factor.points > 0 ? "text-foreground" : "text-subtle",
                )}
              >
                {factor.points > 0 ? `−${factor.points}` : "0"}
                <span className="text-subtle">/{factor.max}</span>
              </p>
            </li>
          ))}
        </ul>

        <p className="text-2xs leading-relaxed text-subtle">
          Counts only what this app can act on: rent you can reclaim, holdings with
          no market, issuing powers over what you hold, and standing approvals. It
          is a cleanup score, not a safety rating.
        </p>
      </CardContent>
    </Card>
  );
}
