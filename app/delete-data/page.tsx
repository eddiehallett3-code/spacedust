import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { Prose } from "@/components/layout/prose";
import { DeleteData } from "@/components/legal/delete-data";
import { LEGAL_EMAIL } from "@/lib/config/legal";

export const metadata: Metadata = {
  alternates: { canonical: "/delete-data" },
  title: "Delete my data",
  description:
    "Disconnect your wallet and delete the local data Spacedust keeps in this browser.",
};

export default function DeleteDataPage() {
  return (
    <Container size="narrow">
      <PageHeader
        title="Delete my data"
        description="There is no Spacedust account. This removes the local data and wallet connection."
      />

      <Prose>
        <p>
          Spacedust is non-custodial and has no signup, password or server-side
          user account. It cannot hold a balance and it never receives a private
          key or seed phrase. The data it keeps is in your browser: preferences,
          sweep history, hidden assets, the local tally, pending lookup-table
          cleanup addresses, the notice flag, and the wallet-connection session
          stored by Reown/WalletConnect.
        </p>
        <p>
          The button below disconnects the wallet and clears those stores for this
          site. It also clears cookies, caches and IndexedDB for this origin. It
          cannot delete public blockchain data or data held by your wallet
          provider.
        </p>

        <DeleteData contactEmail={LEGAL_EMAIL} />

        <h2>What cannot be deleted</h2>
        <p>
          Solana transactions and wallet addresses are public and permanent.
          Deleting local data does not remove them from the blockchain, and
          Spacedust cannot do that for you. If you have sent us a support email,
          use the contact on the <Link href="/privacy">privacy page</Link> to ask
          for that message to be removed.
        </p>

        <h2>Need a copy first?</h2>
        <p>
          If you want a copy of the local data before deleting it, use your
          browser&apos;s developer tools to export this site&apos;s storage. The
          app does not provide a server-side export because it does not hold a
          server-side profile.
        </p>
      </Prose>
    </Container>
  );
}
