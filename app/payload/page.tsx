import type { Metadata } from "next";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { ToolEmblem } from "@/components/layout/tool-emblem";
import { PayloadApp } from "@/components/payload/payload-app";
import { PAYLOAD_RATE } from "@/lib/config/tools";

export const metadata: Metadata = {
  // Per page, and deliberately not in the root layout: metadata merges downwards,
  // so a canonical of "/" there would declare every page a duplicate of the home
  // page. It matters because the site answers on two hosts — the custom domain and
  // the *.vercel.app one — and a crawler finding both is free to choose either.
  alternates: { canonical: "/payload" },
  title: "Payload — batch send tokens and NFTs",
  description: `Send tokens and NFTs to one address in as few transactions as the size limit allows, reclaiming the rent the emptied accounts were holding. Verify the destination with a test transfer first. ${PAYLOAD_RATE} of reclaimed rent.`,
};

/**
 * Payload — batch sending.
 *
 * A send is the one flow here that cannot be undone, which decides how this page
 * is built rather than how it looks: the destination is its own step with its own
 * verification, the costs are stated before anything is signed, and a refusal is
 * always shown with its reason rather than dropped.
 */
export default function PayloadPage() {
  return (
    <Container size="narrow">
      <PageHeader
        emblem={<ToolEmblem tool="payload" />}
        title="Payload"
        description="Send tokens and NFTs to one address at once, and reclaim the rent that the accounts you empty were holding. Nothing is signed until you have seen what will happen, and nothing is built against an address you have not seen."
      />
      <PayloadApp />
    </Container>
  );
}
