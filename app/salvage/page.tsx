import type { Metadata } from "next";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { ToolEmblem } from "@/components/layout/tool-emblem";
import { SalvageApp } from "@/components/salvage/salvage-app";
import { RECLAIM_RATE } from "@/lib/config/tools";

export const metadata: Metadata = {
  // Per page, and deliberately not in the root layout: metadata merges downwards,
  // so a canonical of "/" there would declare every page a duplicate of the home
  // page. It matters because the site answers on two hosts — the custom domain and
  // the *.vercel.app one — and a crawler finding both is free to choose either.
  alternates: { canonical: "/salvage" },
  title: "Salvage — reclaim the rent locked in empty token accounts",
  description: `Close token accounts that hold no balance and get the rent each one was holding back. ${RECLAIM_RATE} of what comes back.`,
};

/**
 * Salvage.
 *
 * The smallest tool here: nothing is priced, nothing is routed, and the accounts
 * hold no assets — only the rent-exempt deposit the network keeps while an
 * account exists. One job, so the page says one thing.
 */
export default function SalvagePage() {
  return (
    <Container size="narrow">
      <PageHeader
        emblem={<ToolEmblem tool="salvage" />}
        title="Salvage"
        description="Every token account you have emptied still holds a rent deposit, and the network keeps it until the account is closed. Salvage finds those accounts and closes them, returning the deposit to your wallet."
      />
      <SalvageApp />
    </Container>
  );
}
