import type { Metadata } from "next";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { ToolEmblem } from "@/components/layout/tool-emblem";
import { VoidApp } from "@/components/void/void-app";
import { VOID_FEE_BPS } from "@/lib/utils/constants";

export const metadata: Metadata = {
  // Per page, and deliberately not in the root layout: metadata merges downwards,
  // so a canonical of "/" there would declare every page a duplicate of the home
  // page. It matters because the site answers on two hosts — the custom domain and
  // the *.vercel.app one — and a crawler finding both is free to choose either.
  alternates: { canonical: "/void" },
  title: "The Void — burn tokens, NFTs and cNFTs with no market",
  description: `Send unswappable Solana tokens into The Void — and unwanted NFTs and cNFTs with them. Burning a balance that has no route to SOL, USDC or JUP empties its account, and closing that account returns the rent it was holding. Non-custodial, with a ${(VOID_FEE_BPS / 100).toFixed(1)}% fee on reclaimed rent.`,
};

export default function VoidPage() {
  return (
    <Container size="narrow">
      {/* Same emblem-and-title header as every other tool page. The wrapper is
          this page's own spacing, since the header sits above a three-tab panel.

          This used to be a wordmark whose O *was* the void; that file is kept in
          the repo, unused, so the change is one line to undo. */}
      <div className="flex flex-col items-center">
        <PageHeader
          className="w-full pb-10 pt-16 sm:pt-20"
          emblem={<ToolEmblem tool="void" />}
          title="The Void"
          description="The Void is where the things a swap cannot help with go. Tokens with no route to SOL, USDC or JUP are burned for the rent locked in their accounts, and unwanted NFTs and cNFTs can be burned too — each with its own tab, its own rules, and nothing pre-selected. Swaps and Void sends never share a transaction."
        />
      </div>
      <VoidApp />
    </Container>
  );
}
