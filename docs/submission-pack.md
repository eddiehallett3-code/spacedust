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
| Icon 512 (opaque) | <https://spacedust.cc/dapp-icon-v6-512.png> — 80,495 B |
| Banner 1200×600 | <https://spacedust.cc/press/banner-1200x600.png> — 143,568 B |
| Screenshot — landing | <https://spacedust.cc/press/screenshot-1-landing.jpg> — 187,766 B |
| Screenshot — read-only scan | <https://spacedust.cc/press/screenshot-2-scan.jpg> — 126,349 B |
| Screenshots 3–8 | see [listing-assets.md](listing-assets.md) |


## Where to submit

| Where | Entry point | What it wants | Status |
|---|---|---|---|
| Solana ecosystem directory | <https://solana.com/ecosystem> — "Submit your project", usually in the directory's footer | Name, one-liner, category, logo, website, socials | Not submitted |
| DappRadar | <https://dappradar.com/submit> | dApp name, URL, chain, category, description, 512 logo. Free | Not submitted — 403 to curl, open it in a browser |
| AlternativeTo | <https://alternativeto.net> → "Add app" | Listed as an **alternative to Sol Incinerator**; licence, platforms, description, icon | Not submitted — 403 to curl, open in a browser |
| Reown / WalletConnect Explorer | <https://cloud.reown.com> — the project already exists, since `REOWN_PROJECT_ID` is set | Name, description, logo, chains | Not submitted |

AlternativeTo is worth doing first despite looking least like an app store: its
visitors arrive searching "alternative to Sol Incinerator", which is the most
qualified traffic any of these can send.

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
2. **Bing Webmaster Tools** — "Import from Search Console", which copies the
   verification and the sitemap in one step.
3. **Request indexing** for `/compare`, `/scan` and each tool page once the
   sitemap is accepted. A new page on a new domain otherwise takes days to weeks.

The sitemap is generated from `app/sitemap.ts`, so every tool route is already in
it and a new tool cannot be forgotten.

## Tracking

Fill this in as each goes out, so the follow-up dates are not a memory test.

| Where | Submitted | Outcome | Follow-up due |
|---|---|---|---|
| AlternativeTo | | | |
| Solana ecosystem directory | | | |
| DappRadar | | | |
| Reown / WalletConnect Explorer | | | |
| Search Console | | | — |
| Bing Webmaster | | | — |

