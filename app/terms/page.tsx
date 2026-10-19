import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { Prose } from "@/components/layout/prose";
import { LegalContact } from "@/components/legal/legal-contact";
import {
  LEGAL_ENTITY,
  LEGAL_JURISDICTION,
  LEGAL_UPDATED,
} from "@/lib/config/legal";

export const metadata: Metadata = {
  alternates: { canonical: "/terms" },
  title: "Terms of service",
  description:
    "The terms that apply when you use Spacedust, including fees, user responsibilities and liability.",
};

export default function TermsPage() {
  return (
    <Container size="narrow">
      <PageHeader
        title="Terms"
        description="The rules for using Spacedust, and the limits of what it can promise."
      />

      <Prose>
        <p>
          Last updated: <strong>{LEGAL_UPDATED}</strong>. These terms are between
          you and {LEGAL_ENTITY}, which operates Spacedust. By using the app you
          agree to them. If you do not agree, do not use the app.
        </p>

        <h2>1. What Spacedust is</h2>
        <p>
          Spacedust is a non-custodial interface for preparing Solana
          transactions: swapping dust, sending tokens, NFTs and SOL, burning
          unwanted assets, closing empty token accounts, revoking approvals and
          scanning public wallet data. It is not a wallet, exchange, broker,
          custodian, money transmitter, investment adviser or tax adviser.
        </p>
        <p>
          We never hold your private key or seed phrase, cannot sign for you, and
          do not control your wallet. Every transaction is signed inside your
          wallet. You are responsible for reviewing it before you approve it.
        </p>

        <h2>2. Eligibility</h2>
        <p>
          You must be at least 18 years old and legally able to enter into these
          terms. You must not be subject to sanctions or use the app from a
          jurisdiction where doing so would be unlawful. You are responsible for
          complying with the laws that apply to you.
        </p>

        <h2>3. Your responsibilities</h2>
        <ul>
          <li>
            <strong>Check every address and amount.</strong> Blockchain
            transactions are irreversible. A wrong address, wrong amount or wrong
            token cannot be reversed by Spacedust.
          </li>
          <li>
            <strong>Review before signing.</strong> The preview, simulation and
            instruction audit exist so you can see what will happen. Do not sign
            a transaction you do not understand.
          </li>
          <li>
            <strong>Protect your wallet and device.</strong> We cannot recover a
            wallet, seed phrase, password or signed transaction.
          </li>
          <li>
            <strong>Keep enough SOL.</strong> Network fees are paid in SOL and are
            charged by the network even when a transaction fails.
          </li>
          <li>
            <strong>Use only lawful assets and addresses.</strong> Do not use the
            app to move assets you do not own or have authority to move, or to
            evade sanctions, taxes or other legal obligations.
          </li>
        </ul>

        <h2>4. Fees</h2>
        <p>
          Spacedust charges one fee: <strong>1.5% of rent reclaimed when a flow
          closes an empty token account</strong>. It is taken from the rent the
          network returns, not from the assets you send or swap. Swaps are not
          charged. Partial sends and actions that free no rent do not incur the
          fee. The fee is shown before you sign.
        </p>
        <p>
          Solana network and priority fees are separate, are set by the network
          and validators, and are non-refundable once a transaction is submitted.
          Third-party providers may charge their own fees.
        </p>
        <p>
          Refunds are governed by our{" "}
          <Link href="/refund-policy">refund policy</Link>, which forms part of
          these terms.
        </p>

        <h2>5. Third-party services</h2>
        <p>
          Spacedust relies on third parties including Helius, Jupiter,
          Reown/WalletConnect, Solana RPC providers, Vercel, optional rate-limit
          infrastructure and token image hosts. Their availability, pricing,
          data handling and output are outside our control. A quote, route, scan,
          logo, price or transaction may be delayed, unavailable, incomplete or
          wrong because of a third party. Your use of a wallet app is governed by
          that wallet&apos;s terms and privacy policy.
        </p>

        <h2>6. No financial, legal or tax advice</h2>
        <p>
          Nothing in Spacedust is financial, investment, legal, accounting or tax
          advice. Token prices, rents, routes and USD figures are estimates or
          third-party data, not guarantees. You are responsible for your own
          decisions and for any tax reporting that applies to your transactions.
        </p>
        <h2>7. Prohibited uses</h2>
        <p>You must not use Spacedust to:</p>
        <ul>
          <li>violate any law, sanctions, tax obligation or court order;</li>
          <li>move assets you do not own or are not authorised to move;</li>
          <li>interfere with, probe, overload or attempt to bypass the app, its API routes, rate limits or security controls;</li>
          <li>introduce malware, scrape other users&apos; data, or attack the service or its providers;</li>
          <li>impersonate Spacedust or another person, or misrepresent an address as yours;</li>
          <li>use the app in a way that harms Spacedust, its providers or another person.</li>
        </ul>

        <h2>8. Intellectual property</h2>
        <p>
          The Spacedust name, interface, copy and original code are owned by{" "}
          {LEGAL_ENTITY} or its licensors. You may use the app for your own
          personal or business purposes, but you may not copy, resell, sublicense
          or present it as your own without permission. Open-source components
          remain under their own licences.
        </p>

        <h2>9. Availability and no warranty</h2>
        <p>
          The app is provided <strong>as is</strong> and <strong>as
          available</strong>. To the maximum extent permitted by law, we make no
          warranty that it will be uninterrupted, error-free, secure, compatible
          with every wallet, or that a transaction will succeed. Blockchain
          networks, RPC providers and wallets can fail independently of us.
        </p>
        <p>
          We may change, suspend or withdraw any part of the app, including a
          tool or a route, at any time. We do not guarantee that a particular
          token, NFT, wallet or transaction will be supported.
        </p>

        <h2>10. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, {LEGAL_ENTITY} is not liable for
          indirect, incidental, special, consequential or punitive loss, or for
          loss of profit, revenue, opportunity, data, goodwill, tokens, NFTs or
          expected rent, however caused, even if we were warned of the
          possibility.
        </p>
        <p>
          Our total liability arising out of or relating to the app or these terms
          is limited to the greater of (a) the Spacedust fees you paid to us in
          the 12 months before the event giving rise to the claim, or (b) £100.
        </p>
        <p>
          Nothing in these terms excludes or limits liability that cannot lawfully
          be excluded, including liability for fraud or fraudulent
          misrepresentation, death or personal injury caused by negligence, or
          your statutory consumer rights.
        </p>

        <h2>11. Indemnity</h2>
        <p>
          To the extent permitted by law, you agree to indemnify {LEGAL_ENTITY}{" "}
          against claims, losses, liabilities and reasonable costs arising from
          your unlawful use of the app, your breach of these terms, or a
          transaction you built or approved. This does not apply to the extent the
          claim is caused by our own negligence or breach.
        </p>

        <h2>12. Changes and termination</h2>
        <p>
          We may update these terms by posting a new version and date on this
          page. Continued use after the change means you accept the updated
          terms. We may suspend or refuse access if we believe the app is being
          used unlawfully, abusively or in a way that risks harm to others or to
          the service.
        </p>
        <p>
          You can stop using the app at any time.{" "}
          <Link href="/delete-data">Delete my data</Link> disconnects your wallet
          and clears local data. On-chain transactions remain public and cannot
          be deleted.
        </p>

        <h2>13. Governing law and disputes</h2>
        <p>
          These terms are governed by the laws of {LEGAL_JURISDICTION}, and the
          courts of {LEGAL_JURISDICTION} have exclusive jurisdiction, except that
          a consumer may bring a claim in the courts of their home country where
          mandatory consumer law allows it. Before starting a formal claim, please
          contact us so we can try to resolve the issue.
        </p>

        <h2>14. General</h2>
        <p>
          If any provision is unenforceable, the rest remains in effect. A failure
          to enforce a provision is not a waiver. You may not assign these terms
          without our consent; we may assign them with a successor service. These
          terms, the privacy policy and the refund policy are the entire agreement
          between you and us about the app.
        </p>

        <h2>15. Contact</h2>
        <p>
          Legal notices and questions about these terms should go to the contact
          below. Do not send a seed phrase or private key to any address or
          message channel.
        </p>
        <LegalContact />
      </Prose>
    </Container>
  );
}
