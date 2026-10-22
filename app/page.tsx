import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container } from "@/components/layout/container";
import { ToolEmblem } from "@/components/layout/tool-emblem";
import { LandingFlight } from "@/components/landing/landing-flight";
import { LandingHero } from "@/components/landing/landing-hero";
import { Card, CardContent } from "@/components/ui/card";
import { DISPLAY_FONT_STYLE } from "@/lib/ui/fonts";
import { getSiteUrl } from "@/lib/config/site";
import { TOOLS } from "@/lib/config/tools";
import { RECLAIM_FEE_BPS } from "@/lib/utils/constants";

/**
 * The landing page.
 *
 * This was the sweeper until the tools outgrew a single front door: a visitor
 * arriving at the root was asked for a wallet to do one specific job, with the
 * others a nav item away and unexplained. The root is now a front door instead —
 * what each tool is for, in one line each, and a way in.
 *
 * No wallet is requested here. The connect button is in the header for anyone
 * who already knows what they want, and `/scan` is the read-only way in for
 * anyone who does not.
 *
 * `title` is deliberately absent: the root layout supplies the site title, and
 * a page title here would only repeat it with a suffix.
 */
export const metadata: Metadata = {
  // Per page, and deliberately not in the root layout: metadata merges downwards,
  // so a canonical of "/" there would declare every page a duplicate of the home
  // page. It matters because the site answers on two hosts — the custom domain and
  // the *.vercel.app one — and a crawler finding both is free to choose either.
  alternates: { canonical: "/" },
  description:
    "Six non-custodial tools for a Solana wallet: batch swap, send, and send unwanted tokens, NFTs and cNFTs into The Void; reclaim rent; revoke approvals; and scan any address read-only.",
};

/**
 * Structured data, so a search result can say what this is.
 *
 * `SoftwareApplication`, and deliberately not `FAQPage`. The how-it-works page
 * reads like questions and answers, but its headings are numbered steps — "1.
 * Finding your dust", "8. What can go wrong" — and FAQ markup is supposed to mirror
 * visible question-and-answer pairs. Marking a page up as something it is not is the
 * one way structured data can actively hurt, and this site's entire argument is that
 * it does not overstate.
 *
 * There is no `offers` block either. The app costs nothing to use and takes a
 * percentage of what it recovers, which is a sentence rather than a price, and a
 * `price: "0"` offer would read as "free of charge" to anything parsing it. The rate
 * goes in the description instead, where both halves of it fit.
 *
 * Every value is derived — the tools from `TOOLS`, the rates from the constants the
 * flows charge from — so a renamed tool or a repriced flow cannot leave this claiming
 * something the app no longer does.
 */
function structuredData() {
  const reclaimRate = `${(RECLAIM_FEE_BPS / 100).toFixed(1)}%`;

  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: process.env.NEXT_PUBLIC_APP_NAME || "Spacedust",
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    url: getSiteUrl(),
    logo: `${getSiteUrl()}/logo-512.png`,
    image: `${getSiteUrl()}/logo-512.png`,
    description: `Non-custodial tools for a Solana wallet. No fee on a swap; ${reclaimRate} of the rent any flow returns, shown before you sign, and you sign every transaction.`,
    featureList: TOOLS.map((tool) => `${tool.name} — ${tool.tagline}`),
  };
}

export default async function HomePage() {
  /**
   * The JSON-LD block below is a `<script>`, so a strict `script-src` covers it
   * like any other — nonced, or silently dropped. Next applies the nonce to the
   * scripts it renders itself; this one is ours to label.
   */
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <Container size="wide">
      <script
        type="application/ld+json"
        nonce={nonce}
        // `JSON.stringify` of an object assembled in this module: no user input and
        // no request data reaches it, so there is nothing to escape. That is a
        // property of *this* value, not a general rule — if anything dynamic is
        // ever added here, the `</script>` sequence inside a string is enough to
        // break out of the tag and it has to be escaped properly.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }}
      />
      <LandingFlight>
        <LandingHero />

        {/* Each tool in its own box: the mark large enough to recognise, one line
            of what it is for, and a way in. The line comes from the shared tool
            list, so it cannot drift away from the nav's own labels. Three across
            rather than four: with six tools that is two even rows, and the wider
            column keeps each line to one line. */}
        <section
          id="tools"
          aria-labelledby="tools-heading"
          className="relative z-10 scroll-mt-24 pt-10 sm:pt-14"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-subtle">
                The toolkit
              </p>
              <h2
                id="tools-heading"
                style={DISPLAY_FONT_STYLE}
                className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
              >
                Six tools for a cleaner wallet.
              </h2>
            </div>
            <Link
              href="/how-it-works"
              className="group inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
            >
              How each tool works
              <ArrowRight
                className="size-3.5 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TOOLS.map((tool) => (
              <Card
                key={tool.key}
                className="flex flex-col transition-colors hover:border-white/20"
              >
                <CardContent className="flex flex-1 flex-col items-center gap-3 text-center">
                  <ToolEmblem tool={tool.key} className="size-10" />
                  <p className="text-base font-semibold tracking-tight">
                    {tool.name}
                  </p>
                  <p className="text-sm leading-relaxed text-muted">
                    {tool.tagline}
                  </p>
                  <Link
                    href={tool.href}
                    className="group mt-auto inline-flex items-center gap-1 pt-1 text-sm font-medium text-violet-glow transition-colors hover:text-violet-core"
                  >
                    {tool.cta}
                    <ArrowRight
                      className="size-3.5 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </LandingFlight>

      <section className="relative z-10 mt-14 text-center">
        <p className="text-sm">
          <Link
            href="/how-it-works"
            className="text-violet-glow transition-colors hover:text-violet-core hover:underline"
          >
            How each tool works
          </Link>
          <span className="text-subtle" aria-hidden>
            {" · "}
          </span>
          <Link
            href="/security"
            className="text-violet-glow transition-colors hover:text-violet-core hover:underline"
          >
            What Spacedust can and cannot do
          </Link>
        </p>
      </section>
    </Container>
  );
}
