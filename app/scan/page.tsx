import type { Metadata } from "next";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { ToolJsonLd } from "@/components/seo/tool-json-ld";
import { ToolEmblem } from "@/components/layout/tool-emblem";
import { ReadOnlyScan } from "@/components/scanner/read-only-scan";

/**
 * Page metadata, and the one case where it has to depend on the query string.
 *
 * A shared scan link carries a wallet address (`?owner=`). Those URLs are the
 * site's best feature — the result is a link you can send someone — and they are
 * also the one kind of page here that must never enter a search index: it would
 * publish a stranger's wallet address and holdings in a result snippet. Keeping
 * them out of the index also removes the duplication noise, since every variant
 * otherwise canonicalises to `/scan` and Google reports them as alternates.
 *
 * The bare `/scan` page stays indexable. It is the tool's front door, it has real
 * copy, and it is what should rank for "solana wallet scan".
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string | string[] }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const hasOwner = typeof params.owner === "string" && params.owner.length > 0;

  return {
    // Per page, and deliberately not in the root layout: metadata merges
    // downwards, so a canonical of "/" there would declare every page a duplicate
    // of the home page. It matters because the site answers on two hosts — the
    // custom domain and the *.vercel.app one — and a crawler finding both is free
    // to choose either.
    alternates: { canonical: "/scan" },
    title: "Wallet Scan — read-only wallet lookup",
    description:
      "Paste any Solana address and see what can be reclaimed: token accounts, rent, wrapped SOL, approvals, .sns names and NFTs. No wallet, nothing signed.",
    ...(hasOwner ? { robots: { index: false, follow: true } } : {}),
  };
}

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
      <ToolJsonLd tool="scan" />
      <PageHeader
        emblem={<ToolEmblem tool="scan" />}
        title="Wallet Scan"
        description="See what a wallet holds and what can be reclaimed — empty-account rent, Token-2022 rent refunds, wrapped SOL and approvals. Read-only; nothing is signed."
      />
      <ReadOnlyScan initialOwner={owner} />
    </Container>
  );
}
