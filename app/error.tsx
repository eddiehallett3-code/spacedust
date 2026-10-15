"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";

/**
 * The route error boundary.
 *
 * Without this, a render-time exception fell through to Next's stock screen:
 * "Application error: a client-side exception has occurred (see the browser
 * console for more information)". That is at its worst exactly where a crash is
 * likeliest — mid-flow, wallet connected, a moment before something gets signed
 * — and it answers none of the questions a user actually has, the first of which
 * is "did I just sign something?".
 *
 * Hence the one sentence this page exists for, and why it is conditional rather
 * than reassuring. A crashed component cannot have signed anything, because
 * signing requires the wallet's own approval window, which this app neither
 * controls nor can fake. So the precise claim is the true one: if the wallet did
 * not ask, nothing was signed. An unconditional "nothing was signed" would be a
 * promise this code cannot make on the wallet's behalf.
 *
 * `reset()` re-renders the segment and is worth offering because the common
 * causes are transient — a wallet extension answering late, an RPC blip. Going
 * home is the escape hatch for when the state itself is bad: everything this app
 * keeps is local, and nothing is half-submitted server-side, so leaving costs
 * only the current selection.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // The only record of this that exists anywhere. There is deliberately no
  // third-party error reporting here — the security page promises no analytics —
  // so this console line, and the digest beside it, are all an operator has when
  // a user reports that something broke. Same `[spacedust]` prefix the wallet
  // adapter and the QR scanner already log under.
  useEffect(() => {
    console.error("[spacedust] route segment error:", error);
  }, [error]);

  return (
    <Container size="narrow">
      <PageHeader
        emblem={
          <AlertTriangle className="size-7 text-warning" strokeWidth={1.5} aria-hidden />
        }
        title="This page failed to render"
        description="The app hit an error drawing this screen. If your wallet never asked you to approve something, nothing was signed — signing needs that prompt, and it is not something this page can do on its own."
      />

      <div className="flex flex-col items-center gap-4">
        <Button size="lg" onClick={reset}>
          Try again
        </Button>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href="/"
            className="text-muted transition-colors hover:text-foreground"
          >
            Back to the tools
          </Link>
          <span className="text-subtle" aria-hidden>
            ·
          </span>
          <Link
            href="/scan"
            className="text-muted transition-colors hover:text-foreground"
          >
            Wallet Scan
          </Link>
        </div>
      </div>

      {error.digest ? (
        <p className="mt-12 border-t border-border/60 pt-6 text-center text-xs leading-relaxed text-subtle">
          If you report this, quote{" "}
          <code className="rounded bg-white/8 px-1.5 py-0.5 font-mono">
            {error.digest}
          </code>{" "}
          — it ties the failure to its entry in the server log.
        </p>
      ) : null}
    </Container>
  );
}
