import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { Prose } from "@/components/layout/prose";
import { LegalContact } from "@/components/legal/legal-contact";
import { LEGAL_ENTITY, LEGAL_UPDATED } from "@/lib/config/legal";

export const metadata: Metadata = {
  alternates: { canonical: "/refund-policy" },
  title: "Refund policy",
  description:
    "When Spacedust fees can be refunded, why network fees and on-chain transfers cannot be reversed, and how to raise a request.",
};

export default function RefundPolicyPage() {
  return (
    <Container size="narrow">
      <PageHeader
        title="Refund policy"
        description="What can be refunded, what cannot, and how to ask."
      />

      <Prose>
        <p>
          Last updated: <strong>{LEGAL_UPDATED}</strong>. This policy forms part
          of the <Link href="/terms">terms of service</Link> between you and{" "}
          {LEGAL_ENTITY}.
        </p>

        <h2>The short version</h2>
        <ul>
          <li>
            <strong>Blockchain transactions are final.</strong> A transfer, swap,
            burn, close or approval cannot be reversed by Spacedust.
          </li>
          <li>
            <strong>Network and priority fees are non-refundable.</strong> Solana
            charges them when a transaction is submitted, including a transaction
            that later fails.
          </li>
          <li>
            <strong>Spacedust&apos;s fee is only taken when the action completes
            and rent is reclaimed.</strong> We do not take a fee from the assets
            you send or swap.
          </li>
          <li>
            <strong>Wrong address, wrong amount or wrong token cannot be
            refunded.</strong> We cannot recover assets sent to an address you
            do not control.
          </li>
          <li>
            <strong>Your statutory rights are unaffected.</strong> Nothing here
            removes a right you have under mandatory consumer law.
          </li>
        </ul>

        <h2>Spacedust&apos;s fee</h2>
        <p>
          Spacedust charges 1.5% of rent reclaimed when a flow closes an empty
          token account. The fee is a SOL transfer taken from rent the network
          returns. It is shown before you sign. Swaps are not charged, partial
          sends that leave an account open are not charged, and actions that free
          no rent are not charged.
        </p>
        <p>
          If a Spacedust fee was charged but the action did not complete — for
          example, because of a bug in our planning or fee instruction — contact
          us with the transaction signature. We will investigate and, where the
          fee was taken in error, refund it in SOL to the wallet that paid it.
          This is a correction of our mistake, not a general right to reverse a
          completed transaction.
        </p>

        <h2>Network and priority fees</h2>
        <p>
          Network fees are set by Solana and paid to validators and the network,
          not to Spacedust. They are non-refundable once submitted, including
          when a transaction fails or is dropped. A priority fee is a bid for
          inclusion; it is not a guarantee that a transaction lands.
        </p>

        <h2>Assets, addresses and amounts</h2>
        <p>
          You are responsible for the address, token, NFT and amount in the
          preview. Once signed and confirmed, a transfer to the wrong address or
          an incorrect amount is irreversible. Spacedust cannot freeze, claw back
          or redirect it. If you are unsure, stop before signing and verify the
          address independently.
        </p>

        <h2>No card payments or chargebacks</h2>
        <p>
          Spacedust does not process card, bank or fiat payments. Fees are
          on-chain SOL transfers. There is no card chargeback process. A payment
          dispute should be raised with us first using the contact details below.
        </p>

        <h2>How to request a refund</h2>
        <p>
          Email us with all of the following so we can identify the transaction:
        </p>
        <ul>
          <li>the wallet address that paid;</li>
          <li>the transaction signature (Solscan link is fine);</li>
          <li>the date and the tool used;</li>
          <li>the fee amount you believe was charged in error;</li>
          <li>a short description of what happened.</li>
        </ul>
        <p>
          We aim to acknowledge requests within 10 business days. We may need to
          check the transaction on chain and with the relevant provider before
          deciding. Do not send a seed phrase or private key; we will never ask
          for one.
        </p>

        <h2>Consumer rights</h2>
        <p>
          If you are a consumer in the UK or EEA, mandatory consumer protection
          law may give you rights that cannot be excluded. This policy does not
          limit those rights. If you believe a charge is unfair or a service was
          not provided, contact us first so we can try to resolve it.
        </p>

        <h2>Contact</h2>
        <p>
          Refund and billing questions go to the contact below. Please include the
          transaction signature; without it we may not be able to identify the
          payment.
        </p>
        <LegalContact />
      </Prose>
    </Container>
  );
}
