import Link from "next/link";
import { ArrowRight, CheckCircle2, ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * The Wallet Scan entry point.
 *
 * This used to be an illustrative dashboard with made-up figures. It is now the
 * actual read-only lookup: paste an address, submit, and land on `/scan` with
 * the result. The address is the only input; nothing is connected and nothing is
 * signed, so the hero can show the product by letting a visitor use it.
 *
 * The right-hand column describes what the scan returns rather than inventing
 * numbers for a wallet nobody owns. That is the honest version of a preview.
 */
const OUTPUTS = [
  "Token accounts, balances and Token-2022 extensions",
  "Rent locked inside empty accounts",
  "Standing approvals, and what a sweep would refuse",
] as const;

export function LandingProductPreview() {
  return (
    <figure
      id="scan"
      aria-labelledby="scan-preview-title"
      className="relative mx-auto mt-12 w-full max-w-4xl scroll-mt-24"
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
          <Badge
            size="sm"
            className="border-cyan-500/25 bg-cyan-500/10 text-cyan-300"
          >
            Read-only
          </Badge>
        </div>

        <div className="grid gap-5 p-4 sm:grid-cols-[1.15fr_0.85fr] sm:p-5">
          <form action="/scan" method="get" className="min-w-0">
            <label
              htmlFor="landing-wallet"
              className="text-[10px] font-medium uppercase tracking-[0.16em] text-subtle"
            >
              Wallet address
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Input
                id="landing-wallet"
                name="owner"
                type="text"
                required
                minLength={32}
                maxLength={44}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Paste a Solana address"
                aria-describedby="landing-wallet-note"
                className="rounded-lg font-mono"
              />
              <Button type="submit" className="group shrink-0">
                Scan wallet
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Button>
            </div>
            <p
              id="landing-wallet-note"
              className="mt-2 text-[11px] leading-relaxed text-subtle"
            >
              No wallet connection. Nothing is signed.
            </p>
          </form>

          <div className="rounded-xl border border-border/60 bg-white/[0.02] p-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-subtle">
              What the scan returns
            </p>
            <ul className="mt-3 space-y-2.5">
              {OUTPUTS.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2 text-[11px] leading-relaxed text-muted"
                >
                  <CheckCircle2
                    className="mt-0.5 size-3.5 shrink-0 text-cyan-glow"
                    aria-hidden
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[10px] leading-snug text-subtle">
              The result is a link you can share.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3 sm:px-5">
          <p className="text-[11px] text-subtle">
            Read-only lookup. No wallet needed.
          </p>
          <Link
            href="/how-it-works#scan"
            className="group inline-flex items-center gap-1 text-xs font-medium text-violet-glow transition-colors hover:text-violet-core"
          >
            How the scan works
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
