import Link from "next/link";
import { Code2, ShieldCheck } from "lucide-react";
import { getTwitterHandle, getTwitterUrl } from "@/lib/config/social";
import { RECLAIM_FEE_BPS, SWAP_FEE_BPS } from "@/lib/utils/constants";
import { Container } from "./container";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Spacedust";

/**
 * The X logo.
 *
 * The real mark, not an approximation. The geometry below is the official X
 * glyph as published by `simple-icons`, checked against both the repository and
 * the CDN copy, and filled with `currentColor` so it takes the colour of the link
 * it sits in.
 *
 * Inlined rather than imported because this version of `lucide-react` ships no
 * brand icons: `Twitter` is gone, and its `X` is the dialog *close* glyph, so
 * reaching for that would put a cross in the footer meaning the opposite of
 * "follow us". A stroked drawing of the mark was tried first and read as a
 * mistake at this size — the logotype's whole character is in its solid tapered
 * cuts, and two plain strokes lose it. The viewBox is 24 wide so it sizes with
 * the same `size-3.5` as every other mark on this row.
 */
function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z" />
    </svg>
  );
}

export function Footer() {
  const twitterUrl = getTwitterUrl();
  const twitterHandle = getTwitterHandle();
  const github = process.env.NEXT_PUBLIC_GITHUB_URL;

  // Only rendered if it looks like an address. A typo here would produce a mailto
  // link that silently does nothing, which is worse than no link at all for the
  // one control whose entire job is to be reachable.
  const rawSupport = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();
  const support = rawSupport && rawSupport.includes("@") ? rawSupport : null;

  return (
    <footer className="relative z-10 mt-20 border-t border-border/70">
      <Container>
        <div className="flex flex-col gap-8 py-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm space-y-3">
            <p className="text-sm font-semibold tracking-tight">{APP_NAME}</p>
            <p className="text-sm leading-relaxed text-muted">
              Non-custodial tools for maintaining a Solana wallet — batch swap,
              batch send, send the rest into The Void, and clear away what you are
              done with.
            </p>
            <p className="flex items-start gap-1.5 text-xs text-muted">
              <ShieldCheck
                className="mt-px size-3.5 shrink-0 text-success"
                aria-hidden
              />
              <span>
                {(SWAP_FEE_BPS / 100).toFixed(1)}% on swaps, and{" "}
                {(RECLAIM_FEE_BPS / 100).toFixed(1)}% of the rent any flow returns —
                Void sends, account closes, Payload sends, domain deletes. All shown
                before you sign, and you sign every transaction.
              </span>
            </p>
          </div>

          {/* Mirrors the navbar, in the same order: the flows that act on a
              wallet, the security job, then the lookup, then the explainers. */}
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
            <Link
              href="/slingshot"
              className="text-muted transition-colors hover:text-foreground"
            >
              Slingshot
            </Link>
            <Link
              href="/void"
              className="text-muted transition-colors hover:text-foreground"
            >
              The Void
            </Link>
            <Link
              href="/payload"
              className="text-muted transition-colors hover:text-foreground"
            >
              Payload
            </Link>
            <Link
              href="/salvage"
              className="text-muted transition-colors hover:text-foreground"
            >
              Salvage
            </Link>
            <Link
              href="/approvals"
              className="text-muted transition-colors hover:text-foreground"
            >
              Revoke approvals
            </Link>
            <Link
              href="/scan"
              className="text-muted transition-colors hover:text-foreground"
            >
              Wallet Scan
            </Link>
            <Link
              href="/how-it-works"
              className="text-muted transition-colors hover:text-foreground"
            >
              How it works
            </Link>
            <Link
              href="/security"
              className="text-muted transition-colors hover:text-foreground"
            >
              Security
            </Link>
            {github ? (
              <a
                href={github}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1.5 text-muted transition-colors hover:text-foreground"
              >
                <Code2 className="size-3.5" aria-hidden />
                Source
              </a>
            ) : null}
            {twitterUrl ? (
              <a
                href={twitterUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                // Labelled with the handle rather than "Updates". A link that
                // names the account it opens can be checked against the profile
                // the security page points at, which is the whole value of having
                // it in the footer at all. If the configured value has no handle
                // to read, it falls back to what it used to say.
                className="inline-flex items-center gap-1.5 text-muted transition-colors hover:text-foreground"
              >
                <XLogo className="size-3.5" />
                {twitterHandle ?? "Updates"}
              </a>
            ) : null}
          </nav>
        </div>

        <div className="border-t border-border/60 py-6">
          <p className="text-xs leading-relaxed text-subtle">
            <strong className="font-semibold text-muted">Safety note:</strong>{" "}
            Always verify you are on the correct domain before connecting your
            wallet, and never approve a transaction you do not understand. This
            app never asks for your private key or seed phrase. Routing is
            provided by Jupiter; swap outcomes are not guaranteed.
          </p>
          <p className="mt-3 text-xs text-subtle">
            © {new Date().getFullYear()} {APP_NAME}. Not financial advice.
            {support ? (
              <>
                {" "}
                Questions, or a fee that looks wrong?{" "}
                <a
                  href={`mailto:${support}`}
                  className="text-muted underline underline-offset-2 transition-colors hover:text-foreground"
                >
                  {support}
                </a>
                {/* Stated here rather than left to the reply: the likeliest
                    message this address receives is from someone who has lost a
                    wallet, and no answer to it exists. Saying so saves them the
                    wait and says it once. */}
                . This address cannot recover a wallet or a seed phrase.
              </>
            ) : null}
          </p>
        </div>
      </Container>
    </footer>
  );
}