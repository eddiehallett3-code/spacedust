import type { Metadata } from "next";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { ToolEmblem } from "@/components/layout/tool-emblem";
import { ReadOnlyScan } from "@/components/scanner/read-only-scan";

export const metadata: Metadata = {
  // Per page, and deliberately not in the root layout: metadata merges downwards,
  // so a canonical of "/" there would declare every page a duplicate of the home
  // page. It matters because the site answers on two hosts — the custom domain and
  // the *.vercel.app one — and a crawler finding both is free to choose either.
  alternates: { canonical: "/scan" },
  title: "Wallet Scan — read-only wallet lookup",
  description:
    "Paste any Solana address and see what can be reclaimed: token accounts, empty-account rent, Token-2022 excess rent, wrapped SOL, standing approvals, .sns names, NFTs and the holdings a sweep would refuse. No wallet connection, nothing signed.",
};

/**
 * Read-only wallet lookup.
 *
 * The address is a query parameter rather than component state so a result is a
 * link someone can send. Everything else about this page is a consequence of
 * that: it has to work with no wallet present, and it must never look like it is
 * about to ask for a signature.
 */
export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string | string[] }>;
}) {
  const params = await searchParams;
  const owner = typeof params.owner === "string" ? params.owner : null;

  return (
    <Container size="narrow">
      <PageHeader
        emblem={<ToolEmblem tool="scan" />}
        title="Wallet Scan"
        description="See what a wallet holds and what can be reclaimed — empty-account rent, excess rent, wrapped SOL and approvals. Read-only; nothing is signed."
      />
      <ReadOnlyScan initialOwner={owner} />
    </Container>
  );
}
