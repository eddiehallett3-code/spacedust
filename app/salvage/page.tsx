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
  title: "Salvage — reclaim rent, wSOL and .sns names",
  description: `Retrieve rent from empty token accounts, refund the surplus rent held by Token-2022 accounts, unwrap wSOL, and close unused .sns names in Pro. ${RECLAIM_RATE} of reclaimed rent.`,
};

/**
 * Salvage.
 *
 * Basic mode is the routine recovery: empty token accounts, Token-2022 rent
 * refunds, wrapped SOL, and the diagnostic list of empty accounts the token
 * program will not let this wallet close. Pro adds only the irreversible SNS
 * name deletion.
 */
export default function SalvagePage() {
  return (
    <Container size="narrow">
      <PageHeader
        emblem={<ToolEmblem tool="salvage" />}
        title="Salvage"
        description="Retrieve rent from empty accounts, refund the surplus rent on Token-2022 accounts, unwrap wSOL, and close unused .sns names in Pro."
      />
      <SalvageApp />
    </Container>
  );
}
