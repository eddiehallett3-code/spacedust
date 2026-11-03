import type { Metadata } from "next";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { ToolJsonLd } from "@/components/seo/tool-json-ld";
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
  description: `Reclaim rent from empty token accounts, refund surplus rent on Token-2022 accounts, unwrap wSOL and close unused .sns names. ${RECLAIM_RATE} of reclaimed rent.`,

};

/**
 * Salvage.
 *
 * Rent recovery for a wallet: empty token accounts, Token-2022 rent refunds,
 * wrapped SOL, the diagnostic list of empty accounts the token program will not
 * let this wallet close, and irreversible .sns name deletion. All of it is on
 * the page — there used to be a mode switch hiding the last of those, and it was
 * the only thing it hid.
 */
export default function SalvagePage() {
  return (
    <Container size="narrow">
      <ToolJsonLd tool="salvage" />
      <PageHeader
        emblem={<ToolEmblem tool="salvage" />}
        title="Salvage"
        description="Retrieve rent from empty accounts, refund the surplus rent on Token-2022 accounts, unwrap wSOL, and close unused .sns names."
      />
      <SalvageApp />
    </Container>
  );
}
