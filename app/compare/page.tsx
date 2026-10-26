import type { Metadata } from "next";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { Prose } from "@/components/layout/prose";
import { RECLAIM_FEE_BPS } from "@/lib/utils/constants";

export const metadata: Metadata = {
  // Per page, like every other static route: a canonical in the layout would
  // declare this page a duplicate of the home page, and the site answers on two
  // hosts.
  alternates: { canonical: "/compare" },
  title: "Solana wallet cleaner comparison — Spacedust and Sol Incinerator",
  description:
    "A dated comparison of two Solana wallet cleaners: what each charges, what it will close, what it will not touch, and where one is ahead of the other.",
};

/**
 * The date every claim on this page was checked.
 *
 * A comparison page without one is undated marketing, and the reader cannot tell
 * whether it describes software from this month or from two years ago. A constant
 * rather than `new Date()` on purpose: the page must not claim to have been
 * re-verified because a request happened.
 */
const CHECKED = "26 October 2026";

const SPACEDUST_RATE = `${(RECLAIM_FEE_BPS / 100).toFixed(1)}%`;

type Cell = { verdict: "yes" | "no" | "unstated"; text: string };

const YES = (text: string): Cell => ({ verdict: "yes", text });
const NO = (text: string): Cell => ({ verdict: "no", text });
const UNSTATED = (text: string): Cell => ({ verdict: "unstated", text });


const ROWS: { label: string; spacedust: Cell; them: Cell }[] = [
  {
    label: "What it charges",
    spacedust: YES(
      `${SPACEDUST_RATE} of the rent it recovers, on closing, sending and refunds. Nothing on a swap.`,
    ),
    them: YES(
      "About 0.00004 SOL per standard account and 0.00007 SOL per Token-2022 account, taken from the rent reclaimed.",
    ),
  },
  {
    label: "Empty token accounts",
    spacedust: YES("Closed, SPL and Token-2022."),
    them: YES("Closed, SPL and Token-2022."),
  },
  {
    label: "Surplus rent on funded Token-2022 accounts",
    spacedust: YES(
      "Refunded without closing the account or touching its tokens.",
    ),
    them: YES("Refunded the same way, per their FAQ."),
  },
  {
    label: "Batch-swapping leftover tokens",
    spacedust: YES(
      "Jupiter routing, packed into as few transactions as the 1,232-byte limit allows.",
    ),
    them: YES("Swaps through Jupiter, listed among their tools."),
  },
  {
    label: "Burning tokens, NFTs and domains",
    spacedust: YES(
      "In Pro mode only; the default mode cannot destroy anything.",
    ),
    them: YES(
      "In Pro mode only; their Fun mode closes empty accounts and nothing else.",
    ),
  },
  {
    label: "Paying the network fee when the wallet has none",
    spacedust: YES(
      "Advanced and repaid out of the rent the same transaction releases.",
    ),
    them: YES("Advanced on the same terms, per their FAQ."),
  },
  {
    label: "Revoking token approvals",
    spacedust: YES(
      "A tool of its own, listing every delegation on the wallet.",
    ),
    them: UNSTATED("Not described on their site."),
  },
  {
    label: "Scanning a wallet without connecting it",
    spacedust: YES("Any address, read-only, no wallet connection at all."),
    them: NO("The scan runs after connecting."),
  },
  {
    label: "Native Android handshake (Mobile Wallet Adapter)",
    spacedust: YES("Offered to Android browsers; the wallet opens and asks."),
    them: UNSTATED("WalletConnect is listed; MWA is not mentioned."),
  },
  {
    label: "Live since",
    spacedust: YES("2026."),
    them: YES("December 2021."),
  },
];

const CHECKS = [
  {
    title: "Does it ever ask for a seed phrase or private key?",
    body: "No legitimate cleaner needs one. Closing an account, swapping a token and revoking an approval are all transactions your wallet signs and the app cannot sign for you. A field asking for a key is the whole scam, whatever else the page says.",
  },
  {
    title: "Can you read the transaction before approving it?",
    body: "A cleaner that only shows a button is asking for trust. The programs involved, the accounts being closed, and where your SOL ends up should all be visible — in the app, or in the wallet's own preview.",
  },
  {
    title: "Is the fee charged on a number you can see?",
    body: "A percentage of the rent recovered is checkable against the amount you actually receive. A flat charge per account, stated in SOL, is checkable too. A fee that appears only as a smaller balance is not.",
  },
  {
    title: "Does it refuse anything?",
    body: "The reassuring answer is yes. A cleaner that closes any account offered to it will eventually close one holding a balance you wanted. Refusing to sell an unpriced mint, or to touch an account with a transfer hook, is a feature.",
  },
  {
    title: "What does a failed transaction cost?",
    body: "It should cost the network fee and nothing else. Anything that moves your tokens before the step that can fail is a design fault, not bad luck.",
  },
];

export default function ComparePage() {
  return (
    <Container size="narrow">
      <PageHeader
        title="Comparing wallet cleaners"
        description={`What Spacedust and Sol Incinerator each do, from their published documentation and ours. Checked ${CHECKED}.`}
      />

      <Prose>
        <p>
          Two cleaners with the same job and different instincts. Sol Incinerator
          has been closing empty token accounts since December 2021 and is the one
          most people meet first; Spacedust does the same work with a fee charged
          on what it recovers rather than per account, and puts a read-only scan
          in front of the connection rather than behind it.
        </p>
        <p>
          Everything below is taken from each project&rsquo;s own documentation on{" "}
          {CHECKED} — not from a test of their code, and not from a fee measured on
          chain. Where their site does not say, the table reads{" "}
          <em>not stated</em>: an absence of evidence, not a claim that the
          feature is missing.
        </p>
      </Prose>

      {/* A real table where there is room. Below `sm` the same rows stack,
          because a comparison that needs horizontal scrolling hides exactly the
          column it exists to show. */}
      <div className="mt-8 hidden overflow-x-auto rounded-2xl border border-border/60 sm:block">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">
            Feature comparison between Spacedust and Sol Incinerator, checked on{" "}
            {CHECKED}
          </caption>
          <thead>
            <tr className="border-b border-border/60 bg-white/3">
              <th
                scope="col"
                className="p-3 text-xs font-medium uppercase tracking-wide text-subtle"
              >
                &nbsp;
              </th>
              <th scope="col" className="p-3 font-medium text-foreground">
                Spacedust
              </th>
              <th scope="col" className="p-3 font-medium text-foreground">
                Sol Incinerator
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr
                key={row.label}
                className="border-b border-border/40 last:border-0"
              >
                <th
                  scope="row"
                  className="p-3 align-top text-xs font-medium text-foreground"
                >
                  {row.label}
                </th>
                {[row.spacedust, row.them].map((cell, index) => (
                  <td
                    key={index}
                    className="p-3 align-top text-xs leading-relaxed text-muted"
                  >
                    <Verdict cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-8 space-y-2 sm:hidden">
        {ROWS.map((row) => (
          <li key={row.label} className="glass rounded-xl p-3">
            <p className="text-xs font-medium text-foreground">{row.label}</p>
            <dl className="mt-2 space-y-1.5">
              {[
                { name: "Spacedust", cell: row.spacedust },
                { name: "Sol Incinerator", cell: row.them },
              ].map(({ name, cell }) => (
                <div key={name} className="flex items-start gap-2">
                  <dt className="w-[104px] shrink-0 pt-px text-[10px] uppercase tracking-wide text-subtle">
                    {name}
                  </dt>
                  <dd className="text-xs leading-relaxed text-muted">
                    <Verdict cell={cell} />
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      <Prose className="mt-10">
        <h2>Where they are ahead</h2>
        <p>
          Four and a half years of use is not a rounding error. Sol Incinerator has
          closed accounts for people since 2021, which means the awkward cases in
          this work — a mint that behaves oddly, an account that cannot be closed
          for a reason no document mentions — have been met by them already and are
          probably handled. Spacedust is new, and new software should be judged
          accordingly.
        </p>
        <p>
          They also list Ledger support, which we do not. Spacedust supports the
          wallets it names — Phantom, Solflare, Backpack, Jupiter, and anything that
          connects over WalletConnect. If you clean up from a hardware wallet, that
          difference decides it on its own.
        </p>

        <h2>How to judge any cleaner, including this one</h2>
        <p>
          These questions do not favour either product. They are the ones worth
          asking before approving a transaction that closes accounts on a wallet you
          care about.
        </p>
      </Prose>

      <ol className="mt-5 space-y-3">
        {CHECKS.map((check, index) => (
          <li key={check.title} className="glass rounded-2xl p-4">
            <p className="text-sm font-medium text-foreground">
              <span className="mr-2 text-violet-glow">{index + 1}.</span>
              {check.title}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{check.body}</p>
          </li>
        ))}
      </ol>

      <Prose className="mt-10">
        <h2>Sources</h2>
        <p>
          Sol Incinerator&rsquo;s figures and features come from{" "}
          <a
            href="https://sol-incinerator.com"
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-violet-glow underline"
          >
            sol-incinerator.com
          </a>
          , read on {CHECKED}. Spacedust&rsquo;s own claims are the ones its code
          charges from: the fee percentage here is imported from the constant the
          flows use, so a rate quoted on this page cannot drift away from the rate
          actually taken.
        </p>
        <p>
          If something here is wrong or out of date, say so and it gets corrected. A
          comparison that stays true only while nobody checks it is worth less than
          no comparison at all.
        </p>
      </Prose>

      <p className="mt-8 text-sm leading-relaxed text-muted">
        Want to see what your own wallet is carrying?{" "}
        <Link href="/scan" className="text-violet-glow underline">
          Scan any address read-only
        </Link>{" "}
        — it needs no wallet connection, and nothing is signed.
      </p>
    </Container>
  );
}


/** One verdict: the tick or dash, then the words. Shared by both layouts. */
function Verdict({ cell }: { cell: Cell }) {
  return (
    <span className="flex items-start gap-1.5">
      {cell.verdict === "yes" ? (
        <Check className="mt-px size-3.5 shrink-0 text-success" aria-hidden />
      ) : (
        <Minus
          className={
            cell.verdict === "no"
              ? "mt-px size-3.5 shrink-0 text-warning"
              : "mt-px size-3.5 shrink-0 text-subtle"
          }
          aria-hidden
        />
      )}
      <span>{cell.text}</span>
    </span>
  );
}

