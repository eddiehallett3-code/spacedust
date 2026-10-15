"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, SectionTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Setup diagnostics panel.
 *
 * Shown on Slingshot's page only when something is actually misconfigured, so a
 * working deployment never shows it. Answers the only two questions that matter
 * on day one: "are my keys picked up?" and "do they work?".
 */

interface HealthResponse {
  ok: boolean;
  checks: Record<
    "helius" | "jupiter" | "fees",
    { configured: boolean; working: boolean; detail: string }
  >;
  nextSteps: string[];
}

const LABELS: Record<string, string> = {
  helius: "Helius (token scanning + RPC)",
  jupiter: "Jupiter (pricing + swaps)",
  fees: "Integrator fees",
};

export function SetupNotice() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const run = (): void => {
    setLoading(true);
    fetch("/api/health", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: HealthResponse) => setHealth(data))
      .catch(() =>
        setHealth({
          ok: false,
          checks: {
            helius: {
              configured: false,
              working: false,
              detail: "Could not reach /api/health.",
            },
            jupiter: {
              configured: false,
              working: false,
              detail: "Could not reach /api/health.",
            },
            fees: {
              configured: false,
              working: false,
              detail: "Could not reach /api/health.",
            },
          },
          nextSteps: ["Is the dev server running?"],
        }),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    run();
  }, []);

  // Never show anything when the setup is fine — or when the user dismissed it.
  if (dismissed || loading || !health) return null;
  if (health.ok) return null;

  const failing = Object.entries(health.checks).filter(
    ([, value]) => !value.working,
  );

  return (
    <Card className="mb-6 border-warning/25 bg-warning/4">
      <CardHeader className="pb-3">
        <SectionTitle
          icon={<AlertTriangle className="size-4" aria-hidden />}
          title="Setup check"
          description="A few things are not configured yet. The app will still run."
          action={
            <div className="flex gap-1.5">
              <Button variant="ghost" size="sm" onClick={run}>
                Re-check
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
                Dismiss
              </Button>
            </div>
          }
        />
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        <ul className="space-y-1.5">
          {Object.entries(health.checks).map(([key, check]) => (
            <li key={key} className="flex items-start gap-2 text-xs">
              <span className="mt-px shrink-0">
                {check.working ? (
                  <CheckCircle2 className="size-3.5 text-success" aria-label="Working" />
                ) : (
                  <XCircle className="size-3.5 text-subtle" aria-label="Not configured" />
                )}
              </span>
              <span>
                <span className="font-medium text-foreground">
                  {LABELS[key] ?? key}
                </span>
                <span className="text-muted"> — {check.detail}</span>
              </span>
            </li>
          ))}
        </ul>

        {health.nextSteps.length > 0 ? (
          <div className="rounded-xl border border-border bg-white/3 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-subtle">
              What to do
            </p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs text-muted">
              {health.nextSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="mt-2 text-[11px] text-subtle">
              Edit <code className="text-cyan-glow">.env.local</code>, then
              restart the dev server — environment variables are read at
              startup, not per request.
            </p>
          </div>
        ) : null}

        {failing.length === 0 ? null : (
          <p className="flex items-center gap-1.5 text-[11px] text-subtle">
            <Loader2 className="size-3" aria-hidden />
            Diagnosing {failing.length} item
            {failing.length === 1 ? "" : "s"}…
          </p>
        )}
      </CardContent>
    </Card>
  );
}