import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { Prose } from "@/components/layout/prose";
import { LegalContact } from "@/components/legal/legal-contact";
import { LEGAL_ENTITY, LEGAL_UPDATED } from "@/lib/config/legal";
import { STORAGE_KEYS } from "@/lib/utils/constants";

export const metadata: Metadata = {
  alternates: { canonical: "/privacy" },
  title: "Privacy policy",
  description:
    "What Spacedust collects, which third-party services it uses, what stays in your browser, and how to delete it.",
};

/**
 * The privacy policy, written around what this app actually does.
 *
 * Three facts shape it and are stated plainly rather than buried: there is no
 * account and no email signup; the app never receives a private key or seed
 * phrase; and there is no analytics, advertising or session-replay SDK. The
 * remaining data is public wallet/transaction data needed to build and submit
 * transactions, plus ordinary hosting logs and an optional rate-limit counter.
 */
export default function PrivacyPage() {
  const storageKeys = Object.values(STORAGE_KEYS);

  return (
    <Container size="narrow">
      <PageHeader
        title="Privacy"
        description="What Spacedust collects, where it goes, and how to remove what is yours."
      />

      <Prose>
        <p>
          Last updated: <strong>{LEGAL_UPDATED}</strong>. This policy explains
          how {LEGAL_ENTITY} handles personal data when you use Spacedust.
        </p>

        <h2>Who we are</h2>
        <p>
          {LEGAL_ENTITY} operates Spacedust. For UK/EU data protection law, it is
          the controller of the limited personal data described here. Contact us
          about privacy or a data request using the details below.
        </p>
        <LegalContact />

        <h2>The short version</h2>
        <ul>
          <li>
            <strong>There is no Spacedust account.</strong> No signup, password,
            name, email address or payment card is collected to use the app.
          </li>
          <li>
            <strong>We never receive your private key or seed phrase.</strong>{" "}
            Signing happens inside your wallet.
          </li>
          <li>
            <strong>
              No analytics, advertising, session replay or tracking pixels.
            </strong>{" "}
            Reown/WalletConnect analytics is switched off.
          </li>
          <li>
            <strong>We do not sell personal data.</strong>
          </li>
          <li>
            Your wallet address and public transaction data go to the RPC,
            pricing and wallet-connection providers needed to operate the app.
          </li>
          <li>
            Preferences and history stay in your browser and can be deleted from{" "}
            <Link href="/delete-data">Delete my data</Link>.
          </li>
        </ul>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Wallet and public chain data.</strong> Your wallet address,
            token and NFT holdings, token-account addresses, balances and public
            transaction data. This is public on Solana; we read it through an RPC
            provider to scan your wallet and build transactions.
          </li>
          <li>
            <strong>Transaction details.</strong> The mints, amounts, recipients
            and instructions you choose, plus the signed transaction and its
            signature. These are needed to simulate, submit and confirm the
            action you asked for.
          </li>
          <li>
            <strong>Technical data.</strong> IP address, user agent, request path,
            timestamp and error information processed by our hosting and
            rate-limiting providers when you call the app or its API routes.
          </li>
          <li>
            <strong>Local browser data.</strong> Your dust threshold, preferred
            output asset, smart-filter setting, sweep history, hidden assets, the
            local sweep tally, pending lookup-table cleanup addresses, whether the
            interface is in Basic or Pro mode, and whether you dismissed the
            storage notice. This stays on your device.
          </li>
          <li>
            <strong>Support messages.</strong> If you email us, we receive your
            email address and whatever you include in the message.
          </li>
        </ul>
        <p>
          We do not knowingly collect your name, postal address, government ID,
          date of birth, bank details, card details, precise location, contacts,
          health data or biometric data. We do not ask for and cannot use your
          private key or seed phrase.
        </p>
        <h2>Why we use it, and our lawful bases</h2>
        <ul>
          <li>
            <strong>To provide the service you ask for</strong> — scanning,
            pricing, simulating and submitting transactions. UK/EU basis:
            performance of a contract or steps at your request.
          </li>
          <li>
            <strong>To keep the service secure and available</strong> — abuse
            prevention, rate limiting, debugging and protecting our providers&apos;
            API credits. Basis: our legitimate interests in a secure, functioning
            service.
          </li>
          <li>
            <strong>To comply with law</strong> — responding to valid legal
            requests and keeping records where required. Basis: legal obligation.
          </li>
          <li>
            <strong>To answer you</strong> — responding to a support or privacy
            message. Basis: your request and our legitimate interest in support.
          </li>
        </ul>

        <h2>Who we share it with</h2>
        <p>
          We use the following third-party services. They receive only what is
          needed for the stated purpose; we do not sell data or give it to
          advertisers. Wallet addresses and blockchain transactions are public.
        </p>
        <ul>
          <li>
            <strong>Helius</strong> — Solana RPC and DAS indexing. Receives your
            wallet address, token/NFT account data and transaction data through
            our server routes, so we can scan holdings and read the chain. If
            Helius is not configured, the app uses a public Solana RPC instead.
          </li>
          <li>
            <strong>Jupiter</strong> — price, quote and swap-build APIs. Receives
            the mints, amounts and wallet address (taker) needed to quote and
            build a route, through our server routes. Token metadata and logos
            may be fetched from Jupiter&apos;s CDN.
          </li>
          <li>
            <strong>Reown / WalletConnect</strong> — wallet connection and relay.
            When you choose WalletConnect, connection metadata, your wallet
            address and session data pass through its relay. AppKit analytics is
            disabled. Without a project id, this route is not used.
          </li>
          <li>
            <strong>Vercel</strong> — hosting, CDN and serverless functions.
            Processes request logs, IP address, user agent, timestamps and error
            data as our hosting processor. Vercel Analytics is not installed.
          </li>
          <li>
            <strong>Upstash / Vercel KV (optional)</strong> — shared rate-limit
            counters. If configured, stores a counter keyed by your IP address
            and route for 60 seconds. It does not store the request body or
            wallet address. If not configured, the in-memory limiter is used.
          </li>
          <li>
            <strong>Solana RPC providers</strong> — Helius or the public Solana
            RPC endpoint. Receives the wallet/transaction data needed to read the
            chain and submit transactions.
          </li>
          <li>
            <strong>Token image hosts</strong> — when a token logo is shown, your
            browser requests the image from a third-party host (for example
            Jupiter CDN, Arweave, IPFS gateways, CloudFront, GitHub, CoinGecko or
            Trust Wallet). Those hosts receive ordinary request data such as your
            IP address and user agent. Images are requested with no referrer; we
            do not control those hosts&apos; logs.
          </li>
          <li>
            <strong>Your wallet app</strong> — Phantom, Solflare, Backpack,
            Jupiter or another wallet handles signing and its own data. Its
            privacy policy applies to that interaction; we never receive your
            keys.
          </li>
          <li>
            <strong>Solscan</strong> — only when you click a transaction link. It
            receives the request when you open it; we do not send data to it.
          </li>
          <li>
            <strong>X and GitHub</strong> — only when you click a footer link.
            Those sites receive the request when you open them; we do not send
            data to them.
          </li>
        </ul>
        <p>
          We do not use analytics, advertising, session-replay, email-marketing,
          payment-processing or customer-data platforms. No payment card details
          are collected: Spacedust&apos;s fee is an on-chain SOL transfer.
        </p>
        <h2>Cookies and browser storage</h2>
        <p>
          We do not use advertising cookies, analytics cookies, tracking pixels
          or session-replay tools. Spacedust uses <strong>strictly necessary
          browser storage</strong> to remember preferences, keep a local sweep
          history and keep a wallet connection alive. That storage stays on your
          device and is not sent to us as a profile.
        </p>
        <p>The app&apos;s own storage keys are:</p>
        <ul>
          {storageKeys.map((key) => (
            <li key={key}>
              <code>{key}</code>
            </li>
          ))}
        </ul>
        <p>
          If you choose WalletConnect, Reown/AppKit may store its own session and
          key material in <code>localStorage</code> or IndexedDB under its own
          keys; that is necessary for the connection to work. We do not set
          advertising or analytics cookies, and Reown analytics is disabled.
        </p>
        <p>
          A small notice appears on the site explaining this. It can be dismissed,
          and it is not a consent gate because there are no optional trackers to
          consent to. If optional analytics is added later, this policy and the
          notice must be updated to ask for consent first.
        </p>

        <h2>Retention and deletion</h2>
        <ul>
          <li>
            <strong>Browser data</strong> stays until you clear it, either with{" "}
            <Link href="/delete-data">Delete my data</Link> or your browser&apos;s
            site settings.
          </li>
          <li>
            <strong>Rate-limit counters</strong>, if the shared store is enabled,
            expire after 60 seconds.
          </li>
          <li>
            <strong>Hosting and error logs</strong> are kept by Vercel for the
            period in its configuration and then deleted or aggregated. We do not
            maintain a separate analytics database.
          </li>
          <li>
            <strong>Support emails</strong> are kept only as long as needed to
            answer the request and meet legal obligations.
          </li>
          <li>
            <strong>On-chain data</strong> is public and permanent. No one can
            delete a transaction or wallet address from Solana.
          </li>
        </ul>
        <p>
          There is no Spacedust account to delete. The deletion flow disconnects
          your wallet and clears this site&apos;s local storage, session storage,
          cookies, caches and IndexedDB databases on that browser. For a request
          about server logs or a support message, use the contact details above
          and we will respond within the period required by law.
        </p>

        <h2>Your rights</h2>
        <p>
          If you are in the UK or EEA, you have the right to access, correct,
          delete or restrict processing of your personal data, to object to
          processing based on legitimate interests, to data portability where it
          applies, and to withdraw consent where processing is based on consent.
          You also have the right to complain to a supervisory authority — the
          Information Commissioner&apos;s Office in the UK, or your local
          authority in the EEA.
        </p>
        <p>
          Because the app has no account, most data is either public chain data
          (which cannot be deleted) or local data you can erase yourself. Use{" "}
          <Link href="/delete-data">Delete my data</Link> for the local data, and
          contact us for anything held in support or logs.
        </p>

        <h2>International transfers</h2>
        <p>
          Some providers are in the United States or other countries outside the
          UK/EEA. Where required, transfers rely on appropriate safeguards such as
          the UK International Data Transfer Addendum, the EU Standard Contractual
          Clauses, or an applicable adequacy decision. Contact us if you want
          more information about the safeguard used for a particular provider.
        </p>

        <h2>Security</h2>
        <p>
          Spacedust is non-custodial: it never asks for, receives or stores a
          private key or seed phrase. Transactions are simulated and audited
          before you sign, and API keys stay on server routes. No system is
          perfect; you are responsible for your wallet, device and the addresses
          you enter.
        </p>

        <h2>Children</h2>
        <p>
          Spacedust is not intended for anyone under 18. We do not knowingly
          collect data from children.
        </p>

        <h2>Changes</h2>
        <p>
          We may update this policy when the app or the law changes. The date at
          the top is the version date. Material changes will be shown on this
          page; continued use after an update means you accept the updated
          policy.
        </p>

        <h2>Contact</h2>
        <p>
          For privacy or legal requests, use the contact details at the top of
          this page. If a detail is missing, do not assume an address: ask us and
          we will confirm the correct channel.
        </p>
      </Prose>
    </Container>
  );
}
