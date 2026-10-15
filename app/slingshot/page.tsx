import type { Metadata } from "next";
import { Container } from "@/components/layout/container";
import { DustApp } from "@/components/dust-app";
import { Hero, SlingshotHighlights } from "@/components/layout/hero";
import { SetupNotice } from "@/components/setup-notice";
import { HowItWorksStrip } from "@/components/layout/how-it-works-strip";
import { SWAP_RATE, VOID_RATE } from "@/lib/config/tools";

export const metadata: Metadata = {
  // Per page, and deliberately not in the root layout: metadata merges downwards,
  // so a canonical of "/" there would declare every page a duplicate of the home
  // page. It matters because the site answers on two hosts — the custom domain and
  // the *.vercel.app one — and a crawler finding both is free to choose either.
  alternates: { canonical: "/slingshot" },
  title: "Slingshot — sweep dust into SOL, USDC or JUP",
  description: `Connect your Solana wallet, pick a USD threshold, and let Slingshot swap leftover token dust into SOL, USDC or JUP in as few transactions as possible. Non-custodial. ${SWAP_RATE} fee on swaps, ${VOID_RATE} on Void sends.`,
};

/**
 * Slingshot — the sweeper.
 *
 * This was the home page until the site got a landing page of its own. It moved
 * here rather than staying at a route that no longer describes it: `/` now
 * introduces all six tools, and this is one of them.
 *
 * The `#slingshot` anchor is kept so a link can still drop straight past the
 * hero into the app.
 */
export default function SlingshotPage() {
  return (
    <Container size="wide">
      <Hero />
      {/* Renders nothing at all once the API keys are working. */}
      <SetupNotice />
      <div id="slingshot" className="scroll-mt-24">
        <DustApp />
      </div>
      {/* Below the app on purpose: see `SlingshotHighlights`. */}
      <SlingshotHighlights />
      <HowItWorksStrip />
    </Container>
  );
}
