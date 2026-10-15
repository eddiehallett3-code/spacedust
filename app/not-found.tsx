import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { getSiteUrl } from "@/lib/config/site";
import { TOOLS } from "@/lib/config/tools";

export const metadata: Metadata = {
  title: "Page not found",
};

/** Every page there is, for the one screen whose whole job is "which one?". */
const PAGES = [
  ...TOOLS.map((tool) => ({ href: tool.href, label: tool.name })),
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Security" },
];

/**
 * The 404.
 *
 * There was no `not-found.tsx` until launch, so an unmatched URL rendered Next's
 * built-in page. That page carries its own CSS — `body{color:#000;background:#fff}`
 * with a dark-mode media query — and it renders *inside* the root layout, so the
 * result was the dark navbar and footer around a body painted white on any
 * light-mode machine, with "404 | This page could not be found." in the middle of
 * it. A link shared into a chat is a common way to arrive here, so this is not a
 * dusty edge case: it is what a first-time visitor sees the first time a link
 * rots.
 *
 * The mark is a magnifier with a cross rather than a tool emblem. Tool emblems
 * each say what that tool does, and this is not a tool — but it occupies the same
 * slot, so it is drawn to the same spec the emblems use (a 24-box, 1.5 stroke,
 * white) while saying something true about *this* page.
 *
 * The link list is built from `TOOLS`, so a tool that moves its route is fixed
 * here at the same time — and a mistyped `/salvage` is then one click from being
 * found rather than one more dead end. The domain line reuses `getSiteUrl()` for
 * the reason the security page does: someone who mistyped an address or followed
 * a bad link is exactly who arrives on this page, which makes it the second-best
 * place on the site to say where the real site is.
 */
export default function NotFound() {
  const siteHost = new URL(getSiteUrl()).host;

  return (
    <Container size="narrow">
      <PageHeader
        emblem={<SearchX className="size-7 text-white" strokeWidth={1.5} aria-hidden />}
        title="Nothing at this address"
        description="There is no page here. The link may be old, or the address may have a typo in it."
      />

      <div className="flex flex-col items-center gap-4">
        <Button asChild size="lg">
          <Link href="/">See all six tools</Link>
        </Button>
        {/* The read-only way in, offered by name rather than as "home": someone
            who has just landed on nothing is a worse candidate for a wallet
            prompt than anyone else on the site. */}
        <Link
          href="/scan"
          className="text-sm text-muted transition-colors hover:text-foreground"
        >
          Or look up a wallet without connecting anything
        </Link>
      </div>

      <nav
        aria-label="Every page"
        className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 border-t border-border/60 pt-6 text-sm"
      >
        {PAGES.map((page) => (
          <Link
            key={page.href}
            href={page.href}
            className="text-violet-glow transition-colors hover:text-violet-core hover:underline"
          >
            {page.label}
          </Link>
        ))}
      </nav>

      <p className="mt-6 text-center text-xs leading-relaxed text-subtle">
        Check the address bar before you connect anything: the real Spacedust is
        at{" "}
        <code className="rounded bg-white/8 px-1.5 py-0.5 font-mono">
          {siteHost}
        </code>
        . We will never ask for a seed phrase.
      </p>
    </Container>
  );
}
