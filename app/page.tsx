import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldCheck, Wallet } from "lucide-react";
import { Container } from "@/components/layout/container";
import { ToolEmblem } from "@/components/layout/tool-emblem";
import { Card, CardContent } from "@/components/ui/card";
import { getSiteUrl } from "@/lib/config/site";
import { TOOLS } from "@/lib/config/tools";
import { RECLAIM_FEE_BPS, SWAP_FEE_BPS } from "@/lib/utils/constants";

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

/** True of every tool, which is why it is said once, here. */
const GUARANTEES = [
  { icon: ShieldCheck, text: "Non-custodial. No seed phrase, ever." },
  { icon: CheckCircle2, text: "Simulated before you sign." },
  { icon: Wallet, text: "You sign every transaction." },
];

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
  const swapRate = `${(SWAP_FEE_BPS / 100).toFixed(1)}%`;
  const reclaimRate = `${(RECLAIM_FEE_BPS / 100).toFixed(1)}%`;

  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: process.env.NEXT_PUBLIC_APP_NAME || "Spacedust",
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    url: getSiteUrl(),
    description: `Non-custodial tools for a Solana wallet. ${swapRate} on swaps and ${reclaimRate} of the rent any flow returns, both shown before you sign, and you sign every transaction.`,
    featureList: TOOLS.map((tool) => `${tool.name} — ${tool.tagline}`),
  };
}

export default function HomePage() {
  return (
    <Container size="wide">
      <script
        type="application/ld+json"
        // `JSON.stringify` of an object assembled in this module: no user input and
        // no request data reaches it, so there is nothing to escape. That is a
        // property of *this* value, not a general rule — if anything dynamic is
        // ever added here, the `</script>` sequence inside a string is enough to
        // break out of the tag and it has to be escaped properly.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }}
      />
      <section className="pt-14 text-center sm:pt-18 lg:pt-20">
        {/* The site mark, not a tool emblem — each tool gets its own below, and
            this one is the product they share. The artwork itself carries the
            name, so there is no visible wordmark next to it: the heading below is
            for search and assistive tech, not for the eye. */}
        <div className="flex justify-center">
          <span className="relative flex size-64 items-center justify-center overflow-hidden rounded-[3rem] ring-1 ring-inset ring-white/10">
            <Image
              src="/logo.svg"
              alt=""
              width={256}
              height={256}
              priority
              className="size-64"
              aria-hidden
            />
            <span className="absolute inset-0 rounded-[3rem] ring-1 ring-inset ring-white/20 animate-pulse-ring" />
          </span>
        </div>

        <h1 className="sr-only">Spacedust</h1>
      </section>

      {/* Each tool in its own box: the mark large enough to recognise, one line
          of what it is for, and a way in. The line comes from the shared tool
          list, so it cannot drift away from the nav's own labels. Three across
          rather than four: with six tools that is two even rows, and the wider
          column keeps each line to one line. */}
      <section
        aria-label="The tools"
        className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
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
      </section>

      <section className="mt-14">
        <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-muted">
          {GUARANTEES.map((item) => (
            <li key={item.text} className="flex items-center gap-2">
              <item.icon className="size-4 shrink-0 text-success" aria-hidden />
              {item.text}
            </li>
          ))}
        </ul>

        <p className="mt-6 text-center text-sm">
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
