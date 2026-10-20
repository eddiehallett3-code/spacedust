import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Globe, KeyRound, Lock, ShieldCheck, Wallet } from "lucide-react";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { ToolEmblem } from "@/components/layout/tool-emblem";
import { Prose } from "@/components/layout/prose";
import { ClearStoredData } from "@/components/security/clear-stored-data";
import { getSiteUrl } from "@/lib/config/site";
import { getTwitterHandle, getTwitterUrl } from "@/lib/config/social";

export const metadata: Metadata = {
  // Per page, and deliberately not in the root layout: metadata merges downwards,
  // so a canonical of "/" there would declare every page a duplicate of the home
  // page. It matters because the site answers on two hosts — the custom domain and
  // the *.vercel.app one — and a crawler finding both is free to choose either.
  alternates: { canonical: "/security" },
  title: "Security — what Spacedust can and cannot do with your funds",
  description:
    "How Spacedust protects your funds: it never holds your keys, every transaction is simulated and checked before you sign, and no API key reaches the browser.",
};

/**
 * The domain a visitor is told to check.
 *
 * Read from the same place the sitemap and the preview card get theirs, so a
 * deployment that changes domains cannot leave one sentence on the security page
 * telling people to bookmark the old one.
 */
const SITE_HOST = new URL(getSiteUrl()).host;

const GUARANTEES = [
  {
    icon: KeyRound,
    title: "No seed phrases. Ever.",
    body: "There is no field anywhere in Spacedust that accepts a private key or a seed phrase. Nothing to paste, and so nothing a scammer can talk you into handing over.",
  },
  {
    icon: Wallet,
    title: "Your wallet signs",
    body: "Signing happens inside Phantom, Solflare, Backpack or Jupiter. Spacedust cannot sign, cannot co-sign, and holds no key on any server.",
  },
  {
    icon: ShieldCheck,
    title: "Simulated before signing",
    body: "Every transaction is dry-run against the cluster first, and you see the result of that run. You are never asked to approve something already known to fail.",
  },
  {
    icon: Lock,
    title: "Every instruction is audited",
    body: "A simulation proves a transaction will not fail. It does not prove it only does what you asked — so the instructions are checked against the plan as well: every program must be one this flow uses, nothing may grant a delegation or change an authority, and your SOL may only go to the fee wallet. Anything that cannot be accounted for is refused before your wallet opens.",
  },
  {
    icon: Globe,
    title: "API keys stay server-side",
    body: "The Helius and Jupiter keys are read only by server routes. Your browser talks to this app's own endpoints, so no key is exposed in page source.",
  },
];

export default function SecurityPage() {
  // Both forms of the same account: the name for the sentence, the URL for the
  // link. Linking it is the point — the sentence tells a reader which account is
  // ours, and a claim like that should be one click away from being checked.
  const handle = getTwitterHandle();
  const profileUrl = getTwitterUrl();

  return (
    <Container size="narrow">
      <PageHeader
        emblem={<ToolEmblem tool="security" />}
        title="Security"
        description="What Spacedust can and cannot do with your funds, and what still depends on you."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {GUARANTEES.map((item) => (
          <div key={item.title} className="glass rounded-2xl p-4">
            <span className="flex size-8 items-center justify-center rounded-lg bg-success/12 text-success ring-1 ring-inset ring-success/25">
              <item.icon className="size-4" aria-hidden />
            </span>
            <p className="mt-3 text-sm font-medium">{item.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {item.body}
            </p>
          </div>
        ))}
      </div>

      <Prose className="mt-10">
        <h2>Protect yourself</h2>
        <p>
          The cards above are what the software does on its own. These are the
          things only you can do.
        </p>
        <ul>
          <li>
            <strong>Check the address bar.</strong> Bookmark <code>{SITE_HOST}</code>{" "}
            and reach the app from that bookmark. If you arrived from a link or an
            ad, read the domain before you connect anything.
          </li>
          <li>
            <strong>Refuse a prompt you do not understand.</strong> A wallet
            prompt should match what you asked the app to do. If it does not,
            reject it — closing a signature you did not want costs nothing.
          </li>
          <li>
            <strong>Read the preview before you sign.</strong> Spacedust shows the
            real simulation result for the exact bytes, along with the programs
            each transaction touches and what it costs. That is the moment to
            check the plan matches what you intended.
          </li>
          <li>
            <strong>Keep a little SOL.</strong> Fees are paid in SOL. At a zero
            balance a sweep cannot land, even when it would have been profitable.
          </li>
        </ul>

        <h2>What Spacedust does with your data</h2>
        <p>
          Your wallet address goes to this app&apos;s own server routes, so they
          can query Helius and Jupiter on your behalf, and to an RPC endpoint to
          simulate and submit. It is not stored, not sent to any tracking or
          analytics service, and never tied to an identity.
        </p>
        <p>
          The only things kept in your browser are a few preferences and a log,
          all in <code>localStorage</code>: your dust threshold, the output asset
          you chose, the smart-filter toggle, your past-sweep history, the
          site-wide tally those sweeps add to, the assets you have hidden, the
          addresses of lookup tables whose rent is still waiting to be reclaimed,
          and whether that rent should be reclaimed automatically. None of it
          leaves the device.
        </p>

        {/* The claim above, made actionable. A reader who wants to check that this
            app really only keeps what it says should not have to go to their
            browser's site settings to find out. */}
        <ClearStoredData />
        <p className="text-xs leading-relaxed text-muted">
          To disconnect the wallet and clear every store, including the
          WalletConnect session, use{" "}
          <Link href="/delete-data" className="text-violet-glow underline">
            Delete my data
          </Link>
          .
        </p>
        <p>
          The QR scanner decodes a code on the device with the camera and uploads
          nothing; the camera stops the moment the dialog closes.
        </p>

        <h2>Known limits, stated plainly</h2>
        <p>
          Routing is provided by Jupiter, and prices come from Jupiter and Helius.
          Spacedust cannot promise a swap will succeed, and the tokens it deals
          with are frequently worthless or deliberately hostile. A failed swap
          costs the network fee and nothing else — it cannot cost you the contents
          of your wallet.
        </p>
        <p>
          Some things are refused rather than attempted. A mint with a transfer
          hook is never swept, because a hook runs code on every transfer and this
          app does not sign instructions whose effects it cannot see. A liquid
          staking token, and a program-controlled mint that no market prices, are
          left out of the swap list rather than sold. A transfer-fee mint is
          swapped but skipped for rent reclaim, because the fee leaves a residue
          that would make the close fail. And if you swap only part of a balance,
          the account still holds the rest, so its rent is not reclaimed either.
        </p>

        <h2>If something looks wrong</h2>
        <p>
          Stop, and do not sign. Check the transaction on Solscan, compare it
          against what the app said it would do, then disconnect. Everything
          Spacedust builds can be inspected before you approve it: the programs
          each transaction touches, the simulation result, the transaction count,
          the size of each one and the compute it uses.
        </p>
      </Prose>

      <div className="mt-10 flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/6 p-4">
        <AlertTriangle className="mt-px size-5 shrink-0 text-warning" aria-hidden />
        <p className="text-sm leading-relaxed text-muted">
          <strong className="font-semibold text-foreground">
            Nobody legitimate will ever ask for your seed phrase.
          </strong>{" "}
          If something claiming to be Spacedust asks for it, it is not us. Close
          the page and do not continue.
          {handle && profileUrl ? (
            <>
              {" "}
              We only post from{" "}
              <a
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-medium text-violet-glow transition-colors hover:text-violet-core hover:underline"
              >
                {handle}
              </a>
              .
            </>
          ) : null}
        </p>
      </div>
    </Container>
  );
}