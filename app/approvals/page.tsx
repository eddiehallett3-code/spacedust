import type { Metadata } from "next";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { ToolEmblem } from "@/components/layout/tool-emblem";
import { ApprovalsPanel } from "@/components/security/approvals-panel";

export const metadata: Metadata = {
  // Per page, and deliberately not in the root layout: metadata merges downwards,
  // so a canonical of "/" there would declare every page a duplicate of the home
  // page. It matters because the site answers on two hosts — the custom domain and
  // the *.vercel.app one — and a crawler finding both is free to choose either.
  alternates: { canonical: "/approvals" },
  title: "Approvals — revoke stale delegations",
  description:
    "See every token account that has granted a delegate permission to move its balance — from NFT listings and old dApp approvals — and revoke them. Non-custodial: the transactions are built and simulated locally, and you sign them.",
};

/**
 * Approvals.
 *
 * A small page for a small, specific, high-anxiety job: finding out who can move
 * the tokens in a wallet, and taking that away. It gets its own route rather than
 * a tab in the sweeper because it is the one flow here that recovers no value —
 * nobody arrives at it by accident, they arrive because they are worried.
 */
export default function ApprovalsPage() {
  return (
    <Container size="narrow">
      <PageHeader
        emblem={<ToolEmblem tool="approvals" />}
        title="Approvals"
        description="A token account can grant someone else permission to move its balance without asking you again. Marketplaces take one when you list an NFT; dApps ask for one whenever you click approve. They do not expire. This finds them and clears them."
      />
      <ApprovalsPanel />
    </Container>
  );
}
