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
  title: "Salvage — reclaim rent, unwrap wSOL, release unused .sns names",
  description: `Close token accounts that hold no balance and get their rent back, or turn on Pro to unwrap wrapped SOL and give unused .sns names back. ${RECLAIM_RATE} of reclaimed rent.`,
};

/**
 * Salvage.
 *
 * Basic mode is the smallest tool here: nothing is priced, nothing is routed, and
 * the accounts hold no assets — only the rent-exempt deposit the network keeps
 * while an account exists. Pro adds the three jobs that deserve a deliberate
 * switch: unwrapping wSOL, deleting unused `.sns` names, and explaining which
 * empty accounts the token program will not let this wallet close.
 */
export default function SalvagePage() {
  return (
    <Container size="narrow">
      <PageHeader
        emblem={<ToolEmblem tool="salvage" />}
        title="Salvage"
        description="Basic closes empty token accounts and returns their rent. Pro also unwraps wSOL, gives unused .sns names back for their rent, and shows which accounts cannot be closed."
      />
      <SalvageApp />
    </Container>
  );
}
