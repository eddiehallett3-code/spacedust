# Submission pack

Everything a directory asks for, in one place, so the product is described the
same way in every listing. The same rule as the dApp metadata in
`lib/config/site.ts`: one spelling of the description rather than a fresh
paragraph per form, because a directory that describes Spacedust differently from
the wallet handshake is describing a second product.

Absolute links throughout, since most forms fetch the image rather than accept an
upload. Every URL below was checked on **26 October 2026** and returned HTTP 200.

Two of these sentences are load-bearing and appear elsewhere in the codebase: the
one-liner is the shape of `DAPP_DESCRIPTION` in `lib/config/site.ts`, which the
wallet handshake and the manifest both use. If that constant changes, change this
page with it — a listing that describes the product differently from the wallet
prompt is describing a second product.

## The copy, in four lengths

**One line** (fits a 100-character field):

> Non-custodial Solana wallet tools: batch swap and send, reclaim rent, revoke
> approvals.

**Short, 260 characters** (the limit on some directory fields — AlternativeTo
among them; this one is 211):

> Non-custodial Solana wallet cleaner: batch-swap dusty tokens, batch-send or
> burn the rest, reclaim rent from empty accounts, revoke stale approvals, scan
> any address read-only. 1.5% of rent returned; swaps free.

**Short** (~55 words):

> Spacedust cleans up a Solana wallet. It swaps leftover tokens into SOL or USDC
> in as few transactions as the 1,232-byte limit allows, sends or burns what has
> no market, batch-sends to one address, closes empty accounts to reclaim their
> rent, revokes stale approvals, and scans any address read-only before you
> connect anything.

**Standard** (~110 words):

> Spacedust is a non-custodial toolkit for maintaining a Solana wallet. Slingshot
> batch-swaps leftover tokens through Jupiter, packing as many as the 1,232-byte
> transaction limit allows. The Void sends or burns tokens, NFTs and cNFTs that
> have no market left. Payload batch-sends SOL, tokens, NFTs and cNFTs to one
> address, checking the destination before anything moves. Salvage closes empty
> SPL and Token-2022 accounts to reclaim their rent, refunds surplus rent, and
> unwraps wSOL. Approvals lists every delegation on the wallet so it can be
> revoked. Wallet Scan looks up any address read-only, with no wallet connection
> at all. Every transaction is simulated and its instructions audited before your
> wallet is asked to sign. 1.5% of the rent recovered; swaps are free. No key ever
> leaves your wallet.

**Long** (~200 words) — for a directory with a description field that scrolls:

> Spacedust is a set of non-custodial tools for keeping a Solana wallet in order.
> Dust accumulates: a few thousand tokens worth almost nothing, empty token
> accounts still holding their rent deposit, approvals granted years ago to
> programs nobody remembers. Spacedust deals with all three.
>
> Slingshot batch-swaps leftovers into SOL, USDC or JUP, packing as many swaps
> into a transaction as the 1,232-byte limit allows — so a wallet with forty dusty
> tokens takes a handful of approvals, not forty. The Void sends or burns tokens,
> NFTs and cNFTs that have no market left, and returns the rent. Payload
> batch-sends SOL, tokens, NFTs and cNFTs to one address, checking the destination
> before anything moves — the tool for moving a position to a new wallet rather
> than destroying it. Salvage closes empty SPL and Token-2022 accounts, refunds
> the surplus rent those accounts hold, and unwraps wSOL. Approvals shows every
> delegation on the wallet so you can revoke it. Wallet Scan reads any address
> without a connection.
>
> Every transaction is dry-run against the cluster, and its instructions are
> checked against the plan before your wallet opens, so the only thing you are
> ever asked to sign is something that can only do what you asked. Spacedust never
> holds your key. It charges 1.5% of the rent it returns — closing an account,
> refunding surplus, or sending one out — and nothing on swaps.

## Categories and tags

- **Category:** Wallet tools / Utilities. DappRadar and its like index a chain
  plus a category; pick *Tools* rather than *DeFi*, which implies a protocol with
  liquidity.
- **Chain:** Solana
- **Tags:** `solana`, `cryptocurrency`, `crypto`, `web3`, `blockchain`, `defi`,
  `wallet`. Secondary, only where a form wants more: `finance`, `crypto-wallet`,
  `productivity`.
- **Tags to avoid:** `bitcoin`, `ethereum`, `nft`. Off-chain-topic tags on a Solana
  tool read as keyword stuffing on a directory whose listings are community-edited,
  and that is what attracts a removal request rather than traffic.

On AlternativeTo specifically, take tags **from its autocomplete** rather than
typing them: a new tag containing one app is invisible, while an existing tag is a
browsable list. The first three above do the discovery work; the rest are
decoration.

## Assets

| Use | URL |
|---|---|
| Icon 512 (opaque) | <https://spacedust.cc/dapp-icon-v7-512.png> — 18,770 B |
| Banner 1200×600 | <https://spacedust.cc/press/banner-1200x600.png> — 143,568 B |
| Screenshot — landing | <https://spacedust.cc/press/screenshot-1-landing.jpg> — 187,766 B |
| Screenshot — read-only scan | <https://spacedust.cc/press/screenshot-2-scan.jpg> — 126,349 B |
| Screenshots 3–9 | see [listing-assets.md](listing-assets.md) |


## Where to submit

| Where | Entry point | What it wants | Status |
|---|---|---|---|
| Solana ecosystem directory | **Airtable form**: <https://airtable.com/appNiIyfQFaXNlv1U/pagM20DDyI1xImbzD/form> (guidelines linked) | Contact + founder details (private), project name, 300-word description, status, logo, up to 3 categories, website, socials | **Open — submit this one** |
| DappRadar | <https://dappradar.com/**submit-a-project**> | Client-rendered form; expect name, website, chain, category, description, logo | Not submitted |
| AlternativeTo | <https://alternativeto.net> → "Add app" | Listed as an **alternative to Sol Incinerator**; licence, platforms, description, icon | Not submitted — 403 to curl, open in a browser |
| Reown / WalletConnect Explorer | <https://cloud.reown.com> | — | **Not applicable** — the Explorer is the WalletGuide: an index of *wallets*, not dApps. See below |

AlternativeTo is worth doing first despite looking least like an app store: its
visitors arrive searching "alternative to Sol Incinerator", which is the most
qualified traffic any of these can send — **but that entry does not exist there.**
Checked 26 October 2026 against the site's own search, so the relation has to be
built before it can be used:

1. Search the spelling variants first (`incinerator`, `sol-incinerator`,
   `solincinerator`) — entries are created by users and are named inconsistently.
2. If it is genuinely absent, add it: name, `sol-incinerator.com`, Free,
   Online/Web, tags `solana cryptocurrency`. Write it neutrally and stop there.
   The comparison belongs on <https://spacedust.cc/compare>, which is dated and
   sourced; a directory entry written to knock a competitor is removed, and
   fairly.
3. Then set "Spacedust is an alternative to Sol Incinerator" on Spacedust's page.

Skipping the relation entirely is a legitimate choice: the `solana` and
`cryptocurrency` tags still place Spacedust in browsable lists, and `/compare`
does the head-to-head job better than a directory row can.

If a relation is wanted, search terms rather than names — the catalogue is
user-built, so a candidate has to be found before it can be attached:

- Same job: `incinerator`, `wallet cleaner`, `dust`, `burn tokens`, `sweep`,
  `solana tools`
- Batch sending (Payload): `multisender`, `bulk send`, `disperse`, `cointool`
- Swapping (Slingshot): `jupiter`, `swap aggregator`

Do **not** attach to wallets — Phantom, Solflare, Trust Wallet, Exodus. They are
different jobs, they exist, and "alternative to Trust Wallet" reads as spam to
moderators and searchers alike. Two accurate relations beat eight plausible ones;
relations are not fixed at submission, so one can be added whenever a counterpart
appears.

## Field-by-field answers

Most forms ask a version of these, and having them settled is what makes the
round quick rather than an afternoon:

- **Name:** Spacedust
- **Website:** <https://spacedust.cc>
- **Chain:** Solana
- **Licence:** source is public for reading and review, **all rights reserved** —
  not open source. Say "source available" if a form offers the choice; do not
  tick MIT or Apache.
- **Source:** <https://github.com/eddiehallett3-code/spacedust>
- **Contact:** support@spacedust.cc
- **Pricing:** select **Free** — no subscription, no sign-up, no upfront cost. The
  1.5% is taken out of rent the user recovers, not charged for access. Where a
  free-text price field exists: *Free to use. 1.5% of the rent recovered; no fee
  on swaps.*
- **Source code:** select **Source available**, not Open source and not
  Proprietary. `LICENSE` publishes the code for reading and review while
  reserving every other right, which is their definition of source available
  verbatim; "Proprietary" on those forms means the source is *not* published.
- **Source URL:** <https://github.com/eddiehallett3-code/spacedust> — verified
  public and reachable unauthenticated, which is what makes the answer above
  true. The licence on its own:
  <https://github.com/eddiehallett3-code/spacedust/blob/main/LICENSE>
- **License (a separate field, and a different question):** choose
  **Proprietary**, or **Other / Custom** where offered. A licence list classifies
  rights, and these rights are all reserved with a viewing permission — no OSI
  licence is granted. This is not a contradiction of "Source available": that
  field asks whether the code is published, this one asks what it is licensed
  under, and the answers are "yes" and "proprietary, with the source readable".
- **Wallets supported:** Phantom, Solflare, Backpack, Jupiter, and anything over
  WalletConnect
- **Platforms:** Web (any modern browser), Android via a wallet's own browser

## What not to claim

Three things a listing is tempted to add, none of them true today:

- **Open source.** The repository is public so the code can be read and reviewed,
  and `LICENSE` reserves every other right. "Source available" is accurate;
  "open source" is not, and a directory that repeats it becomes a claim nobody
  can stand behind.
- **Mobile Wallet Adapter on phones.** The row was shipped and reverted: on a real
  Android phone the handshake timed out. See
  [mobile-web-wallets.md](mobile-web-wallets.md).
- **An app-store listing.** No APK, so no dApp Store or Play presence.
- **An audit.** The transaction checks are real and documented, but nobody
  external has audited this code, and "audited" in a listing means the other
  thing.

### The Solana ecosystem directory: submit via Airtable

Recorded here first as "curated, no public route", which was wrong: scanning
`solana.com/ecosystem` for a form found none, because the form is not on that page.
It is an Airtable form, linked from the directory's submission guidelines.

- **Form:** <https://airtable.com/appNiIyfQFaXNlv1U/pagM20DDyI1xImbzD/form>
- **Guidelines:** <https://perfect-breath-c0a.notion.site/Project-Submission-Guidelines-3e251e11ff3b4732af32487f97d50e33>

Two eligibility rules decide whether it is worth submitting at all:

1. **On-chain activity is required** — "your project must produce some form of
   on-chain activity on the Solana Blockchain." Spacedust qualifies through the
   transactions its users sign: account closes, swaps, burns, sends. It has no
   contract of its own, and that is worth stating plainly in the description rather
   than leaving a reviewer to discover it.
2. **The category must come from their list:** Analytics, Art, CEX, DeFi, dePIN,
   Developer Tools, Digital Collectibles, Explorer, Gaming, Infrastructure, Mobile,
   Oracle, Payments, Privacy, Stablecoin, Wallet, DAO, Social.

The form, field by field:

| Field | Value |
|---|---|
| Full name, role, email | the owner's — private, not displayed |
| Telegram, X | the owner's |
| Primary founder + Twitter | private |
| **Project name** | Spacedust |
| **Description** | max 300 words — the Standard or Long copy above both fit |
| **Status** | Launched |
| **Logo** | `https://spacedust.cc/dapp-icon-v7-512.png` — PNG, which they accept |
| **Categories (up to 3)** | **Wallet**, then Infrastructure. Not DeFi, which implies a protocol with liquidity |
| Website | <https://spacedust.cc> |
| Twitter, Discord, Telegram | optional — leave blank rather than inventing handles |

### DappRadar: the form is at `/submit-a-project`

Worth writing down, because the obvious guesses are all wrong: `/submit` and
`/submit-dapp` are 404s, there is no submit link in the navigation or the footer,
and every page on that site answers 403 to a plain HTTP client. The path is in
their page sitemap — `https://dappradar.com/submit-a-project` — and the form is
client-rendered, so its fields appear only in a browser.

Two things learned while finding it, both of which correct an earlier assumption
in this document:

- **Tools are indexed.** Their category list includes `non-dapps-wallets`,
  `non-dapps-security` and `non-dapps-analytics`, and a listing lives at
  `/dapp/<slug>`. A wallet utility without its own contract does have somewhere to
  go; the "built for contracts" worry was wrong.
- **Many entries are discovered, not submitted.** Their homepage advertises
  "Newly Added — fresh listings across the ecosystem, discovered by the radar", so
  a missing listing is not proof nobody applied.

Expected category for Spacedust: a `non-dapps-*` category, wallets or services —
whichever the form offers closest to a wallet tool.

**The form renders empty — confirmed.** Checked on 26 October 2026 in a normal
browser by the site owner and through a JavaScript-executing reader: both showed
the title, navigation and footer and nothing between them. So it is not an
ad-blocker, a login state or a browser quirk — the page is broken or retired, and
the homepage's "Newly Added — discovered by the radar" line points at automatic
ingestion as the real intake.

Closed. Revisit only if someone reports the form working; the alternatives are
their Discord (<https://discord.gg/dappradar>) asking how a tool gets indexed, and
<https://dappradar.com/advertise> for commercial contact.

## Wallet dApp directories: what is actually possible

Checked against the vendors' own documentation on 26 October 2026, because a
generated summary of "developer entry points" is worth exactly as much as its
citations.

**Phantom — closed.** Phantom Portal is real (`phantom.app/portal`), and its docs
say plainly:

> "Phantom Portal is not accepting new applications at this time. New sign-ups for
> Phantom Connect SDK access and new app submissions to the Phantom app directory
> are paused. Existing Portal apps and App IDs are not affected."
> — <https://docs.phantom.com/phantom-portal/portal>

There is nothing to submit and no queue to join. Worth re-checking in a few
months; nothing else to do.

**Solflare — no documented route.** Their docs describe an "in-app browser for
connecting to Solana apps on mobile" and nothing about submitting one. The claim
that their directory is indexed from the Solana Ecosystem Directory appears
nowhere in their documentation. Their Discord
(<https://discord.com/invite/solflare>) is the only human channel.

**Jupiter — not applicable.** The Strict List is a *token* list: it exists so
holders do not see "unknown token" warnings. Spacedust issues no token, and its
swap routing already goes through Jupiter's API. Nothing to apply for.

**Backpack — xNFTs.** Unlike the others, Backpack runs apps natively as xNFTs
rather than cataloguing websites, so a plain web app has no entry there.

## Wallet outreach status

| Wallet | State | Next |
|---|---|---|
| Phantom | Portal submissions **paused** per their docs | Re-check in a few months; nothing else possible |
| Solflare | DM sent on X, 26 Oct 2026 | If no reply in 3–5 days, use <https://www.solflare.com/contact/> (a ticket with an owner) and/or their Discord |
| Jupiter | Strict List is tokens only | Nothing to apply for |
| Backpack | xNFTs, not web apps | Nothing; never applicable |

The ask, when a channel opens, is a question rather than a request: *who curates
the featured apps in the in-app browser, and what is the route in?* A named person
and a process is answerable; "please list us" is not.

The pattern is consistent with the web directories: the surfaces that accept
submissions are few, and the ones that matter are curated or paused. That makes
search the only channel without a gatekeeper, which is where this document puts
the effort — see "Search indexing" below.

## Platform support

A web app, so "which platforms" has two answers: where it runs, and where it has
been run. Only the second is evidence, and it is one row long.

| Platform | Works | Wallet route | Tested |
|---|---|---|---|
| Android phone | Yes — Chrome, Samsung Internet, Brave | Open in Phantom/Solflare/Backpack, or WalletConnect | Galaxy S24 FE, Android 16, Chrome |
| Android tablet | Yes | Same | No |
| iPhone | Yes — Safari, and Chrome (WebKit) | In-app browser links, or WalletConnect; no MWA on iOS at all | No |
| iPad | Yes | Same as iPhone; layout breaks at `sm`/`lg` | No |
| Windows | Yes — Chrome, Edge, Firefox | Extensions, or WalletConnect | No |
| macOS | Yes | Extensions, or WalletConnect | Desktop Chrome, plus mobile-viewport emulation |
| Linux | Yes — Chrome, Firefox | Extensions, or WalletConnect | No |
| Windows Phone | No | — | Dead platform: no browser there receives security updates |

Conditions that make "works" true anywhere: **HTTPS** (a wallet connection needs
`crypto.subtle`; localhost is exempt), and a modern engine. The floor is set by
`color-mix()` — 15 uses in `app/globals.css` — and by `dvh`, which together mean
**Chrome 111+, Safari 16.2+, Firefox 113+**: anything from early 2023 onwards.
An older browser gets a partially unstyled page rather than a broken one, but it
is not supported and has not been tested. WebGL matters only for the saucer: a
missing renderer drops the model by design rather than breaking the page.

**On a form, select Online / Web-based only.** Not Android and not iOS: there is no
native app, and those ticks claim a store presence that does not exist.

### The Reown Explorer indexes wallets, not dApps

Correcting an earlier entry in this document: the Reown / WalletConnect Explorer
is the **WalletGuide**, and its API says what it holds — `GET /v3/wallets`, with
filters for `platforms` (`ios`, `android`, `mac`, `injected`) and `sdks`
(`sign_v1`, `sign_v2`, `auth_v1`). Those are the properties of a wallet that
*receives* a connection.

Spacedust initiates connections. There is no entry to apply for, and the existing
`REOWN_PROJECT_ID` is a connection project, not a listing. Nothing to do here.

## AlternativeTo's feature checkboxes

AlternativeTo suggests a list of features and asks you to tick what applies. Ticked:
**Support for multiple currencies**, **Privacy focused**, **No registration
required**, **No Tracking**, **Ad-free**, **Dark Mode**.

Left clear, deliberately:

- **Crypto Exchange** — swaps route through Jupiter; this app holds no funds and
  runs no order book.
- **Decentralized** — their definition is "no single entity controlling it". The
  frontend, the server routes and the fee wallet are all one entity's, and
  *non-custodial* is not the same word as *decentralized*. This is the tick a
  community editor would reverse.
- **Currency Conversion** — their version means fiat conversion at exchange rates;
  a token swap is technically a conversion and practically a different tool.
- **End-to-End Encryption** — HTTPS is not E2E and there is no second party to
  encrypt between.

The privacy ticks are supportable because there is no analytics, advertising or
session-replay SDK in the dependency tree, and `app/privacy/page.tsx` states it —
including the hosting logs the claim does not cover. A directory claim that can be
checked against a privacy policy is worth more than one nobody can verify.

## Search indexing, the same day

Listings are gated; indexing is not. With `/compare` live and aimed at "solana
wallet cleaner comparison", this is the channel that compounds while the wallet
emails sit unanswered.

1. **Google Search Console** — add `spacedust.cc` as a *Domain* property, verify
   with the DNS TXT record it gives you, then submit
   <https://spacedust.cc/sitemap.xml>.
2. **Bing Webmaster Tools** — verified on 28 October 2026 with the XML file
   rather than "Import from Search Console", then submit the same sitemap URL.
   The file has to stay; see the note below.
3. **Request indexing** for `/compare`, `/scan` and each tool page once the
   sitemap is accepted. A new page on a new domain otherwise takes days to weeks.

The sitemap is generated from `app/sitemap.ts`, so every tool route is already in
it and a new tool cannot be forgotten.

The Bing verification, by contrast, *is* a file, and a permanent one.
`public/BingSiteAuth.xml` is served at the root of the site — 200,
`application/xml`, no redirect — and that is what Bing re-fetches to re-confirm
ownership. Deleting it after verification returns the property to unverified the
next time Bing looks, and nothing in the app would report that: indexing would
simply stop being attributed to a site nobody owns. It lives in `public/`
because that is the only directory whose contents are served as-is; the copy
Bing hands you is downloaded to the repository root, where nothing deploys it.

Pre-flight, checked on 26 October 2026 so the submission is not wasted:
`robots.txt` allows everything except `/api/` and names the sitemap; the sitemap
carries all twelve routes including `/compare`; `/compare` sends an absolute
canonical. Nothing to fix before submitting.

## Tracking

Fill this in as each goes out, so the follow-up dates are not a memory test.

| Where | Submitted | Outcome | Follow-up due |
|---|---|---|---|
| AlternativeTo | 26 Oct 2026 | Submitted; no comparable apps on the site, so no "alternative to" relation | — |
| Solana ecosystem directory | 26 Oct 2026 | Airtable form submitted: Wallet + Infrastructure, status Launched, 300-word description, flat-black v7 logo | Await review |
| DappRadar | — | Form page renders empty; closed | — |
| Reown / WalletConnect Explorer | — | Not applicable — indexes wallets, not dApps | — |
| Search Console | 26 Oct 2026 | Property added; sitemap submitted, showing "couldn't fetch" on first attempt | Re-check the "Last read" column in 24 h |
| Bing Webmaster | 28 Oct 2026 | Verified with the XML file at `/BingSiteAuth.xml` — served from `public/`, 200 with no redirect. The sitemap URL is the same one Search Console was given | Re-check the Sitemaps tab in 48 h |

