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
  title: "Salvage — reclaim rent from empty accounts and unused .sol domains",
  description: `Close token accounts that hold no balance and delete the .sol names you no longer use, returning the rent those accounts were holding. ${RECLAIM_RATE} of what comes back.`,
};

/**
 * Salvage.
 *
 * The smallest tool here in terms of decisions — nothing is priced, nothing is
 * routed, and the accounts hold no assets — but not the smallest in consequence:
 * one of its two jobs cannot be undone. The page is therefore plain about which is
 * which, rather than presenting both as "rent reclaim".
 */
export default function SalvagePage() {
  return (
    <Container size="narrow">
      <PageHeader
        emblem={<ToolEmblem tool="salvage" />}
        title="Salvage"
        description="Two kinds of thing hold rent you cannot otherwise reach: token accounts that have been emptied, and .sol names you no longer use. Closing an account and deleting a name are different decisions, so they are separate here — one tidies up, the other gives the name away."
      />
      <SalvageApp />
    </Container>
  );
}
