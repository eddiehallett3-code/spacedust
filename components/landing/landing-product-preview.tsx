import Link from "next/link";
import { ArrowRight, ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

/**
 * A product preview, not a fake dashboard.
 *
 * The hero needs to show what Spacedust actually does. This is a compact,
 * deliberately labelled example of the Wallet Scan result: the same read-only
 * framing, address treatment and reclaim figures the real tool uses. The
 * "Example view" badge and the note at the bottom keep it honest — it is an
 * illustration, not a claim about a visitor's wallet.
 */
export function LandingProductPreview() {
  return (
    <figure
      aria-labelledby="scan-preview-title"
      className="relative mx-auto mt-12 w-full max-w-4xl"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-4 -z-10 rounded-[2rem] bg-violet-core/10 blur-2xl"
      />

      <Card className="glass-sheen overflow-hidden rounded-2xl border-border/70">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-violet-core/12 text-violet-glow ring-1 ring-inset ring-violet-core/20">
              <ScanLine className="size-4" aria-hidden />
            </span>
            <div>
              <p id="scan-preview-title" className="text-sm font-medium">
                Wallet Scan
              </p>
              <p className="text-[11px] text-subtle">
                Read-only · no wallet connection
              </p>
            </div>
          </div>
          <Badge variant="accent" size="sm">
            Example view
          </Badge>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-[1.15fr_0.85fr] sm:p-5">
          <div>
            <div className="rounded-xl border border-border/60 bg-black/20 p-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-subtle">
                Wallet address
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-sm text-foreground">
                  7xKX…9fQ2
                </span>
                <span className="rounded-full border border-success/20 bg-success/8 px-2 py-0.5 text-[10px] text-emerald-300">
                  Read-only
                </span>
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-3 gap-2">
              {[
                { label: "Token accounts", value: "12" },
                { label: "Reclaimable", value: "0.084", accent: true },
                { label: "Approvals", value: "3" },
              ].map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-xl border border-border/60 bg-white/[0.02] p-2.5"
                >
                  <dt className="text-[10px] leading-tight text-subtle">
                    {metric.label}
                  </dt>
                  <dd
                    className={
                      metric.accent
                        ? "mt-1 text-lg font-semibold tracking-tight text-success"
                        : "mt-1 text-lg font-semibold tracking-tight"
                    }
                  >
                    {metric.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="hidden rounded-xl border border-border/60 bg-white/[0.02] p-3 sm:block">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-subtle">
                Potential reclaim
              </p>
              <p className="text-sm font-semibold text-success">+0.084 SOL</p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/6">
              <div className="h-full w-[68%] rounded-full bg-linear-to-r from-violet-core to-cyan-core" />
            </div>
            <ul className="mt-3 space-y-1.5 text-[11px] text-muted">
              <li className="flex justify-between gap-2">
                <span>Dust positions</span>
                <span className="text-foreground">12</span>
              </li>
              <li className="flex justify-between gap-2">
                <span>Empty token accounts</span>
                <span className="text-foreground">8</span>
              </li>
              <li className="flex justify-between gap-2">
                <span>Open approvals</span>
                <span className="text-foreground">3</span>
              </li>
            </ul>
            <p className="mt-3 text-[10px] leading-snug text-subtle">
              Illustrative preview. Results depend on the wallet.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3 sm:px-5">
          <p className="text-[11px] text-subtle">
            No wallet connection needed for the scan.
          </p>
          <Link
            href="/scan"
            className="group inline-flex items-center gap-1 text-xs font-medium text-violet-glow transition-colors hover:text-violet-core"
          >
            Try the free scan
            <ArrowRight
              className="size-3.5 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </div>
      </Card>
    </figure>
  );
}
