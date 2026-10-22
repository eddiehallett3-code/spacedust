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
  description: `Close token accounts that hold no balance, unwrap wrapped SOL and get the rent back. Pro also gives unused .sns names back and explains which accounts cannot be closed. ${RECLAIM_RATE} of reclaimed rent.`,
};

/**
 * Salvage.
 *
 * Basic mode is the routine recovery: empty token accounts and wrapped SOL,
 * both returning something the wallet already owns. Pro adds the irreversible
 * SNS name deletion and the diagnostic list of empty accounts the token program
 * will not let this wallet close.
 */
export default function SalvagePage() {
  return (
    <Container size="narrow">
      <PageHeader
        emblem={<ToolEmblem tool="salvage" />}
        title="Salvage"
        description="Basic closes empty token accounts, unwraps wrapped SOL and returns their rent. Pro gives unused .sns names back and shows which accounts cannot be closed."
      />
      <SalvageApp />
    </Container>
  );
}
