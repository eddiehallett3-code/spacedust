import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { ToolEmblem, type ToolKey } from "@/components/layout/tool-emblem";
import { Prose } from "@/components/layout/prose";
import { DISPLAY_FONT_STYLE } from "@/lib/ui/fonts";
import {
  PAYLOAD_RATE,
  RECLAIM_RATE,
  SLIPPAGE_RATE,
  TOOLS,
  VOID_RATE,
} from "@/lib/config/tools";

/**
 * The tools this page actually explains.
 *
 * All six today, but the index is still built from this list rather than from
 * every tool that exists: a link to a section that is not on the page is worse
 * than no link at all, so a seventh tool added without a deep dive here simply
 * does not appear.
 */
const DOCUMENTED: ToolKey[] = [
  "slingshot",
  "void",
  "payload",
  "salvage",
  "approvals",
  "scan",
];

export const metadata: Metadata = {
  // Per page, and deliberately not in the root layout: metadata merges downwards,
  // so a canonical of "/" there would declare every page a duplicate of the home
  // page. It matters because the site answers on two hosts — the custom domain and
  // the *.vercel.app one — and a crawler finding both is free to choose either.
  alternates: { canonical: "/how-it-works" },
  title: "How it works — what each tool does",
  description:
    "Exactly what each of the six tools does: how a sweep finds dust, sells part of a balance and packs twenty swaps into one transaction, how The Void takes the tokens, NFTs and cNFTs you no longer want, how a batch send proves its destination, how closing an empty account, refunding surplus rent and unwrapping wSOL really work, how approvals are read and revoked, and what the read-only scan counts and refuses.",
};

/**
 * One tool's deep dive: the mark that tool's own page carries, the name, a lede,
 * and the detail underneath.
 *
 * All six tools get the same shape, because this page previously explained one
 * of them at length and the rest in a sentence. The id doubles as the anchor the
 * overview cards and the jump links point at.
 */
function ToolSection({
  tool,
  name,
  lede,
  children,
}: {
  tool: ToolKey;
  name: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <section id={tool} className="scroll-mt-24 pt-14">
      <div className="flex items-center gap-3">
        <ToolEmblem tool={tool} />
        <h2
          style={DISPLAY_FONT_STYLE}
          className="text-xl font-semibold tracking-tight text-foreground"
        >
          {name}
        </h2>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{lede}</p>
      <Prose className="mt-6">{children}</Prose>
    </section>
  );
}

export default function HowItWorksPage() {
  return (
    <Container size="narrow">
      <PageHeader
        emblem={<ToolEmblem tool="how-it-works" />}
        title="How it works"
        description="Six tools with six different sets of rules, and one pipeline underneath all of them: read the chain, build the instructions locally, simulate, then ask your wallet to sign."
      />

      {/* An index into the six deep dives below, not a second overview. The
          boxes that used to sit here duplicated the landing page's job, and this
          page is long enough that finding one tool should not mean scrolling
          past five others. */}
      <nav aria-label="On this page" className="pb-10 text-center">
        <p className="text-xs uppercase tracking-[0.14em] text-subtle">
          On this page
        </p>
        <ul className="mx-auto mt-3 grid max-w-sm grid-cols-3 gap-x-4 gap-y-1.5 text-xs sm:max-w-md sm:text-sm">
          {TOOLS.filter((tool) => DOCUMENTED.includes(tool.key)).map((tool) => (
            <li key={tool.key} className="min-w-0">
              <a
                href={`#${tool.key}`}
                className="inline-block whitespace-nowrap text-violet-glow transition-colors hover:text-violet-core hover:underline"
              >
                {tool.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <ToolSection
        tool="slingshot"
        name="Slingshot"
        lede="The sweeper. It sells the tokens that still have a market — all of a balance, or the part you choose — closes the accounts those swaps empty, and picks up accounts that were already empty, in as few transactions as the size limit allows."
      >
        <h3>1. Finding your dust</h3>
        <p>
          Spacedust asks Helius&apos;s DAS API for every fungible token your
          wallet owns, using the <code>tokenType: &quot;fungible&quot;</code>{" "}
          filter. DAS indexes SPL Token <em>and</em> Token-2022 in the same
          response, so Token-2022 mints are covered without any special-casing.
        </p>
        <p>
          Prices come from Jupiter&apos;s Price API. It deliberately omits any
          token it cannot price reliably, which is a useful signal: a token with
          no price almost certainly has no liquidity to route through, so the
          Smart Filter hides it by default.
        </p>

        <h3>2. Why one signature can cover many swaps</h3>
        <p>
          Solana caps a transaction at 1232 bytes. Most dust swaps would each
          consume a whole signature on their own, which is miserable — twenty
          wallet prompts, twenty fees.
        </p>
        <p>
          Jupiter&apos;s <code>/build</code> endpoint returns{" "}
          <strong>raw instructions</strong> rather than a finished transaction.
          That is deliberate: it lets an integrator compose its own. Spacedust
          takes the instructions for every selected token and packs them into as
          few versioned transactions as will fit, measuring each candidate by
          actually serialising it — signature slots included, because the limit
          applies to the whole packet.
        </p>
        <p>
          How many packs into one depends on the routes: three dust tokens
          measured <strong>two transactions</strong> on mainnet. Every swap inside
          a transaction shares its signature, so a wallet that can approve a batch
          asks once for the lot — measured on Solflare and Backpack, where one
          approval signed two transactions. Phantom is the exception: its scanner
          rejects a batched approval, so it is asked once per transaction, and the
          app hands it one at a time rather than risk a rejection it cannot undo.
        </p>

        <h3>3. Reclaiming locked rent</h3>
        <p>
          Every SPL token account holds a rent deposit — measured at{" "}
          <strong>1,488,440 lamports (0.00148844 SOL)</strong> for an account
          created under the current schedule, about 0.002 SOL for one funded
          before the 2021 rent reduction, and a little more again for Token-2022
          with extensions — that cannot be withdrawn while the account exists. It
          is frequently worth more than the dust itself. The figure is read from
          the account being closed rather than taken from a constant, for the
          reason in section 4.
        </p>
        <p>
          After each swap, the source token account is empty, so Spacedust
          appends a <code>closeAccount</code> instruction and the rent returns to
          you. Two details matter here: the close is placed{" "}
          <em>after</em> the swap (the account is only empty once the swap has
          run) and it uses the token&apos;s own program, because a Token-2022
          account cannot be closed by the legacy Token program.
        </p>
        <p>
          Reclaimed rent is charged like every other flow here: {RECLAIM_RATE} of
          it, taken as a plain SOL transfer from the rent the close just
          returned. It is the same rate The Void and the rent-reclaim panel
          charge, because closing an empty account is the same kind of job
          wherever it happens — and the panel states it before you sign.
        </p>
        <p>
          Tokens with a Token-2022 transfer fee are skipped for rent reclaim,
          because the fee leaves a residue behind and the close would fail. The
          same goes for a token you chose to swap only part of: the account still
          holds the remainder, so it is left open and the row says so, rather
          than promising rent that cannot come back.
        </p>

        <h3>4. Rent left behind: the accounts a sweep cannot reach</h3>
        <p>
          A sweep closes the accounts its own swaps emptied, and nothing else.
          Sell the same token on a DEX, bridge it out, or move the balance away by
          hand, and the token account stays behind: empty, still holding its rent,
          and invisible — no balance means neither scanner lists it, and a sweep
          has no swap to attach a <code>closeAccount</code> to.
        </p>
        <p>
          Spacedust finds those accounts separately and closes them in one
          approval. Which ones can actually be closed is not obvious, so the rules
          were settled by building this exact instruction and simulating it
          against real mainnet accounts of every kind:
        </p>
        <ul>
          <li>
            An empty account closes, <strong>frozen or not</strong>. Freezing
            blocks a transfer, a Void send and a revoke — but not a close, which is
            the opposite of the rule that governs sending one.
          </li>
          <li>
            An empty account with a live <strong>delegate</strong> closes as well.
            A delegate is permission to transfer, and a close is not a transfer.
          </li>
          <li>
            An account another key holds a <strong>close authority</strong> over
            is refused: <code>Custom: 4</code>, &quot;owner does not match&quot;.
            Once that authority is set, the token program stops accepting the
            owner&apos;s signature for a close at all.
          </li>
          <li>
            A Token-2022 account holding <strong>withheld fees</strong> is
            refused: <code>Custom: 35</code>. The mint has to harvest them first,
            and only the mint&apos;s own authority can.
          </li>
        </ul>
        <p>
          Rent is read from each account&apos;s own balance rather than multiplied
          out of a constant, because deposits differ by generation and by program:
          an account created before the network&rsquo;s 2021 rent reduction holds
          about <strong>2,039,280</strong> lamports, one created since holds
          <strong>1,488,440</strong> — measured on 2026-10-25, both from the
          rent-exempt minimum for a 165-byte account and from the closes
          themselves — and a Token-2022 account with extensions holds more than
          either. A single constant would therefore misprice every close of the
          other generation, and the fee is a share of that price.
        </p>
        <p>
          Spacedust takes {RECLAIM_RATE} of the rent it returns — the same rate The
          Void charges, because closing an empty account is the same kind of job in
          both places. The only other cost is the network fee.
        </p>

        <h3>5. Simulation before signature</h3>
        <p>
          Every packed transaction is dry-run against the cluster before you are
          asked to approve anything. If a route has no liquidity, an account is
          frozen, or the rent maths does not work out, you find out{" "}
          <em>before</em> spending a signature or a fee.
        </p>
        <p>
          The preview you see comes from the same code path that will submit.
          There is no separate &quot;preview&quot; implementation that could
          drift from reality.
        </p>

        <h3>6. Your signature, your wallet</h3>
        <p>
          When multiple transactions are needed, wallets that support batch
          approval are asked once for the whole run. <strong>Phantom is the one
          exception</strong>: it is handed one transaction at a time, because its
          transaction scanner refuses a batched approval outright — the batch is
          reported as blocked or malicious even when it contains nothing but
          ordinary swaps. So a Phantom sweep asks you once per transaction instead
          of once for the batch. Signing always happens inside your wallet
          extension. Spacedust never has your key, has no seed phrase field, and
          cannot move funds on your behalf. Its own fee wallet is a separate,
          single-purpose key: it can only pay a network fee for a transaction you
          have already signed.
        </p>

        <h3>7. The only fee is {VOID_RATE} of the rent a flow returns, and it is always visible</h3>
        <p>
          A swap is not charged. The output of Slingshot is yours in full — the
          fee it used to take came out of the asset being swapped into, and it is
          gone. What remains is {VOID_RATE} of the rent any flow reclaims: Void
          sends, account closes, rent refunds, Payload sends. It is a plain SOL
          transfer taken <em>after</em> the close or refund has returned
          the rent, so it is always funded by the thing it is charged on and never
          touches the dust being recovered. It is shown before you sign anything.
        </p>
        <p>
          One distinction matters in practice: a full sweep usually closes the
          accounts its swaps emptied, and <em>that</em> rent is charged like any
          other close. Measured on a three-token sweep, 4,465,320 lamports of rent
          came back and 66,978 was charged — three closes at
          <code>floor(1,488,440 × 1.5%) = 22,326</code> each — while the swap
          proceeds themselves were untouched.
        </p>

        <h3>8. What can go wrong</h3>
        <p>
          Dust tokens are frequently worthless by design: airdropped to nobody,
          abandoned, or pumped and dumped. A token with no liquidity cannot be
          swapped at all, and some will still fail on-chain. Spacedust lists
          every skipped token and the reason, rather than quietly dropping them.
        </p>
        <p>
          A few holdings are refused rather than attempted, whatever their price:
          a liquid staking token such as mSOL, a program-controlled mint that no
          market prices at all, a frozen account, and a mint with a transfer hook.
          The first two are not dust — a staking position is something to unwind in
          the protocol that issued it, and a pool share is a claim with no market
          to sell into — so they are shown apart from the dust list with the
          protocol named where we know it.
        </p>
        <p>
          Tokens with no route are not dead ends. After your sweep, Spacedust
          offers to send them{" "}
          <Link href="/void" className="text-violet-glow hover:underline">
            into The Void
          </Link>{" "}
          instead: the balance is destroyed and the token account closed, so the
          rent that account was holding comes back to you. The Void never shares a
          transaction with a swap — sweeps run first, Void sends second, each with
          its own preview and its own signature.
        </p>
        <p>
          Swaps can also fail between preview and execution if the market moves.
          Slippage defaults to {SLIPPAGE_RATE}. Your tokens are never at risk — a
          failed swap simply does not land.
        </p>
      </ToolSection>

      <ToolSection
        tool="void"
        name="The Void"
        lede="Where the unsellable goes. It takes the things a swap cannot help with: a token with no route to any market, and unwanted NFTs and cNFTs. For a token, sending it into The Void is what empties the account, so the rent it was holding can come back — the asset itself does not."
      >
        <h3>1. Why The Void exists at all</h3>
        <p>
          A swap needs a route. A token nobody will route — no price, no
          liquidity, frequently airdropped to thousands of wallets at once —
          cannot be sold at any price, which is why the sweep refuses it. But the
          token account still holds rent that cannot be withdrawn while the
          account exists.
        </p>
        <p>
          Two instructions get it back: <code>Burn</code> to empty the account,
          then <code>CloseAccount</code> to return the deposit. Both are built
          locally — no Jupiter call, no server round-trip — but otherwise this is
          the sweep&apos;s pipeline: the same byte-exact packer, the same
          1232-byte measurement, the same simulate-before-you-sign gate.
        </p>
        <p>
          It is also where a sweep points when it finishes. If a sweep attempted a
          token and could not land it, Spacedust offers it to The Void — and only
          then. A token that <em>could</em> be sold is never nudged toward the
          void, because destroying something sellable is the one outcome this app
          exists to prevent.
        </p>

        <h3>2. Three tabs, because three kinds of holding are not one list</h3>
        <p>
          What a wallet cannot swap is not interchangeable, and merging it into a
          single list is precisely how an NFT ends up sitting next to a spam token
          looking equally sendable. So there are three:
        </p>
        <ul>
          <li>
            <strong>Tokens.</strong> Every fungible with a balance, flagged by
            whether a route exists. Unpriced ones are pre-selected, because a
            token nobody will route has no value to lose.
          </li>
          <li>
            <strong>NFTs.</strong> Every uncompressed NFT, with its artwork and
            collection. Opt-in, one tick at a time. One token-account rent comes
            back per send.
          </li>
          <li>
            <strong>cNFTs.</strong> Every compressed NFT. Opt-in, one tick at a
            time, and <strong>no rent comes back</strong> — a compressed NFT is a
            leaf in a merkle tree, not an account holding a deposit.
          </li>
        </ul>

        <h3>3. Nothing on an NFT tab is pre-selected</h3>
        <p>
          An unpriced fungible is a safe default to tick: no route means no value,
          so sending it costs you nothing you could have had.
        </p>
        <p>
          An NFT is the opposite. It has no price to read, and its value cannot be
          inferred from that absence — plenty of valuable NFTs have no active
          listings at all. So both NFT tabs open with nothing selected, and every
          tick is a deliberate one.
        </p>

        <h3>4. Refused, with the reason on the row</h3>
        <p>
          Anything Spacedust cannot build a <em>correct</em> send for is refused
          rather than guessed at, and the reason is shown on the row so nothing
          appears to vanish:
        </p>
        <ul>
          <li>
            An <strong>SPL NFT</strong> whose interface we do not recognise, or
            whose token account could not be located — a derived address is never
            substituted for one we failed to name.
          </li>
          <li>
            A <strong>frozen account</strong>. The token program permits neither{" "}
            <code>Burn</code> nor <code>CloseAccount</code> on one, and only the
            mint&apos;s freeze authority can thaw it. Spam is often airdropped
            frozen precisely so the holder can move neither the balance nor the
            rent underneath it.
          </li>
          <li>
            A <strong>pNFT</strong> that is locked by an escrow or listed for
            sale. Both leave the asset in your own wallet while only the delegate
            may move it, and Token Metadata refuses it.
          </li>
          <li>
            An asset <strong>delegated</strong> to another program — staking,
            escrow, or a listing that never moved the asset.
          </li>
          <li>
            A printed <strong>edition</strong> (token standard 5): sending one
            into The Void needs its master edition&apos;s accounts, which this
            build does not derive. Unlike the refusals above, that one is honestly
            unverified — no real print could be found to test it against.
          </li>
        </ul>
        <p>
          On the token tab a frozen account is refused <em>before</em> the send is
          built, and it is asked of the chain in one batched call rather than read
          from the scan, because the two scanners disagree about account state. An
          unknown answer counts as <strong>not</strong> frozen: the simulation is
          the backstop, and refusing something that is actually fine is the worse
          mistake.
        </p>
        <h3>5. Four routes, because there are four kinds of asset</h3>
        <ul>
          <li>
            <strong>SPL NFTs</strong> (<code>V1_NFT</code>,{" "}
            <code>LEGACY_NFT</code>) go through the token program:{" "}
            <code>Burn</code> the one unit, then <code>CloseAccount</code> to
            return the rent.
          </li>
          <li>
            <strong>Programmable NFTs</strong> go through Token Metadata&apos;s{" "}
            <code>burnV1</code>, because the asset carries a token record that the
            plain token-program route would leave behind. Rent comes back exactly
            as for an SPL NFT — a pNFT is an SPL token underneath.
          </li>
          <li>
            <strong>Core assets</strong> are a single account with no token
            account at all; the Core program closes the asset itself and returns
            the rent. The instruction comes from <code>mpl-core</code> through
            Metaplex&apos;s own adapter, so no discriminator is hand-encoded here.
          </li>
          <li>
            <strong>Compressed NFTs</strong> are leaves in a concurrent merkle
            tree. Bubblegum destroys the leaf and returns nothing. The proof that
            the leaf really is in the tree cannot be computed here — it needs
            every other leaf — so it is fetched from the indexer at plan time, and
            never carried over from the scan.
          </li>
        </ul>
        <p>
          The Metaplex packages are imported dynamically: a wallet that never
          sends a Core asset or a compressed NFT never downloads them.
        </p>

        <h3>6. Two things about sending Core and compressed assets</h3>
        <p>
          <strong>A Core send leaves a husk.</strong> Measured on mainnet: it does
          not close the asset account. It empties it and shrinks it to a single
          zero byte, which keeps 655,320 lamports of the rent and leaves behind an
          account that every index still describes with the old owner. So the rent
          figure subtracts that byte, and the scan drops any asset whose account is
          missing or husked — otherwise a sent NFT reappears in the grid and
          reads exactly like a send that never happened. That check has a trap in
          it, and it caught one: a compressed NFT&apos;s id is a merkle leaf, so no
          account exists there <em>ever</em>, and reading a missing account as
          &quot;destroyed&quot; deleted every live cNFT from the scan. The rule now
          only counts a death it can prove.
        </p>
        <p>
          <strong>A compressed send grows with its proof.</strong> Each proof node
          is one account, about 33 bytes: measured, 1052 bytes at 14 nodes, 1151 at
          17, and 1250 at 20 — against the same 1232-byte limit every transaction
          here lives under. A tree&apos;s proof is <code>depth − canopy</code>, so
          a canopy is what keeps it small; Metaplex&apos;s own recommended depth-20
          tree uses canopy 13, a 7-node proof, which fits with room to spare. Only
          a tree built with <em>no</em> canopy sends every level, and those are
          refused with the reason on the row rather than sent out to be rejected.
        </p>

        <h3>7. Why you will not see a floor price</h3>
        <p>
          A floor price helps when one exists and is actively misleading when it
          does not. Plenty of valuable NFTs have no active listings at all, so
          &quot;no floor found&quot; reads as &quot;worthless&quot; precisely when
          it means &quot;we could not see a market&quot;. In an app whose one
          promise is that it never destroys value on your behalf, a signal that can
          <em>cause</em> a bad send is worse than no signal at all.
        </p>
        <p>
          It would also be the most fragile dependency here: a third provider and
          key alongside Helius and Jupiter, marketplace terms, and per-collection
          rate limits on a path that already makes several calls.
        </p>

        <h3>8. What it costs, and what it never touches</h3>
        <p>
          The Void charges {VOID_RATE} of the rent it reclaims on a token sent
          into it, taken as a plain SOL transfer from the rent that was just
          returned to you. Nothing is charged on an NFT send: extending the fee to
          NFTs is a pricing decision, not an implementation detail, so it is not
          made silently.
        </p>
        <p>
          A Void send and a swap never share a transaction — separate selections,
          separate previews, separate signatures. A token The Void has claimed
          cannot also be swapped either: a token Jupiter refused to route has no
          business in a swap preview, and the swap that could have sold it does
          not exist.
        </p>
      </ToolSection>

      <ToolSection
        tool="payload"
        name="Payload"
        lede="The send tool. A sweep sells what you do not want and The Void takes what nobody wants at all — neither moves things you are keeping. Payload is for the third case: forty tokens and a handful of NFTs and cNFTs, all going to one address, in as few transactions as the chain will allow."
      >
        <h3>1. Why a batch send needs its own tool</h3>
        <p>
          Moving a wallet is not an edge case, it is one of the most common
          things anyone does with Solana — to a new wallet, to a hardware
          wallet, to someone else entirely. Done by hand it is one transaction
          per token, each with its own fee, its own approval prompt and its own
          chance to be pointed at the wrong address. The work here is not the
          transfer instruction: it is everything around it, and it is all
          mechanical, which is exactly the kind of work a tool should do.
        </p>

        <h3>2. The destination is settled before anything else is built</h3>
        <p>
          Every other flow on this site reads your wallet and nothing else. A
          send reads two, and gets the destination wrong only once. So the
          destination is settled first, and it has to be proved rather than
          assumed:
        </p>
        <ul>
          <li>
            <strong>A real transfer goes out first.</strong> A small SOL
            transfer, sent as an ordinary transaction and confirmed on chain. Not
            a lookup, not an account-existence check — an actual transfer that
            either lands or does not.
          </li>
          <li>
            <strong>The arrival is read back from the transaction.</strong> The
            confirmation is read off the chain and checked against what was
            intended, rather than trusting the local signature copy. A
            confirmation that does not match is a refusal, not a warning.
          </li>
          <li>
            <strong>Then it is locked.</strong> Once proved, the destination is
            fixed for the rest of the batch. No amount of clicking can change
            where the tokens are going afterwards, and drift in the address
            field is refused rather than silently absorbed.
          </li>
        </ul>
        <p>
          What this proves is narrow and worth being precise about: that the
          destination exists, is live, and is accepting transfers{" "}
          <em>right now</em>. It cannot tell you that a person is behind it. If
          you are sending somewhere you do not control, the test transfer and the
          arrival read are for you to check too.
        </p>

        <h3>3. One send is three instructions, not one</h3>
        <p>
          The thing people picture when they picture a send is a single{" "}
          <code>transfer</code>. What actually has to happen is:
          <strong> create the destination&rsquo;s account, transfer into it, then
          close yours.</strong> The middle step is the obvious one. The other two
          are why a batch is not simply a list of transfers:
        </p>
        <ul>
          <li>
            <strong>The account has to be created because it may not exist.</strong>{" "}
            A wallet that has never held this particular token has no account for
            it, and the transfer would fail outright. The instruction is
            mandatory in the batch even when the account is already there, so the
            batch works on both kinds of recipient without a second code path.
          </li>
          <li>
            <strong>Then closing your account is what makes the send pay for
            part of itself.</strong> Sending the balance and leaving the empty
            account behind would keep its rent locked up forever. Closing it
            returns your rent-exempt deposit in the same transaction, which is
            why the send flow refunds itself and a sweep does not have to.
          </li>
          <li>
            <strong>Both are paid for by the sender.</strong> The recipient&rsquo;s
            account deposit comes out of your balance. Sending is not free on
            either side, and the numbers below are why that matters.
          </li>
        </ul>

        <h3>4. How many sends fit in one transaction</h3>
        <p>
          The cost of a send is not the transfer, it is the account bookkeeping
          either side of it. Measured against real mainnet accounts, one{" "}
          <code>create + transfer + close</code> run is{" "}
          <strong>394 bytes and 15,243 CU</strong> and simulates clean — and the
          same holds for a real NFT. The breakdown is the part that decides how a
          batch is packed:
        </p>
        <ul>
          <li>
            <strong>Of those 394 bytes, the account create is 106.</strong> It
            cannot be skipped: without it the transfer fails at the destination
            with <code>InvalidAccountData</code>, which is a read that has to
            happen before the batch is built rather than a guess made while
            packing it.
          </li>
          <li>
            <strong>The close is 7 bytes.</strong> Reclaiming rent is never what
            makes a batch too big, so there is no reason to ever leave an empty
            account behind.
          </li>
          <li>
            <strong>Distinct destinations fit about eleven to a transaction:</strong>{" "}
            394 / 492 / 688 / 884 / 1,080 bytes at 1, 2, 4, 6 and 8 of them, which
            is what the packer sizes against rather than the 1,232-byte limit
            alone.
          </li>
          <li>
            <strong>Tokens and NFTs share the batch</strong> — one NFT plus six
            token sends measured 694 bytes, so a mixed wallet is not
            automatically two transactions just because it holds two kinds of
            thing.
          </li>
        </ul>
        <p>
          In practice: a forty-token wallet is four transactions, not forty. That
          is the entire point of the tool.
        </p>

        <h3>5. What it costs, and the case where sending costs more than it frees</h3>
        <p>
          A send moves value <em>and</em> rent, and not always in your favour.
          Closing your account returns its rent-exempt deposit; creating the
          recipient&rsquo;s account spends one. If the destination wallet has
          never held the token, you are paying a new deposit at the far end while
          reclaiming your own — and if the token is worth less than that deposit,
          the send is a net cost to you.
        </p>
        <p>
          Spacedust shows that as a figure rather than burying it, which is why
          rent is read per account and never from a constant. The constant this
          app used to hold said <strong>2,039,280 lamports</strong>; the deposit
          measured on a real account was{" "}
          <strong>1,488,440</strong> — a 37% overstatement that would have been
          displayed to you as money coming back, and charged a fee on. It was
          corrected, and the per-account read is what keeps it correct for both
          generations of account. The {PAYLOAD_RATE} fee is taken on what the
          close actually returns, priced per account rather than per transaction,
          so a batch of eleven is not charged eleven times over.
        </p>

        <h3>6. What Payload refuses to send</h3>
        <p>
          Every refusal is derived from something read off the chain, never
          assumed — and each one is listed on the row rather than silently
          dropped:
        </p>
        <ul>
          <li>
            <strong>Sending to your own wallet.</strong> Measured, not theorised:
            the transfer succeeds, the balance never leaves the account, and the
            close that would reclaim the rent fails with{" "}
            <code>Custom: 11</code> (NonNativeHasBalance). It is a hard rule with
            a test behind it.
          </li>
          <li>
            <strong>A frozen account, on either side.</strong> Your account or the
            destination&rsquo;s — only the mint&rsquo;s freeze authority can thaw
            it, so the send is refused rather than attempted.
          </li>
          <li>
            <strong>Mints with a transfer hook.</strong> A hook runs arbitrary
            code on every transfer, and Spacedust does not sign instructions whose
            effects it cannot see.
          </li>
          <li>
            <strong>Programmable NFTs.</strong> Token Metadata&rsquo;s transfer
            instruction is not built, so those assets are refused with that reason
            instead of being attempted badly.
          </li>
          <li>
            <strong>A compressed NFT the index could not describe.</strong> A leaf
            needs its tree, its index and its hashes — all from the indexer — plus
            a merkle proof fetched at plan time, because a proof only holds
            against the tree&rsquo;s current root. Missing either, the row says so.
            A cNFT has no account to close, so its row reclaims no rent: the leaf
            simply changes owner.
          </li>
        </ul>
      </ToolSection>

      <ToolSection
        tool="salvage"
        name="Salvage"
        lede="The rent reclaimer. It closes emptied token accounts, refunds the surplus rent held by Token-2022 accounts, unwraps wSOL, and diagnoses empty accounts the token program will not let you close."
      >
        <h3>1. An empty account still holds your SOL</h3>
        <p>
          A rent-exempt deposit is the minimum balance an account has to keep in
          order to exist on chain. When a token balance reaches zero the account
          is not deleted — it sits there holding that deposit and doing nothing,
          and no sale or transfer will ever release it. Only a close will, and
          only the account&rsquo;s owner can ask for one.
        </p>
        <p>
          They accumulate quietly. A sweep closes the accounts it empties, so a
          sweep leaves none behind; the ones Salvage finds were emptied somewhere
          else — a sale on another venue, a transfer made by hand, a
          minted-then-emptied airdrop account. Nothing is lost by closing one,
          because there is nothing in it. The deposit comes back to you.
        </p>

        <h3>2. Empty token accounts: the same close rules, measured</h3>
        <p>
          Closing accounts is not a new capability — a sweep already does it for
          every token it sells, and Salvage uses the same code path. The rules
          were settled by probing real mainnet accounts rather than reading the
          documentation, and they are full of things that are true only while an
          account has a balance:
        </p>
        <ul>
          <li>
            <strong>An empty frozen account closes normally.</strong> A frozen
            account with a balance cannot be emptied, which is where the
            usual &ldquo;a frozen account&rsquo;s rent is gone&rdquo; rule comes
            from. Once the balance is zero, that rule stops applying and the rent
            is real.
          </li>
          <li>
            <strong>A close authority takes the owner&rsquo;s rights away.</strong>{" "}
            Where one is set, the owner can sign and the program will still
            refuse: the authority for a close is <code>close_authority</code> when
            one exists and the owner only when none does. Those accounts are
            listed with that reason instead of being counted as recoverable.
          </li>
          <li>
            <strong>Rent is read per account, never from a constant.</strong>{" "}
            Legacy and Token-2022 accounts hold different deposits and extensions
            add more, so each account is priced from its own balance — the same
            rule that turned out to matter on a send.
          </li>
        </ul>

        <h3>3. Rent refund: the exception for a funded account</h3>
        <p>
          A Token-2022 account can hold more lamports than its own data size
          requires: an old deposit, a program credit, or a manual top-up.
          Token-2022&apos;s <code>WithdrawExcessLamports</code> hands back exactly
          that surplus — the lamports above the account&apos;s <em>current</em>{" "}
          rent-exempt reserve — and nothing else. The account is not closed, the
          token balance is not moved, and the reserve it needs to keep existing
          stays put. That is the one case where rent can come back from an
          account that still holds a balance, which is why the card calls it a
          refund rather than a cleanup.
        </p>
        <p>
          The check is per account. Its own data size sets the rent-exempt
          reserve, read from the chain at the moment of the plan rather than from
          a constant, and only the lamports above it count. A native wSOL account
          is excluded because its lamports are the wrapped balance, not spare
          rent; a zero-balance account is left to the close flow above, which
          returns the whole deposit. The card stays visible at zero so an empty
          result is still an answer.
        </p>

        <h3>4. What a reclaim costs</h3>
        <p>
          The fee is {RECLAIM_RATE} of the rent actually returned, charged per
          account after its close or refund has succeeded — never on
          an estimate, and never on an account that refused. It is summed from
          the per-account figures rather than taken as a percentage of the batch
          total, so one large legacy account and ten small Token-2022 ones are
          each charged on their own deposit, and a large batch does not round in
          anyone&rsquo;s favour by accident.
        </p>
        <p>
          The network fee is the other side of it. What this app asks for is small
          — the compute budget is sized to the work, so a close requests a few
          tens of thousands of compute units rather than a swap&rsquo;s 800,000 —
          but the wallet has the last word. Measured on identical three-token
          sweeps on 2026-10-25: Phantom and Backpack paid <strong>7,000
          lamports</strong> per transaction; Solflare added its own priority fee
          and paid <strong>87,000</strong>, twelve times as much, without the app
          asking for it. That is why the success screen now reports the fee the
          chain recorded rather than the fee this app estimated: the estimate was
          right about what we requested and wrong about what you paid.
        </p>
        <p>
          If the wallet cannot cover that fee, Spacedust advances it. A small fee
          wallet, held server-side and funded by hand, is the fee payer for that
          one transaction — and the same transaction pays it back out of the rent
          the close has just released. The repayment sits after the close,
          exactly like the fee above, because Solana takes its fee before any
          instruction runs and the rent is not available until afterwards.
        </p>
        <p>
          That key can do one thing. It is the fee payer and never appears in an
          instruction, it is offered only for flows that close an account and
          create nothing, and the server re-checks and simulates every transaction
          before adding its signature. If it cannot pay — out of SOL, or a refund
          too small to cover the advance — nothing is signed and the plan states
          the exact amount of SOL to send instead, from another wallet or an
          exchange.
        </p>

        <h3>5. Wrapped SOL and diagnostics are Basic; Pro adds only <code>.sns</code></h3>
        <p>
          Wrapped SOL is part of the basic flow. Closing a wSOL account is an
          unwrap, not a burn: the token program returns the wrapped balance and
          the rent to the owner, so there is no asset to give up. The wrapped-SOL
          card is shown even when it finds none.
        </p>
        <p>
          The list of empty accounts this wallet cannot close is also Basic. It
          is a read-only diagnostic, shown even when it finds nothing: a foreign
          close authority or withheld Token-2022 fee means no instruction this
          wallet can sign will work.
        </p>
        <p>
          The one Pro action is deleting an unused <code>.sns</code> name. Giving
          a name back to the open namespace cannot be undone with another
          transaction, so it deserves a deliberate switch. The deletion is
          previewed and simulated before a wallet is asked to sign.
        </p>
      </ToolSection>

      <ToolSection
        tool="approvals"
        name="Approvals"
        lede="The permission screen. A token account can grant someone else the right to move its balance without asking you again, and a grant does not expire. This finds them and clears them."
      >
        <h3>1. What a delegate is, and how you end up with one</h3>
        <p>
          An SPL token account carries an optional <code>delegate</code>: a third
          party permitted to transfer — or destroy — up to{" "}
          <code>delegatedAmount</code> from it, without another signature from you.
          Two everyday things create one:
        </p>
        <ul>
          <li>
            <strong>Listing an NFT.</strong> The marketplace takes a delegate on
            the asset, which is how it can move the NFT when a buyer appears while
            the NFT never leaves your wallet.
          </li>
          <li>
            <strong>Clicking approve</strong> in any dApp, including the ones you
            would rather not have approved. This is the reason the screen exists:
            an approval does not expire, so a permission granted once to a site
            that later turns hostile is still live years afterwards.
          </li>
        </ul>
        <p>
          The delegate lives on the token <em>account</em>, not the mint — so a
          revoke has to name that exact address, and the program that owns it. On
          a frozen account the delegate is still real and still live; the program
          simply will not clear it.
        </p>

        <h3>2. Reading the list is its own step, and it fails closed</h3>
        <p>
          The list <em>is</em> the decision, so it appears before anything is
          selected or prepared. And if the chain cannot be read, that is an error —
          never an empty list. &quot;No approvals found&quot; and &quot;we could
          not look&quot; are different answers, and only one of them is safe to
          show on a security screen.
        </p>
        <p>
          One thing is deliberately kept off it: a delegate that <em>is</em> the
          account&apos;s own owner. A permission from yourself grants nothing, and
          padding a security report with non-risks is its own kind of wrong.
        </p>

        <h3>3. What cannot be revoked</h3>
        <p>
          <code>Revoke</code> on a frozen account is rejected on chain:{" "}
          <code>Custom: 17</code>, &quot;Account is frozen&quot;. That was found by
          simulating against a real frozen delegated account rather than by
          reading documentation — the instruction is well-formed and the account
          exists, so nothing short of a real simulation surfaces it. Those rows
          stay listed, because the delegate really is live, but they cannot be
          selected: offering one would build a transaction that cannot succeed.
        </p>

        <h3>4. What it costs, and what it can break</h3>
        <p>
          Revoking recovers nothing — nothing is sold — so the screen says so
          rather than implying a win. It also cancels any open listing that relied
          on the delegate, which is worth knowing before you clear the delegate on
          an NFT you still intend to sell.
        </p>
        <p>
          A revoke costs about 250 compute units. The transaction asks for 200,000
          rather than the sweep&apos;s 800,000, because the priority fee is billed
          on the budget you <em>request</em>: the default would have charged
          roughly 1,500 lamports per transaction for headroom nobody needs, on an
          action that returns no value at all.
        </p>
      </ToolSection>

      <ToolSection
        tool="scan"
        name="Wallet Scan"
        lede="The look-before-you-connect screen. It answers one question about any address — no wallet, no connection, nothing signed: what could actually be reclaimed from this wallet?"
      >
        <h3>1. A result is a link</h3>
        <p>
          The address is a query parameter, so a result is a URL you can send on.
          That is the whole design, and everything else here follows from it: the
          page has to work with no wallet present, and it must never look like it
          is about to ask for a signature.
        </p>
        <p>
          It can be typed, or read from a QR code with the device&apos;s camera —
          a wallet&apos;s receive code, a Solana Pay request and an explorer link
          all resolve to the same address. Frames are decoded on the device and
          nothing is uploaded, and the camera stops the moment the dialog closes.
        </p>

        <h3>2. What the number counts</h3>
        <p>
          The dust value, plus rent that can genuinely be reached today: deposits
          in already-empty accounts and any lamports above a Token-2022 account&apos;s
          rent-exempt minimum. Two rules keep the figure honest:
        </p>
        <ul>
          <li>
            <strong>Rent is counted only when it can be reached.</strong> A frozen
            account&apos;s rent and value are not recoverable, and a transfer-fee
            account keeps a residue, so its value counts and its rent does not.
            An empty account&apos;s deposit and a Token-2022 account&apos;s surplus
            are the exceptions: both can be recovered without a sale or a burn.
          </li>
          <li>
            <strong>An unpriced token contributes no USD value.</strong> The Void
            can still burn it for the rent its account holds, but that rent is
            not counted in this scan until the account is closed.
          </li>
        </ul>
        <p>
          The scan also gives wrapped SOL and rent refunds their own windows, even
          when both are zero. wSOL principal is not part of the recoverable total
          because unwrapping returns SOL the wallet already owns; the window
          reports it and the account&apos;s rent separately.
        </p>

        <h3>3. What it leaves out, by name</h3>
        <p>
          Nothing is quietly dropped. Every holding the scan could not act on is
          counted under its own reason, and those reasons fall into three groups.
        </p>
        <p>
          Some are <strong>not dust at all</strong>: a staking token, named with
          the protocol that issued it, and a program-controlled mint that no market
          prices. Others <strong>cannot be moved</strong>: an account the
          mint&rsquo;s freeze authority has locked, and a mint whose transfer hook
          runs code on every transfer — refused rather than attempted, because this
          app does not sign instructions whose effects it cannot see. Some of
          these have the extension with no program behind it — those are listed
          above and can still be burned in The Void to reclaim their rent. The
          rest are
          holdings whose <strong>rent cannot come back</strong>: a Token-2022
          transfer fee leaves a residue, so the account can never be closed; a
          balance whose token account the scanner could not name gets no derived
          address substituted for it; an empty account another key holds a close
          authority over cannot be closed by you at all; and an empty Token-2022
          account still holding withheld fees has to wait for its mint to harvest
          them. A foreign close authority blocks a close, not a rent refund:
          Token-2022 surplus rent is still reachable when the owner can
          sign.
        </p>
        <p>
          The first two look similar and are opposites. A liquid staking token is
          an ordinary SPL token — nothing on the mint says what it is — so mSOL
          and its neighbours are matched against a registry of mints whose
          protocol was checked by hand, and an unlisted one gets the vaguer label
          rather than a guess. A pool share is a mint controlled by a program
          <em> and</em> priced by nobody. Shape alone decides neither: the mint
          authority of Pudgy Penguins sits in the project&apos;s own vault, which
          looks exactly like a pool position and is not one.
        </p>

        <h3>4. Why the arithmetic is a pure function</h3>
        <p>
          The total comes from <code>lib/sweep/recoverable.ts</code>, a pure
          function with no chain access — because it is a promise about a future
          transaction, and every number in it has to survive being checked later
          with a wallet connected. That is also how to check it: connect, reclaim,
          and compare the two figures. If they disagree, this one is wrong.
        </p>
      </ToolSection>

      {/* What all six have in common, stated once. Each tool above is
          deliberately different in its rules; the pipeline underneath them is
          not. */}
      <section className="pt-14">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Shared by all six
        </h2>
        <Prose className="mt-6">
          <ul>
            <li>
              <strong>Nothing is signed before you have seen it.</strong> A
              sweep, a Void send, a send, a reclaim, a revoke and a set of account
              closes all run the same pipeline: read the chain, build the
              instructions locally, pack them byte-exactly, simulate against the
              cluster, then ask your wallet to sign. There is no separate preview
              implementation that could drift from what ships.
            </li>
            <li>
              <strong>Every refusal is listed.</strong> No flow quietly drops
              anything — an unpriced token, a frozen account, a pNFT that is
              listed for sale and a tree with no canopy all appear with their
              reason. Silent dropping is the one behaviour this app does not have.
            </li>
            <li>
              <strong>Your wallet signs, and only your wallet can move your funds.</strong>{" "}
              Signing happens inside your wallet extension. There is no seed
              phrase field, and no code path from a server key to a signed
              transaction on your behalf. The one key Spacedust holds is a fee
              wallet: it can pay a network fee for a transaction you have already
              signed, is repaid from the rent in that same transaction, and can
              never appear in an instruction of its own.
            </li>
          </ul>
        </Prose>
      </section>
    </Container>
  );
}