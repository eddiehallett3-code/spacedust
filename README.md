# Spacedust

A non-custodial Solana dust sweeper, in two flows. **Slingshot** swaps what has a
market — any leftover token dust — into **SOL**, **USDC** or **JUP** in as few
transactions as possible, reclaiming the locked rent from every emptied token
account along the way. **The Void** burns what has none, and reclaims the rent
instead. Swaps and burns never share a transaction.

The name is the mechanism: a wallet's dust gets redirected rather than discarded,
the way a spacecraft borrows a planet's gravity and leaves on a different
heading.

**Slingshot is the flow; sweeping is what it does.** So the copy names the flow —
"Past slingshots", "3 slingshots complete" — while the verb and its outcome stay
as they were, because "12 tokens swept" is the thing that actually happened, and
"dust sweeper" stays the category in the page metadata.

**A 0.5% swap fee, kept in full.** Charged on the swap's *output* — inside the
Jupiter instruction, so it can never be skipped or redirected client-side — and
never on the dust being recovered. It is paid in the output asset into the
receiving wallet's **own** token account for that asset, `ATA(FEE_WALLET, mint)`,
derived rather than configured so it cannot drift out of step with the mint it is
paid in. There is no claim step and no third party's cut: Jupiter's Referral
Program charges the same fee but pays out the account's on-chain `share_bps` on
claim, keeping only part of it. `/api/health` reads each account back from chain
and names any that is missing, because Jupiter does not check, and a fee with
nowhere to land is a swap that fails for everyone. **1.5% of the rent that any flow
reclaims** is unchanged: a token burned in The Void, an empty account closed, a
Payload send that empties the account it came from, or a `.sol` name deleted.
Burning an NFT or a cNFT costs nothing. Revoking an approval and looking a wallet
up cost only the network fee.

Closing an already-empty account used to be free. It is now charged like the rest
of the rent-reclaiming flows — one price for the same job, wherever it happens —
and the panel that runs it says so before you sign, not after.

---

## What makes it different

Most dust sweepers take a cut. This one takes a visible 0.5%, from the swap's
output rather than the dust being recovered.

| | |
|---|---|
| **Slingshot** | The swap flow. Connect a wallet, pick a USD threshold, and it packs as many dust swaps into as few transactions as the 1232-byte limit allows. |
| **The Void** | The burn flow, for tokens with no market left. Named, for a reason — see below. |
| **Non-custodial** | Transactions are built in your browser and signed by *your* wallet. Spacedust has no keyring, no seed phrase field, and no ability to move funds. |
| **Fewest signatures** | Swaps are packed into as few versioned transactions as the 1232-byte limit allows — often clearing 10+ dust tokens in a single approval. |
| **Rent reclaim** | Emptied token accounts are closed in the same flow, returning ~0.00203928 SOL each. Frequently worth more than the dust itself. |
| **Simulated first** | Every transaction is dry-run against the cluster *before* you are asked to sign. |
| **Revoke approvals** | Finds token accounts where someone else still holds a delegate — from NFT listings and old dApp approvals — and clears them. |
| **Rent from empty accounts** | A token account with no balance still holds ~0.002 SOL, and nothing else in the app can reach it. Closing it returns that rent, with no swap and no burn — for 1.5% of what comes back. |
| **Check without connecting** | Paste any address and see what a sweep would recover from it. An address is a shareable link, and nothing is requested from you. |
| **Smart Filter** | Hides tokens with no liquidity, a Token-2022 transfer hook, or an excessive price impact — the ones that quietly fail or cost money. |
| **Token-2022** | Full support, including transfer-fee and transfer-hook detection. |
| **API keys stay server-side** | The browser never sees the Helius or Jupiter key. |

---

## Get your free keys (2 minutes)

**Recommendation: use Helius.** The free tier costs nothing, needs no card, and
DAS is meaningfully faster and more reliable than the bare public RPC — which
matters most on Vercel, where serverless IPs are shared and throttled. Upgrade to
a paid plan later only if you actually outgrow 50k credits/day.

### 1. Helius — free

1. Sign up at **https://helius.dev**
2. Create a project (free tier: ~50,000 credits/day).
3. Copy the **API key** from the dashboard.
4. Paste it into `.env.local`:

   ```
   HELIUS_API_KEY=your-key-here
   ```

### 2. Jupiter — free (optional but recommended)

1. Sign up at **https://portal.jup.ag**
2. Click **Get API Key** → choose the **Free** tier.
3. Paste it into `.env.local`:

   ```
   JUPITER_API_KEY=your-key-here
   ```

   Without it Spacedust still works — Jupiter allows keyless access — but you
   will hit rate limits during larger sweeps.

### 3. Restart and verify

```bash
npm run dev
```

Then open **http://localhost:3000**. The root is a landing page for the four
tools — **Slingshot lives at `/slingshot`**, and that is where the app itself is.
A "Setup check" panel appears there automatically if anything is missing or
wrong, and disappears once everything is green. You can also check from the
terminal:

```bash
curl localhost:3000/api/health | jq
```

It tests both keys with a **real upstream call**, so `"working": true` means
genuinely working, not merely present:

```json
{
  "helius": { "configured": true, "working": true,
              "detail": "DAS responded — found 3073 holdings via helius-das." },
  "jupiter": { "configured": true, "working": true,
               "detail": "Price API responding — SOL = $121.64 (authenticated)." }
}
```

> **Restart the dev server after editing `.env.local`.** Environment variables
> are read at startup, not per request — this catches almost every "my key isn't
> working" report.

### Running it

```bash
npm install
npm run dev
```

Open **http://localhost:3000**. Your `.env.local` is already created with the
placeholders filled in for you.

> **Never run `npm run build` while the dev server is running.** Both write to
> `.next`, so the two compilations interleave and the dev server ends up serving
> a module manifest that names ids from the other build. The browser reports it
> as `Cannot read properties of undefined (reading 'call')` from inside the
> webpack runtime — a stack that points at framework internals and says nothing
> about the cause. The fix is to stop the dev server, `rm -rf .next` and start
> again.
>
> To verify a production build *without* that risk, give it a directory of its
> own:
>
> ```bash
> NEXT_DIST_DIR=.next-verify npm run build
> NEXT_DIST_DIR=.next-verify npx next start -p 3100
> ```
>
> `distDir` in `next.config.ts` reads that variable, so the dev server's `.next`
> is never touched. (Editing `next.config.ts` restarts a running dev server — by
> design, but worth knowing before you assume it died.)


### Token data sources — both free, pick one

Spacedust supports two interchangeable backends. It picks Helius automatically
if a key is present, and falls back to core RPC if not. Both satisfy the same
interface, so nothing downstream changes.

| | **A. Core RPC** (default) | **B. Helius free tier** |
|---|---|---|
| Signup | none | free account, no card |
| Cost | $0 | $0 (~50k credits/day) |
| Scan speed | seconds | ~1s |
| Wallets with hundreds of tokens | slower | fast |
| Rate limits | public endpoint, **per IP** | much higher |
| Token metadata | Jupiter, priced tokens only | full, from the indexer |

**How Option A replaces Helius entirely:**

| Need | Helius DAS | Core RPC path |
|---|---|---|
| List holdings | one indexed call | `getTokenAccountsByOwner` × 2 programs |
| Balance + decimals | `amount` | `info.tokenAmount` (jsonParsed) |
| Which token program | mint lookup | which program returned the account |
| Token-2022 extensions | mint account | `info.extensions` on the token account |
| Name / symbol / logo | `content.metadata` | Jupiter `/tokens/v2/search` |
| USD price | Jupiter Price API | Jupiter Price API |

Two calls cover both token programs, because `getTokenAccountsByOwner` filters
by program id — so **Token-2022 support is not lost**.

**Honest trade-off:** the public endpoint rate-limits
`getTokenAccountsByOwner` per IP (~10 calls / 10s) and reports it as a JSON-RPC
error inside a `200` response. The free path therefore paces requests and
retries with backoff. Measured on a wallet with **3,073 token accounts**:
**~21s**. A normal dust wallet (tens of tokens) is a few seconds. On Vercel,
where serverless IPs are shared and heavily throttled, Option B is noticeably
more reliable.

If you want the free path but more headroom, point
`NEXT_PUBLIC_FALLBACK_RPC_URL` at a free-tier provider (QuickNode, Alchemy,
Chainstack) — the code does not care which one.

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `HELIUS_API_KEY` | No | Enables the faster DAS scanner. Blank = free core-RPC path. |
| `JUPITER_API_KEY` | No | Jupiter works keyless (~0.5 req/s). A free key at [portal.jup.ag](https://portal.jup.ag) removes rate-limit errors. |
| `NEXT_PUBLIC_FEE_WALLET` | No | Receiving wallet for the 1.5% fee on reclaimed rent (Void sends, empty-account closes, Payload sends, domain deletes). **Leave blank to charge nothing** — every rent fee path is skipped when unset. |
| `NEXT_PUBLIC_FALLBACK_RPC_URL` | No | RPC used when Helius is absent. |
| `NEXT_PUBLIC_SITE_URL` | No | The site's own origin. Feeds `metadataBase` (so the generated social-preview card resolves to an absolute URL) and `sitemap.xml`. Defaults to `https://spacedust.cc`. |
| `NEXT_PUBLIC_TWITTER_URL` | No | The X account. Drives the footer link (labelled with the derived `@handle`), the "we only post from …" line on `/security`, and the `twitter:site`/`creator` attribution on preview cards. A value that is not an `x.com`/`twitter.com` profile is ignored rather than linked. |
| `NEXT_PUBLIC_GITHUB_URL` | No | Footer "Source" link. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | No | Contact address in the footer's copyright row, as a mailto link. Omitted entirely when unset, or when the value does not contain an `@` — a link that silently does nothing is worse than no link. |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | No | Adds the "Jupiter Mobile" QR-login row. Free id from [dashboard.reown.com](https://dashboard.reown.com). The Jupiter *browser* extension needs nothing — it is detected automatically. |

> **Security:** only variables prefixed `NEXT_PUBLIC_` reach the browser.
> Never prefix an API key that way — it would be readable in page source.
> `lib/jupiter/server.ts`, `lib/helius/das.server.ts` and `lib/token-source/`
> are guarded by the `server-only` package, so importing them into a Client
> Component is a **build error**, not a runtime surprise.

---

## Deploying to Vercel

1. Push to a GitHub repository.
2. Import it at [vercel.com/new](https://vercel.com/new) — no configuration needed.
3. Add `HELIUS_API_KEY` (and optionally `JUPITER_API_KEY`,
   `NEXT_PUBLIC_FEE_WALLET`) under **Settings → Environment Variables**.
4. Deploy.

Vercel's Hobby plan is enough: six dynamic routes, one static, no database, no queue.

### Before you take traffic: the two steps the repo cannot do

The rate limiting in `lib/api/rate-limit.ts` is in-process, so it is **per serverless
instance**: it caps what one instance serves, not what the deployment serves. Every
route here spends a Helius or Jupiter key, and `/api/rpc` also submits transactions.
The two controls below live in dashboards, not in this repository, and they are the
ones that actually hold.

**1. Rate limit at the edge.** The shape is the same on any platform: one rule per
path, matched on client IP, action **429**. The numbers mirror `BUDGETS` in
`lib/api/rate-limit.ts` — deliberately, so the two layers agree; if you reprice one,
reprice both.

| Path | Limit | Window |
| --- | --- | --- |
| `/api/rpc` | 240 | 1 minute |
| `/api/plan` | 60 | 1 minute |
| `/api/tokens` | 30 | 1 minute |
| `/api/domains` | 30 | 1 minute |
| `/api/asset-proof` | 30 | 1 minute |
| `/api/health` | 12 | 1 minute |

- **Cloudflare (free plan):** *Security → WAF → Rate limiting rules* → **Create rule**.
  The free plan includes **one** rule and counts over **10-second** periods (the
  wider windows are paid), so the rule below covers the whole API rather than each
  path, and leaves the per-route numbers to `BUDGETS` above:

  | Field | Value |
  | --- | --- |
  | When incoming requests match | `http.request.uri.path contains "/api/"` |
  | With the same characteristics | IP address |
  | When rate exceeds | **40** requests per **10 seconds** |
  | Then take action | **Block** |

  40 per 10 seconds is the same ceiling as `/api/rpc`'s 240 per minute — the
  busiest budget in the table — so this rule cannot fire before the in-process
  limiter would, and it cannot throttle a client the app itself would have served.
  On a paid plan, replace it with one rule per path from the table, using 1-minute
  windows.

  The orange cloud matters: with the domain proxied, this rule also stops someone
  pointing their own domain at your deployment and spending your keys through it.

- **Vercel:** *Firewall → Rate limiting rules* (the rule editor is under Firewall).
  WAF rules are a paid-plan feature, so on Hobby either put Cloudflare in front as
  above, or accept the in-process limit as your only one.

Use **429, not a challenge or a JS challenge**: this app's clients are `fetch` and
web3.js, and neither can solve a CAPTCHA. A block would present to a user as an
unexplained failure.

**Verify it, rather than trusting it.** Test against `/api/rpc`, not `/api/health`:
`health`'s in-process budget is 12/min, so it would be throttled by the second
layer first and you would learn nothing about the first.

```bash
# 100 requests inside a few seconds, against a 40-per-10-seconds edge rule.
for i in $(seq 1 100); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST https://spacedust.cc/api/rpc \
    -H 'content-type: application/json' -d '{}'
done; echo
```

Non-200s partway through mean the edge rule is matching. If every one is a 400
(a malformed body, which the app rejects *after* the limiter) then no rate limiting
is in play at all.

**2. Alert on Helius spend.** In the Helius dashboard, set usage/spend notifications
for the account at roughly **50%** and **80%** of the plan's monthly credits. The
reason this sits on a launch checklist rather than a billing one: this app has no
monitoring *by design* — the security page promises no analytics — so a script
driving `getTokenAccountsByOwner` through `/api/rpc` is invisible until the credits
are gone or the key starts answering 429 to real users. An alert is the only signal
you get, and it is free.

If the plan offers a hard **spend cap**, set it too: a cap turns "we lost the
credits" into "the API is down", which is the failure you would rather have.

---

## Architecture

```
app/
├── layout.tsx              Root layout, fonts, providers, metadata
├── page.tsx                Home — the six tools in boxes, plus structured data
├── how-it-works/page.tsx   Long-form explanation
├── security/page.tsx       Security model
├── not-found.tsx           404 — branded, and lists every page
├── error.tsx               Per-route error boundary
├── global-error.tsx        Last resort: catches root-layout failures
├── robots.ts               Crawler rules, and the sitemap declaration
├── sitemap.ts              Every page, built from TOOLS
├── manifest.ts             Web app manifest, shortcuts from TOOLS
├── opengraph-image.tsx     The site's preview card
├── <tool>/page.tsx         slingshot · void · payload · salvage · approvals · scan
├── <tool>/opengraph-image.tsx  One preview card per tool, built from TOOLS
└── api/
    ├── tokens/route.ts     GET  — scan a wallet, return valued tokens
    ├── plan/route.ts       POST — build one Jupiter route per token
    ├── domains/route.ts    GET  — a wallet's .sol names; POST builds the deletes
    ├── asset-proof/route.ts POST — cNFT proofs, one DAS call per asset
    ├── rpc/route.ts        POST — allow-listed JSON-RPC proxy
    └── health/route.ts     GET  — setup diagnostics, one real call per provider

lib/
├── config/env.ts           Server-only env access
├── jupiter/server.ts       Price API v3 + Swap API v2 /build
├── helius/das.server.ts    DAS getAssetsByOwner + mint metadata
├── solana/
│   ├── connection.ts       Client RPC connection + ALT loading
│   ├── instructions.ts     Jupiter JSON → web3.js, with validation
│   ├── compose.ts          Order: setup → swap → closeAccount → cleanup
│   ├── pack.ts             Greedy first-fit packing under 1232 bytes
│   ├── simulate.ts         Pre-signature simulation + fee estimation
│   └── submit.ts           signAllTransactions + confirm
├── sweep/
│   ├── plan-sweep.ts       The whole planning pipeline
│   └── summary.ts          Post-sweep numbers
└── utils/                  format, sanitize, errors, api, base64
```

### Why everything goes through server routes

`HELIUS_API_KEY` and `JUPITER_API_KEY` are read **only** in Route Handlers.
The browser calls this app's own `/api/*` endpoints instead. That keeps the keys
out of the bundle, avoids CORS flakiness, and gives one place to enforce rate
limits.

`/api/rpc` forwards an **allow-list** of JSON-RPC methods
(`simulateTransaction`, `sendTransaction`, `getLatestBlockhash`, …). Without
that allow-list it would be an open RPC relay pointed at your Helius account.

### How the batching works

1. The server asks Jupiter `GET /swap/v2/build` once per selected token. This
   returns **raw instructions**, not a finished transaction — which is exactly
   what makes composition possible.
2. The client converts those instructions, then orders them:
   `setup → swap → closeAccount → cleanup`. The `closeAccount` must come
   *after* the swap (the account is only empty once the swap has run) and
   *before* cleanup.
3. Units are packed greedily. Each candidate is measured by **actually
   serialising** it with signature slots, because the 1232-byte cap applies to
   the whole packet — measuring the message alone under-reports by 64 bytes per
   signer.
4. `signAllTransactions` covers multiple transactions in one approval.
5. Fees are charged in two places, never hidden: 0.5% of a swap's output
   (applied by Jupiter *inside* the swap instruction, so it cannot be skipped or
   redirected client-side, and paid in the output asset into the fee wallet's own
   token account for it), and 1.5% of any rent reclaimed — a Void burn, an empty
   account closed, a Payload send that emptied its account, a `.sol` name deleted.
   The rent fee is a plain SOL transfer taken from the rent just returned to the
   user.

   A swap fee requires a token account the **fee wallet** owns in the output
   mint, and Jupiter does **not** check whether it exists — it will happily
   return a swap whose fee has nowhere to land. Spacedust therefore derives it as
   `ATA(NEXT_PUBLIC_FEE_WALLET, outputMint)`, verifies it on chain (that it exists
   *and* that it is not frozen), and simply omits the fee when it is unusable —
   so a misconfiguration can never break a sweep. It is deliberately not routed
   through Jupiter's Referral Program: a claim there keeps only the account's
   on-chain `share_bps`, so part of the fee would go to the project rather than to
   the wallet that configured it.

   **Setting it up** is three accounts, once:

   ```bash
   node scripts/create-fee-accounts.mjs --keypair ~/.config/solana/id.json          # dry run
   node scripts/create-fee-accounts.mjs --keypair ~/.config/solana/id.json --send   # create
   ```

   The accounts are owned by the fee wallet, but the keypair only *pays* and is the
   only signer — so any funded wallet works, and the fee wallet's private key is
   never needed. `/api/health` reports the same thing with the server running, and
   `probes/tmp-fee-wallet-ata-probe.mjs` reports it with nothing running at all.
   The failure mode is quiet by design: a missing account is not an error anywhere,
   it is simply a fee of zero, which is why something has to ask.
6. **The ~150-slot blockhash window is treated as the scarce resource it is.**
   Every transaction in a batch is signed under one blockhash, so anything slow
   before a send is window that send never gets. Two margins enforce that, and
   they are deliberately different sizes: the batch is **rebuilt before the
   wallet prompt** when fewer than ~75 slots (~30s) remain, because a person
   reading a Phantom prompt takes seconds, not milliseconds; and a send is
   **refused outright** inside ~30 slots (~12s) of expiry, because a transaction
   broadcast with a sliver of window left is accepted by the RPC, included by no
   leader, and silently dropped. Refusing early means "run the preview again and
   sign promptly" instead of a fee-bearing no-op. **And an accepted transaction is
   offered again while we wait.** Passing preflight means the node we asked took
   it, and nothing more: on a free RPC nothing re-propagates it if those slots
   fill without it, and a signature that never reached a leader is
   indistinguishable from one that has not been processed yet. So every
   transaction still unresolved is re-sent while settling — the identical bytes,
   so it remains one transaction however often it is offered, and a burn that
   lands on the first poll never sends twice. That is the difference between a
   real verdict and "accepted, then silently dropped, outcome unknown".

### Choosing how much of a token to swap

Every selected token used to go in **full**: it was a dust sweeper, and the
emptied account was closed for its rent. Each selected row now carries an amount
field with 25/50/75/100% buttons, so Slingshot can move part of a balance as well
— a different job from clearing dust, and the reason this was worth doing
carefully rather than as a bigger number in one field.

It is the same transaction shape but **not** the same instruction list, and four
things follow from that:

- **Rent is only reclaimable when the swap empties the account.** `closeAccount`
  is refused on a non-empty account, and because many swaps ride in one packed
  transaction, a single bad close fails the whole sweep rather than just that
  token's. So a partial amount skips the close — and the row says so, rather than
  quietly returning less SOL than the user expects. `mintsWithoutRentReclaim` is
  that rule, shared by the client that composes the batch and the server that
  prices it.
- **Value is scaled to what is swapped, not to the holding.** 10% of a $500 token
  contributes $50 to the total, and price impact compares that $50 against the
  quote — measured against the full balance, a partial swap would read as a
  catastrophic loss when nothing had been lost. The success screen and the local
  history are scaled the same way, so a partial sweep cannot be reported as its
  whole balance.
- **The dust threshold is a test on the chosen amount.** Otherwise a large token
  set to 10% would be filtered out as "above the threshold", which is the exact
  opposite of what the user asked for. At the default 100% this is the value it
  always was.
- **Nothing is silently reinterpreted.** An amount above the balance is
  *refused*, not clamped down to the whole balance: `/api/plan` reports it as a
  failure and that token is not swapped. And `100%` always means the exact
  balance, never 99.99% of it — one base unit short is the difference between a
  reclaimable account and a stuck one.

The arithmetic is `bigint` throughout (`lib/sweep/amounts.ts`), for the same
reason a payload send parses decimals as strings: `1.005 * 1e6` is
1004999.9999999999, and that residue would leave an account which can then never
be closed. An absent amount means the whole balance, so an untouched sweep still
builds exactly the request it always did.

---

## The Void

The Void is the second flow: empty a token account, close it, reclaim the rent —
for the things a swap cannot help with. It holds **three tabs**, because the
three kinds of thing a wallet holds are not interchangeable, and merging them
into one list is exactly what once made an NFT look burnable.

| Tab | Listed | Burnable | Rent back |
|---|---|---|---|
| **Tokens** | every fungible with a balance, flagged by liquidity | yes — unpriced ones are pre-selected | one token-account rent per closed account |
| **NFTs** | every uncompressed NFT, with artwork and collection | **opt-in, one tick at a time** | one token-account rent per closed account |
| **cNFTs** | every compressed NFT | **opt-in, one tick at a time** | **none** — a cNFT is a merkle leaf, not an account |

One case sits between the tabs. `decimals === 0` is the shape of an NFT *and* the
shape of a collectible minted as a fungible — a Jupiter collectible with no symbol,
no price and no market, which an index types as `FungibleAsset` and which nothing
in the scan can tell from a token. **The market decides it**: a 0-decimal asset with
a price is something people trade and stays on the token tab; one with no price is
not, and is presented on the NFTs tab, where nothing is pre-selected and burning it
is a deliberate act. Either way its burn is the plain SPL route an uncompressed NFT
uses. The rule lives in one place, `lib/token-source/collectible-shape.ts`, because
the token split in `app/api/tokens/route.ts` and the pre-tick in
`lib/sweep/void-prompt.ts` have to agree — an asset presented as a collectible while
still ticked for destruction would be the worst of both.

Three rules hold across all of it:

- **Nothing is pre-selected on the NFT tabs.** An unpriced fungible is a safe
  default to tick, because a token nobody will route is genuinely worthless. An
  NFT is the opposite: it has no price to read, and its value cannot be inferred
  from that. So burning starts from zero and every tick is deliberate.
- **Anything we cannot build a *correct* burn for is refused, with the reason on
  the row** — shown, not hidden, so nothing appears to vanish. Today that means
  interfaces we do not recognise, frozen assets, assets **delegated** to another
  program (staking, escrow, or a listing that never moved the asset), a pNFT
  that is locked or listed for sale, and any SPL-backed asset whose token
  account could not be located. The reasons are *ordered by specificity*: an
  asset type we do not support says so, rather than reporting a missing account
  it never had. The point of all of them is the same: **only things that should
  be burned get burned.**
- **A frozen token account is refused on the token tab too, before the burn is
  built.** The token program permits neither `Burn` nor `CloseAccount` on a
  frozen account, so offering one is offering a preview that cannot succeed.
  This is asked of the chain (`getMultipleParsedAccounts`, one batched call)
  rather than read from the scan, because the two scanners disagree — the
  free-RPC one already drops non-initialised accounts, while the DAS one cannot
  report account state at all. Unknown counts as *not* frozen: a failed lookup
  leaves the token offered and the simulation as the backstop, because refusing
  something that is actually fine is the worse mistake. A frozen account cannot
  be thawed by its holder — only by the mint's freeze authority — and spam
  airdrops are frequently frozen precisely so the holder can move neither the
  balance nor the rent locked under it.
- **No Spacedust fee is charged on an NFT burn.** The Void's 1.5% is a charge on
  reclaimed rent; extending it to NFTs is a pricing decision, not an
  implementation detail, so it is not made silently.

Four burn routes, because the four asset classes are genuinely different:

- **SPL NFTs** (`V1_NFT`, `LEGACY_NFT`, `V1_PRINT`) go through the token program:
  `Burn` the one unit, then `CloseAccount` to return the token account's rent.
- **pNFTs** (programmable NFTs) go through Token Metadata's `burnV1`, because the
  asset carries a *token record* that a plain SPL burn would leave behind. Two
  things are read from the chain before a burn is offered, in one batched call:
  the token record's `state` — a pNFT can be **locked** by an escrow or **listed
  for sale**, which leaves it sitting in the owner's own wallet while only the
  current delegate may move it — and the asset's **token standard** from its
  metadata, since a pNFT and a printed *edition* of one (standards 4 and 5) are
  both called `ProgrammableNFT` by the index and need different handling. Rent
  comes back exactly as for an SPL NFT, since a pNFT is an SPL token underneath.
  Printed editions are **refused with the reason** — burning one needs its master
  edition's accounts, which this build does not derive. Unlike the other
  refusals here, that one is *unverified*: no real print could be found to test
  it against, as the verification notes below record.
- **Core assets** are a single account owned by the Core program, with no token
  account at all — the program closes the asset itself and returns its rent.
  That instruction comes from `mpl-core` rather than from us, converted into a
  plain web3.js instruction by Metaplex's own adapter, so there is no
  hand-encoded discriminator anywhere. Those packages are imported
  **dynamically**: a user who never burns a Core asset never downloads them.
  Two facts about Core's burn are worth knowing, both measured on mainnet: it
  does **not** close the asset account — it empties it and shrinks it to a
  single zero byte, which keeps 655,320 lamports of the rent and leaves a husk
  every index still describes with the old owner. So the rent figure subtracts
  that byte (priced at runtime, like every other rent here), and the scan drops
  any asset whose account is missing or husked — otherwise a burned NFT
  reappears in the grid and reads exactly like a burn that never happened, which
  is precisely what one did.

  That last check has a trap in it, and it caught one: a **cNFT's id is a merkle
  leaf**, so no account exists there *ever*, and asking about it returns `null`.
  Reading that as "destroyed" deleted every live cNFT from the scan. So the rule
  lives in `lib/solana/liveness.ts` with its own tests, and it only counts a
  death it can prove: an account-backed asset whose account is gone, or a
  one-byte husk.
- **cNFTs** are leaves in a concurrent merkle tree, so Bubblegum destroys the
  leaf and nothing is returned. The proof that the leaf is really in the tree
  cannot be computed here — it needs every other leaf — so it is fetched from
  the indexer at plan time and never carried over from the scan. Same
  instruction-from-the-package rule as Core, and same dynamic import.
- **cNFTs** are leaves in a concurrent merkle tree, so Bubblegum destroys the
  leaf and nothing is returned. The proof that the leaf is really in the tree
  cannot be computed here — it needs every other leaf — so it is fetched from
  the indexer at plan time and never carried over from the scan. Same
  instruction-from-the-package rule as Core, and same dynamic import.

Three things about cNFT burning are worth stating plainly, measured on mainnet
rather than assumed:

- **A tree created without a canopy cannot be burned in one transaction**, and
  that is about proof *length*, not size of tree. A burn carries one account per
  proof node, so the transaction grows by ~33 bytes per node: measured, 1052
  bytes at 14 nodes, 1151 at 17 and 1250 at 20, against a 1232-byte limit —
  which is exactly the constraint Metaplex states in their own tree guidance
  ("only 17 proof accounts fit in a single transaction"). A tree's proof is
  `depth − canopy`, so a canopy is what keeps this small: their recommended
  depth-20 tree uses canopy 13, a 7-node proof, which fits with room to spare.
  Only a tree built with **no canopy** sends every level, and those are refused
  with the reason on the row rather than broadcast into a rejection.
- **Bubblegum V2 is supported, and is a different instruction rather than a
  variation.** A V2 leaf commits to its own asset-data hash and a flags word —
  both of which the index reports, and both of which the program checks — and it
  is destroyed by `burnV2`: another discriminator, twelve accounts instead of
  seven, two extra arguments. The signing slot moves too: V2 has an explicit
  `authority`, so a collection's permanent burn delegate can sign instead of the
  holder, and `leafOwner` is only an account to compare against. Handing the
  owner as a signer for `leafOwner` is a transaction the holder cannot sign, so
  the account roles are asserted in the test suite. V2 carries five more
  accounts than V1, so at the same proof length a V2 burn is ~137 bytes larger —
  worth knowing when a proof is near the limit, though a canopy tree never is.
- **A proof can go stale between the preview and the signature.** If the tree
  gains a leaf in that window the root moves and the proof stops verifying. So
  the app fetches a proof as late as it can, and if a cNFT nonetheless fails to
  simulate it re-fetches the proof and rebuilds **once** before saying anything —
  the race is not a mistake, and reporting it would be giving up on something
  fixable. Only if the second attempt fails too does it say so in words — and
  that message names **both** causes, because from the client they are genuinely
  indistinguishable: the tree gained a leaf, or the leaf is already gone. Burned
  is unknowable from inside the transaction — a cNFT leaf leaves no account
  behind, so the burn is built from a proof that still verifies *as a proof* and
  simply no longer matches the tree. The index does know the difference and says
  so: Helius carries a `burnt` flag on every asset and it is exact (checked
  against known burns and the live assets beside them in the same response). It
  is also **late**, which is why such an asset was offered for burning at all. A
  tree being actively minted into can win the race twice, and a stale row can be
  ticked again by mistake; either way the honest answer is one sentence and a
  pointer to Solscan.

Burning closes the token account and returns its rent. The mint and metadata
accounts are **not** reclaimable — Metaplex exposes no way to close them.

**A burned asset does not come back.** Two mechanisms, answering different
problems. The general one is the index's own verdict: every Helius asset carries
a `burnt` boolean, and the scanner drops anything it flags — so an asset
destroyed in another app, or from another device, disappears here too. It is
accurate and it is **late**, landing when the indexer processes the slot, so the
app also records the ids of burns *it* watched the moment they land. That second
list is not belt-and-braces: for a cNFT nothing else can exist, because burning a
leaf leaves no account for the liveness pass to inspect, and the remembered id is
the only thing saying so until the index catches up.

**Anything can be hidden by hand, and un-hidden again.** Every row carries a hide
control, and the two reasons to use it are different in kind: a row that lingers
after a burn is a fact being written down, while hiding a live asset is a
preference. Both go into one list, which is why that list can be *edited* — a
hide that cannot be undone is a trap, so the hidden rows are counted beneath the
grid and one control brings them back, dimmed, to be restored.

**A wallet is not the chain, and after a burn it will disagree with you.** The
asset is destroyed on chain while the wallet that still lists it is showing its
own lagging index, not an error — for a cNFT that discrepancy can last a long
time, because nothing on chain disappears for the wallet to notice. No app can
reach into another app's index, so The Void does the honest thing instead: the
burn result says the asset may keep showing in your wallet for a while, that it
cannot be recovered, and that most wallets will let you hide it. Leaving that
unsaid is how a successful burn gets read as a failure.

### Why there are no floor prices

A deliberate omission, recorded here so it does not get "fixed" later.

A floor price helps when one exists and is **actively misleading when it does
not**. Plenty of valuable NFTs have no active listings at all, so "no floor
found" reads as "worthless" precisely when it means "we could not see a market".
In an app whose one promise is that it never destroys value on your behalf, a
signal that can *cause* a bad burn is worse than no signal.

It would also be the most fragile dependency in the app: a third provider and
key alongside Helius and Jupiter, marketplace terms, per-collection rate limits
on a path that already makes several calls — and NFT APIs churn more than
anything else in this space.

---

## Wallet Scan (read-only)

`/scan` takes an address and reports what a sweep *would* recover from it: the
dust value, the rent locked in token accounts that could be closed, and what a
sweep would refuse to touch — frozen holdings, transfer hooks, transfer-fee mints
whose ATA cannot be closed, and balances whose account the scanner could not name.

The address is a query parameter, so a result is a link. That is the whole design:
the page has to work with no wallet present, and it must never look like it is
about to ask for a signature.

### Positions that are not dust

A wallet can hold something that looks exactly like a token and is not one: a
share of a liquidity pool. Two things are true of it at once, and **both are
needed**. Its mint is controlled by a **program** rather than a keypair — because
a wallet can be a mint authority and a program cannot, so an authority sitting
off the ed25519 curve belongs to code, and that needs no AMM SDK and no pool
registry to read. And **no market prices it** — the second half, which costs
nothing extra because every holding is priced anyway.

Shape alone was not enough, and Pudgy Penguins is where that got settled. PENGU
has 562,000 holders, a live market and a Jupiter quote — and a mint authority
held in a vault sitting off the curve. Judged on shape it was a "liquidity
position", which cost it its label in this scan and then its place in the
sweeper's own list, once that list learned to respect the label. A market is what
makes a token sellable; a PDA-shaped authority is not evidence that there is no
market. So a program-controlled mint is refused **only when nothing will price
it** — a claim with nowhere to go, which is what the refusal was always for.

It is listed, and it is refused. There is no market to sell it in and a funded
token account cannot be closed, so neither its value nor its rent is reachable
from here. That is why it never enters the scan's total, and the list says so
instead of showing a number. **No price is shown either**: valuing a share means
reading the pool, and an invented figure nobody could check is precisely what
this file's neighbours exist to prevent.

The signal was arrived at by measurement, and was wrong twice first. The first
attempt treated "a one-of-one with no decimals" as a position — which is every
NFT ever minted; run against the Incinerator as a control it produced 18
confident pool positions (ArtPunk, Lunaroid, Frame) and not one was a pool. The
second used the mint's authority, and the same control showed why that axis is
the right one: of 996 mints held there, all 996 had their authority **revoked**,
so the signal stays silent on ordinary tokens rather than shouting about them.
The third correction was not a different axis but a missing one: the authority
tells you the mint is somebody's code, and it says nothing at all about whether
anybody will buy the token — which is the question the refusal actually depends
on.

Two consequences are enforced in code rather than in the copy:

- **It cannot be swept.** `summariseRecoverable` leaves a pool share out of the
  value *and* the rent, and counts it under its own limitation.
- **It must never be burned.** The Void pre-selects unpriced tokens, and most
  pool shares have no price at all — so without a rule, the default path through
  that page would offer to destroy one. Burning it closes the account and gives
  away the share of the pool it represented, irreversibly, for nothing. `planVoid`
  refuses it by name, and the pre-selection skips it.

What this deliberately does **not** do is withdraw. Getting the value back means
calling the pool's own program, which needs that protocol's account layout
measured against a real position — a planner, not a scan. Until then, the honest
thing is to show the holding and say what it is.

The arithmetic lives in `lib/sweep/recoverable.ts` as a pure function, because it
is a promise about a future transaction and every number in it has to survive
being checked later with a wallet connected. Two rules follow:

- **Rent is only counted for accounts that can genuinely be closed.** A frozen
  account's rent is not recoverable and neither is its value; a transfer-fee ATA
  keeps a residue, so its value counts and its rent does not. Counting either
  would repeat the exact mistake this project already made once, when a stale rent
  constant made every figure it quoted wrong.
- **An unpriced token contributes its rent and nothing else.** Not a rounding
  choice: it has no USD value, and The Void can still burn it for the rent, which
  is precisely the recoverable part.

What the total leaves out is listed explicitly, by reason and count, so the number
is never the only thing the user sees.

### Staked positions — and the two shapes they come in

"Staked" is not one thing, and the scan treats it as two, because the two arrive
from entirely different places on chain.

**Liquid staking tokens** are ordinary SPL tokens. mSOL, JitoSOL, jupSOL and the
rest sit in a wallet exactly like dust, are priced by Jupiter, and a sweep would
sell them without noticing. Nothing *on the mint* says what they are, so they are
matched against a curated registry — `lib/staking/staked-tokens.ts`, one verified
mint per protocol — rather than inferred. Jupiter tags these `lst`, but a tag is
not a name: the same reasoning that stops this project calling an unnamed
program-controlled mint "a Raydium position" stops it calling one "staked with
Marinade".

It is worth recording what this corrected, because the bug was live: **every
liquid staking token has a program-controlled mint**, so all of them were
previously listed as "a share of a liquidity pool". mSOL is not a pool share. The
two signals overlap on nearly every LST, so they are *ranked*, never merged —
`staked` is the stronger answer and leads, and one holding is never counted twice.

**Native SOL stake accounts** are not tokens at all: no mint, no ATA, invisible to
`getTokenAccountsByOwner`. They are found by asking the Stake program for accounts
whose withdraw authority is this wallet, and each is decoded by
`lib/staking/native-stake.ts`. That read needs `getProgramAccounts`, which the
public RPC does not offer — so on the free path it comes back as a stated error
beside an empty list, never as a silent "you have no stake".

The layout was measured rather than remembered, and the first attempt was wrong.
The voter field was assumed to sit at offset 76 and a filter on it returned
**nothing** — indistinguishable from a wallet that stakes nothing. Dumping a real
account and brute-forcing every 32-byte window for one owned by the Vote program
put it at **124**: a 48-byte `Lockup` sits in between, all zeroes on a normal
account. That failure mode is why every account that comes back has its decoded
withdraw authority compared against the wallet that was asked about. A filter that
matched nothing, and a filter that matched the wrong accounts, must not look alike.

Both kinds stay out of the total and out of every destructive path, for the same
reason a pool share does. Staking is reversible — just not from here — and the
note says exactly that rather than implying the position is lost.

---

## Revoke token approvals

`/approvals` answers one question: **who else can move the tokens in this wallet?**

A token account carries an optional `delegate` — a third party allowed to transfer
or burn up to `delegatedAmount` from it, without another signature from you. Two
everyday things create one: listing an NFT (the marketplace takes a delegate so it
can complete the sale while the NFT stays in your wallet) and clicking approve in
any dApp. They do not expire, which is the entire point of the screen.

`Revoke` clears it. The flow is the same pipeline as everywhere else here — read
from the chain, build the instruction locally with `@solana/spl-token`'s
`createRevokeInstruction`, pack with the shared byte-exact packer, simulate,
then one wallet approval — with two deliberate differences:

- **Reading the list is its own step.** The list *is* the decision, so it appears
  before anything is selected or prepared.
- **It fails closed.** If the chain cannot be read, that is an error, never an
  empty list. "No approvals found" and "we could not look" are different answers,
  and only one of them is safe to show on a security screen.

Three things learned by running it against mainnet, all of which changed the code:

| Finding | Consequence |
|---|---|
| `Revoke` on a **frozen** account is rejected: `Custom: 17`, "Account is frozen" | Frozen rows are listed — the delegate is real and stays live — but they are not selectable, and the planner drops them with a warning. Offering one would build a transaction that cannot succeed. |
| A delegate that *is* the account's own owner grants nothing | Those rows are not listed at all. Padding a security report with non-risks is its own kind of wrong. |
| A revoke costs ~250 CU | The transaction asks for 200,000 CU rather than the sweep's 800,000. The priority fee is billed on the *requested* budget, so the default would have charged ~1,500 lamports per transaction for headroom nobody needs — on an action that recovers nothing. |
| `getParsedTokenAccountsByOwner` is not a JSON-RPC method — it is `getTokenAccountsByOwner` with `encoding: "jsonParsed"` added inside web3.js | The names the client writes are not the names that need allowing, and the proxy rejected the read with "Method not allowed: getTokenAccountsByOwner". Fixed, and now enforced by a test that reads the client sources and maps every call onto its real RPC method. |

Revoking recovers no value — nothing is sold — so the screen says so rather than
implying a win. It also cancels any open listing that relied on the delegate.

---

## Rent left behind

A wallet that sells a token somewhere else — a DEX, a bridge, a manual
`transfer` — leaves the token account behind. It holds no balance, so nothing
shows it: the token list has no value to display and a sweep has no swap to
attach a `closeAccount` to. It just sits there, holding its rent, indefinitely.

That rent is ~0.00203928 SOL per account, and closing the account returns it.
Spacedust finds these accounts, shows what they are holding, and closes them in
one approval.

**This is the only flow with nothing to decide.** There is no route, no price,
no slippage and no selection — the accounts hold no assets, so there is no value
to be wrong about and nothing to approve. That is also why it is not part of the
sweep: it works in a wallet with no dust at all, and it is the only action here
that cannot fail for a market reason. It takes 1.5% of the rent it returns —
the same rate The Void charges, because closing an empty account is the same kind
of job in both places — and says so in the panel before anything is signed.

It reports what it will not touch, per account:

| The account | What happens |
|---|---|
| Empty, ordinary, or **frozen** | Closed. Freezing blocks a transfer, a burn and a revoke, but not a close. |
| Empty with a live **delegate** | Closed. A delegate is a permission to transfer, and a close is not a transfer. |
| Empty with a **foreign close authority** | Left alone. Once a close authority is set, the token program refuses the owner's signature entirely — `Custom: 4`, "owner does not match". |
| Token-2022 with **withheld fees** | Left alone. `Custom: 35`: the mint must harvest them first, and harvesting needs the mint's authority. |

Rent is quoted from each account's own balance rather than a constant, because
the two programs do not hold the same amount: a legacy account holds 2,039,280
lamports, and a Token-2022 account with extensions 2,074,080 — one carried
2,192,400. The *live* rent-exempt minimum measured 1,488,440, which is lower than
every real account, so pricing from it would understate the total by about 27%.

---

## Payload — batch sending

`/payload` sends tokens and NFTs to **one address**, packed into as few
transactions as the 1232-byte limit allows, closing every account the send empties
so its rent comes back. 1.5% of that rent is the fee; the assets themselves are
never charged on.

A send is the only flow here that cannot be undone, so the destination is settled
before anything else is chosen:

- **The address is shown in groups of four** once it parses. The risk being
  guarded against is a clipboard swap, which changes the middle of an address, and
  this is the one check that catches it.
- **A test transfer** (on by default) sends 0.001 SOL and then reads that
  transaction back, comparing the recipient's lamports before and after — evidence
  a balance lookup cannot produce, and available whether or not the user controls
  the wallet. It proves the address *can receive*; it cannot prove who owns it, and
  the page says so rather than implying otherwise.
- **A verified address is locked.** The plan carries the address it was built for
  and `execute()` re-checks it against the form before signing, so an address
  edited after the preview is a refusal rather than a warning.

The costs people do not expect, both stated before a signature:

| Cost | Why |
|---|---|
| The recipient's account | A wallet that has never held the mint needs one, and the **sender** pays its rent-exempt deposit — 1,488,440 lamports when measured |
| The net | The reclaim, less the fee, less those deposits. **Sending dust to a fresh wallet is net-negative by default**, and the preview says so outright |

Refused with the reason on the row, never hidden: cNFTs, pNFTs and Core assets
(their transfer routes are not built yet), frozen accounts on either side,
transfer-hook mints, and any holding whose token account the scan could not name.

---

## `.sol` domains — deleting a name for its rent

A `.sol` domain is not an SPL token. It is a **name account** owned by the SNS
program, and its deposit is set by the *length of the name* at registration rather
than by any one constant: measured across real domains, a 96-byte name held
1,559,040 lamports, a 1,096-byte name 8,519,040, and a 10,096-byte name
71,159,040. So the figure is read per domain, like every other rent in this app.

Deleting one uses the SNS program's own `deleteInstruction` — taken from
`@bonfida/spl-name-service` rather than assembled here, because this codebase does
not hand-encode another program's instructions — with the owner as both signer and
refund target. It is built by `POST /api/domains` and validated on the client
through `apiToInstruction`, the same boundary Jupiter's instructions cross.

**It is not a close.** SNS's own documentation is blunt: the name returns to the open
namespace where anyone can register it, its records and subdomains go with it, and
deletion cannot be undone — they say they do not recommend it. So nothing is
pre-selected, each domain is a deliberate tick, the warning sits above the list
rather than in fine print, and the button says "delete for good". Refused with the
reason on the row: domains wrapped as NFTs (that route is not built), and any name
whose registry owner is not the connected wallet.

The lookup is a **server route** because the SDK lists with `getProgramAccounts`,
which this app's RPC proxy refuses by design. Tokenization and account sizes are read
in two batched calls, because per-domain reads drew 429s during the probe.

---

## Security model

**Spacedust cannot move your funds.** There is no code path from a server key to
a signed transaction. Concretely:

- No private key or seed phrase is ever requested, stored, or transmitted.
- Every mint and amount is re-validated **server-side** before instructions are
  built (`app/api/plan` enforces base58 validity, positive amounts, and a
  SOL, USDC or JUP allow-list for the output mint).
- Jupiter's instructions are validated field-by-field before they become a
  `TransactionInstruction` (`lib/solana/instructions.ts`).
- Every transaction is simulated before the user is asked to sign.
- Token metadata (names, symbols, logo URLs) is sanitised server-side: control
  and bidi-override characters are stripped, and only `http(s)` logo URLs
  survive. Logos render as plain `<img>` with `referrerPolicy="no-referrer"` and
  a letter-avatar fallback, so an unknown or hostile logo host can never crash
  the page; the optimizer host allow-list in `next.config.ts` independently
  constrains its server-side fetch (the SSRF surface).
- The response headers are part of the model: the app refuses to be framed
  (`X-Frame-Options: DENY`), denies the microphone and the location outright, and
  allows the camera **to itself only** (`camera=(self)`). That last one has to be
  read carefully, because `camera=()` denies it to *every* origin including this
  one, and turns the scanner off in a way that every permission setting reports as
  a browser problem — see `next.config.test.ts` and the note under Verification.
- localStorage is never trusted: every persisted value is validated on read, and
  a corrupt entry can only render wrong text, never move funds.

**Protect yourself:** verify the domain before connecting, never approve a
transaction you do not understand, and keep a little SOL for fees. See
`/security` in the app.

---

## Verification

The packing logic is the part that can quietly lose money if it is wrong, so it
was verified against the real code with a temporary route asserting:

- multiple swaps pack into fewer transactions, and never exceed 1232 bytes;
- oversized routes are dropped **with a reason**, never silently;
- `closeAccount` lands between swap and cleanup and uses the correct token
  program;
- a malformed Jupiter route drops only itself, not the whole sweep;
- transfer-fee mints are swapped but skipped for rent reclaim.

All ten assertions passed. That run surfaced a real bug: `@solana/web3.js` 1.99
stores v0 instructions under `compiledInstructions`, not `instructions`, which
was silently dropping the priority fee from the pre-signature estimate. Fixed in
`lib/solana/simulate.ts`.

To re-run those checks, recreate `app/api/selftest/route.ts` and
`curl localhost:3000/api/selftest`. It is deliberately not shipped — an
unauthenticated endpoint that dumps internal structure is needless exposure.

The API boundaries were also exercised directly:

| Check | Result |
|---|---|
| Rogue output mint (attacker token) | `400` — "Output asset must be SOL, USDC or JUP" |
| Negative / malformed amount | `400` — "Invalid amount" |
| Invalid mint address | `400` — "Invalid mint" |
| Invalid wallet address | `400` — "Provide a valid Solana wallet address" |
| `getProgramAccounts` via RPC proxy | rejected (method not in allow-list) |
| `GET` on the RPC proxy | `405` |
| Missing `HELIUS_API_KEY` | `424` with setup instructions, not a generic error |

### How the approvals routes were verified

The delegate read and the revoke instruction were both checked against mainnet
rather than against documentation — and both found something the docs did not say.

`probes/tmp-approval-probe.mjs` locates real token accounts carrying a delegate (a
`getProgramAccountsV2` page with a `memcmp` on the `COption` tag at offset 72,
since Helius refuses a whole-program scan of the token program) and then runs the
exact call the feature uses, `getParsedTokenAccountsByOwner`. It returns the
delegate, `delegatedAmount` and balance for each: 164 of one wallet's 169 accounts
had a live delegate, which is the shape the UI renders.

`probes/tmp-revoke-sim.mjs` then builds the real instruction and simulates it with
`sigVerify: false`, exactly as the app does before offering anything:

- **Non-frozen delegated account → `err: null`.** The instruction is correct and
  costs 252 CU, which is why the transaction asks for 200,000 rather than the
  sweep's 800,000.
- **Frozen delegated account → `InstructionError: [1, {Custom: 17}]`**, with the
  program log reading `Error: Account is frozen`. The token program will not clear
  a delegate while an account is frozen, so those rows are now inert in the UI and
  dropped by the planner with a warning. Nothing else in the app would have caught
  this: the instruction is well-formed and the account exists, so only a real
  simulation against a real frozen account surfaces it.

### How the rent-reclaim flow was verified

The rule that decides whether an account can be closed was not read out of
documentation and then trusted. Every branch was settled by building the exact
instruction the flow builds and simulating it against **real mainnet accounts of
that kind** — `probes/tmp-empty-accounts.mjs`, which finds them with a `memcmp` on the
account's own fields rather than guessing.

| The account | Simulation |
|---|---|
| legacy, empty | `err: null` — 120 CU |
| legacy, empty, **frozen** | `err: null` — 120 CU |
| legacy, empty, live **delegate** | `err: null` — 120 CU |
| legacy, empty, **foreign close authority** | `Custom: 4` — "owner does not match" (39 real accounts) |
| Token-2022, empty (`immutableOwner`) | `err: null` — 1,464 CU |
| Token-2022, **withheld fee > 0** | `Custom: 35` — "harvest fees to the mint and try again" |
| Token-2022, empty, foreign close authority | `Custom: 4` — same refusal as legacy |

Three things came out of that, and two of them contradict what this app assumed
elsewhere:

- **A frozen account can be closed.** `Revoke` is refused on a frozen account
  with `Custom: 17`, and a burn cannot empty one, so the app's rule has been "a
  frozen account's rent is unrecoverable". That is true only while it has a
  balance: an *empty* frozen account closes normally, and its rent is real.
- **A close authority removes the owner's rights.** The owner signs and the
  program still refuses: the authority for a close is `close_authority` when one
  is set, and only the owner when none is. Those accounts are listed and refused
  by reason.
- **Rent is not one number.** Legacy and Token-2022 accounts hold different
  amounts, and extensions add more, so each account is priced from its own
  balance.

Two probes of my own were wrong before the code was. The first found a
"delegated" account that also had a foreign close authority, so the failure it
reported answered the wrong question; the second compared a withheld fee to the
string `"0"` when the RPC returns a number, so its filter matched nothing. Both
are fixed in the script, and the isolation rule — one variable at a time — is
written into it, because a probe that answers the wrong question is worse than
no probe.

### How the domain delete was measured

`probes/tmp-sol-rent-probe.mjs` builds the real instruction and simulates it against a real
mainnet name account with `sigVerify: false`:

| Measurement | Result |
|---|---|
| delete on a live name account | `err: null` — **207 bytes, 1,801 CU** |
| the refund | that account's own rent — 8,519,040 lamports on the one measured |
| name-account rent across real domains | 1,559,040 (96 bytes) → 8,519,040 (1,096) → 71,159,040 (10,096) |
| names registered in total | **455,612** (a ground-truth scan of the program) |

Two things the probe had to learn the hard way. Deriving a name account from a name
string produced addresses with **no account** for names that certainly exist
(`solana.sol`, `toly.sol`, `phantom.sol`), while `getAllSnsDomains` returned 455,612
live ones — so the keys come from the SDK's own queries, never from a derivation
written in this repo. And per-domain reads drew 429s from the RPC, which is why both
the route and the planner batch them.

What remains unmeasured, and is therefore refused rather than attempted: whether a
**tokenized** domain's NFT has to be burned before the name can be deleted. Until
that is settled against mainnet, wrapped domains are listed with that reason.

### How the swap fee was measured

`probes/tmp-referral-probe.mjs` asks Jupiter's Swap API for the same swap twice — once
plain, once with `platformFeeBps: 50` — and diffs the answers, and
`probes/tmp-referral-account-probe.mjs` reads the Referral Program's own accounts.

| Measurement | Result |
|---|---|
| `platformFeeBps: 50` on `/swap/v2/build` | output falls by **exactly 50.00 bps** (15,310 of 3,062,169 lamports) |
| `referralAccount` + `referralFee` on that endpoint | **ignored** — 0 accounts added, quote unchanged |
| the fee account, in the returned instruction | +1 account: the token account named, nothing else moved |
| a referral token account | is `ATA(referralAccount, mint)` — matched on **4/4** real `claim_v2` instructions |
| the configured referral account's split | `share_bps` = 8000 read from chain → **0.4% kept, 0.1% to the project** |
| referral-program instructions sampled on chain | all **8 bytes** — discriminator only, no amount argument |

What this settled. Jupiter's docs put the Router path at "platform fee only
(`platformFeeBps`)" with referral fees reserved for the Meta-Aggregator, and the
probe agrees: `/build` honours the platform fee and ignores the referral
parameters, so the fee is a `platformFeeBps` charge *pointed at* a token account
of our choosing. That is the entire reason the destination is the fee wallet's
own `ATA(wallet, mint)` and not a referral account — a referral account is
charged identically, but a claim pays out only its on-chain `share_bps`, and the
account measured here reads 8000, so a tenth of the fee would have gone to
Jupiter rather than to the wallet that configured it. The account is derived from
the wallet rather than configured per asset for the same reason the program
derives a referral account: one address, three accounts, no way for them to
drift.

### How the payload send was measured

`probes/tmp-payload-transfer-probe.mjs` builds the real instruction runs and simulates
them against real mainnet accounts with `sigVerify: false`. What it settled:

| Measurement | Result |
|---|---|
| create + transfer + close | **394 bytes, 15,243 CU, `err: null`** — and the same for a real NFT |
| of which, the account create | 106 bytes, and mandatory: without it the transfer fails `InvalidAccountData` |
| of which, the close | 7 bytes — the rent reclaim is never what makes a batch too big |
| distinct destinations per transaction | 394 / 492 / 688 / 884 / 1080 bytes at 1, 2, 4, 6, 8 → about **11** fit |
| a mixed batch | one NFT plus six token sends = 694 bytes |
| sending to your own wallet | refused on the close: `Custom: 11`, NonNativeHasBalance — the balance never leaves the account |
| the rent on a real account | 1,488,440 lamports, where the constant says 2,039,280 |

Two things came out of the run itself. The first version reported that the account
create cost **0 bytes**, because both arms of the comparison included it — a
difference between two identical things is not a measurement. And its recipient
defaulted to `.env.local`'s fee wallet, which in this environment is the operator's
own address, so every "send" was a self-send; fixing that produced the self-send
finding above, which is now a hard rule with a test behind it.

A gap worth recording: Helius rejects `searchAssets` with `tokenType` unless an
`ownerAddress` is supplied, though the DAS spec allows `tokenType` alone. The probe
asks by `interface` and traces the holder through `getTokenLargestAccounts`
instead.

### How the instruction audit works

Every transaction this app builds is checked before it is signed — not for
whether it will *work* (that is what simulation is for) but for whether it can do
anything the user did not ask for. `lib/security/instruction-audit.ts` walks the
instructions that are about to be signed and refuses the plan if any of them is
not attributable to what the flow promised.

The gap it closes is the one simulation cannot: a `SystemProgram.transfer` that
empties a wallet simulates perfectly. Before this, nothing asked whether the
instructions from `POST /api/plan` and `POST /api/domains` — both of which cross
the network — meant what the screen said they meant.
`apiToInstruction` checks that an instruction is *well formed*: a real address, a
bounded account list, base64 data. That is a different question from *permitted*.

What it enforces, for all six flows:

| Rule | Why |
|---|---|
| The program must be on that flow's allow-list (`lib/security/program-ids.ts`) | A sweep has no business naming the SNS registry; a revoke has no business naming Jupiter. |
| `Approve` and `SetAuthority` are refused in **every** flow | The two instructions that turn a mistake into a loss. Nothing here ever grants a delegation or hands over ownership. |
| A `closeAccount` may only refund to the owner | Rent goes back to the wallet that paid it. |
| The only SOL that may leave is the computed fee | A sweep's fee rides inside the aggregator's call, so a sweep allows *no* System transfer except one into the wallet's own wrapped-SOL account. |
| A fee transfer may not exceed the figure the plan showed | The overcharge is what is being prevented, not just the drain. |
| A burn must be authorised by the wallet | Only a balance the wallet owns is destroyed. |
| A send's transfer must land in the verified destination, for an account owned by it | The destination proof is only worth something if the transfer is held to it. |
| A delete's refund target and authority must both be the wallet | A wrong value there is a theft rather than a failure. |
| Anything unreadable is refused, never skipped | "I cannot tell what this does" is not a reason to sign it. |

The packed bytes are checked too: every program id in the transactions that will
be signed must be on the flow's list, and the fee payer must be the wallet. That
check is narrower on purpose — resolving account indices inside a v0 message
needs the lookup tables the packer used — but it catches anything that arrived
during packing. Program ids are safe to read from `staticAccountKeys`: the
loader's own `sanitize()` rejects a message whose `programIdIndex` points outside
the static keys, so a program id can never come from a lookup table.

Two things the tests caught while building it, both worth keeping in mind:

- The two instructions from `createComputeBudgetInstructions` are **different
  lengths** — the limit is 5 bytes, the priority fee is 9 (a `u64`, not a `u32`).
  A decoder that assumed one length refused every plan the app builds.
- `System` had been left off the sweep's and The Void's allow-lists, and both
  flows legitimately transfer SOL: the Void's fee is a plain transfer, and a sweep
  that outputs SOL wraps it. Banning the program was wrong; the *destination* rule
  is the check that belongs there.

36 tests in `lib/security/instruction-audit.test.ts`, and every "accepts" case
runs through the real builder the app ships — `createComputeBudgetInstructions`,
`createCloseAccountInstruction`, `buildSend`, and the SNS delete shape the route
returns — so a change to any instruction layout fails in the test suite rather
than at a wallet prompt.

### Why a transaction that landed was reported as expired

`confirmTransaction` with a blockhash strategy does not return when a transaction
*confirms*. It throws `TransactionExpiredBlockheightExceededError` once the
blockhash's lifetime passes — and that was surfaced to a user, verbatim, as
*"Signature 3Bwp… has expired: block height exceeded"* for a transfer that had
already been **finalized**. The lamports had arrived. The app said it failed,
which also left the destination unverified and disabled the buttons that would
have let the flow continue.

The fix is one rule, now in `settleTransaction` (`lib/solana/submit.ts`): **an
expired blockhash ends our wait, not the transaction.** Before anything is
reported, the signature is looked up with `searchTransactionHistory` — a
transaction can be older than the RPC's recent cache — and if that finds nothing,
the transaction itself is read back with `getTransaction`. Only a signature the
chain has never seen is reported as `not-included`, and the copy says exactly that
rather than "failed".

The same rule now covers a *rejected send*: the signature is taken from the signed
transaction before broadcasting, so a send error is checked against the chain
before it is believed. An RPC can refuse a transaction it has already accepted.

The batch path had always worked this way — `settleSignatures` polls statuses and
re-reads rather than trusting an expiry — and `lib/solana/submit.ts` had a comment
saying not to use `confirmTransaction` the whole time. The verification hook was
the one place that didn't follow it. Eight tests in `lib/solana/submit.test.ts`
pin the rule down, including the exact reported case: no status came back, the
blockhash had expired, and the transaction is on chain → **confirmed**.

### Sending part of a balance

Payload's amount field is per token, and empty means all of it. A partial amount
needed no planner support, because the planner already worked that way: it reads
`token.rawAmount`, and `sendEmptiesAccount(amount, balance)` decides whether the
account can be closed. Sending part of a balance therefore cannot be followed by a
`closeAccount` (the token program refuses it with `Custom: 11`), so that account's
rent is not reclaimed and no fee is charged on rent that was never freed. The
preview's figures follow from the amount rather than being adjusted separately.

Amounts are converted by `toBaseAmount`, never through a float: `1.005 * 1e6` is
1004999.9999999999, so a float path truncated it to **1004999** — one base unit
less than was typed, which is the difference between a send that empties an account
and one that leaves a residue the account can never then be closed for. More
decimal places than the mint has is a refusal rather than a rounding, because
rounding up would send more than was asked for.

### What happens after a batch sends

The action buttons are replaced by a completion block, and it carries the
transaction ids: one per transaction submitted, each shown truncated, copyable in
full, and linked to Solscan. A batch of four items sent in two transactions leaves
two ids, and the report above says which item rode in which — so a row can be
traced to the transaction that moved it.

The prepared plan is then **cleared**, which is a safety property rather than
tidiness. A signed batch cannot be signed again: its `closeAccount` calls have
already happened, so a second attempt would be built against accounts that no
longer exist — failing on chain while still costing fees. The button is gone, and
the guard is in the hook too, so a second call answers "run the preview first"
rather than signing anything.

### Scanning a recipient address

Payload's recipient field has a **Scan** button that reads a QR code with the
camera: a wallet's receive code, a Solana Pay request (`solana:<address>?amount=…`)
or an explorer link. On a phone that is one tap instead of a copy, an app switch
and a paste — which is the worst part of sending anything.

What a scan does **not** do is prove anything. A code is as easy to print as a
paste is to intercept, so a scanned address goes through the same checks a typed
one does: the grouping a person reads, and the test transfer when it is switched
on. Scanning fills the field; it does not skip a step.

Three implementation notes worth keeping:

- **The decoder is loaded on demand.** `jsqr` is about 130KB, so it is imported
  dynamically when the dialog opens rather than with the page — the same rule the
  Metaplex burn builders follow. Checked against the built output rather than
  assumed: the decoder is in none of the 22 scripts the Payload page loads
  eagerly, and in a chunk of its own for when it is needed.
- **The camera stops when the dialog closes.** Every track is stopped on close and
  on unmount, because a camera left running behind a closed dialog is
  indistinguishable from spyware. Nothing is sent anywhere: frames go to a canvas
  and a decoder, and nowhere else.
- **A refusal says who refused it.** `getUserMedia` reports "this site is blocked
  by your browser" and "the operating system is blocking the browser" as the *same*
  error, and the first version of this copy described only the first — so a macOS
  user whose browser was allowed and whose system setting was not was told to
  change a setting that was already correct. Worse than no message, because it
  looks like an answer. The scanner now asks the browser two questions before
  writing anything: its own permission state, and how many cameras it can see. A
  granted site that can see no cameras at all is the signature of the system
  hiding the hardware, so that case names the system setting and the restart
  instead of the site — and if the *site* is blocked while the browser can also
  see no camera, the message names both settings, because whichever one is fixed
  second would otherwise leave a camera that still cannot start. Thirty tests, one
  of which pins the regression: the copy must never send someone to a setting that
  that is already correct. The branch taken is printed in tiny type under the
  failure (`refused-by-site`, `refused-by-frame-policy`, `no-camera-visible`,
  `camera-busy`, …) so a message that does not add up can be reported as something
  specific — and the console gets one **interpolated string** with the error name,
  permission state, camera count, `frame=`, `policy=`, stage and `location.origin`.
  A string because an object argument renders as `{}` exactly when someone is trying
  to read it, and the origin because "this site is blocked" is meaningless without
  knowing which site the browser thinks this is. The `frame=`/`policy=` pair covers
  the case that most looks like a lie: an embedded page is given no camera unless
  the page around it asked for one, so the site's setting, the browser's camera
  preview and the system setting can all read correctly while the request is
  refused — and the message names the page around it, plus the exact address to
  open in a normal tab, instead of a setting that cannot help. A **Try again**
  button re-requests without closing the dialog, because "a video call had the
  camera" should cost one tap, not a reopen.
- **A code is parsed, never guessed at.** `parseScannedDestination` ends with an
  address or a *reason*: a bare address; a payment request, whose amount is
  deliberately not applied because this field is a destination; an explorer link
  only when the address is the whole of its last path segment, so a query cannot
  smuggle a second one; and a named refusal for a code from another chain. Sixteen
  tests cover it, four of which encode a real QR code with the project's existing
  `qrcode` dependency, paint it into pixels and decode it with the same call the
  scanner makes — which is how the decoder's CommonJS/ESM interop is pinned down
  without a camera.

### Why the camera was refused while every setting said allow

This one is written down because the app spent three rounds lying to its own
author, and every lie was in a message rather than in the code.

The scanner asked for the camera and was told `NotAllowedError`. The app said, in
turn: "camera access was refused — allow the camera for this site"; then, once it
could ask the browser for its own permission state, "this site is blocked from the
camera in this browser". Chrome's site settings said **Allow**. Chrome's own camera
preview, in that same bubble, showed a working picture. macOS's Camera pane was
fine, and the identical failure appeared in Brave.

The cause was one line in `next.config.ts`, written during the hardening pass — in
which this app still had no camera:

```
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

`camera=()` denies the camera to **every** origin, the document's own included. It
is not a hardening setting, it is a switch that turns the feature off — and a
policy-denied feature does not present as a policy problem. It presents as a
*permission* problem:

- `navigator.permissions.query({ name: "camera" })` answers `denied`;
- `getUserMedia` throws `NotAllowedError`;
- the site's own camera permission stays **granted**, so the browser's site
  settings and its camera preview both look completely correct.

Every setting a person could check said "allow", and nothing they could change
would have helped. What finally named it was
`document.featurePolicy.allowsFeature("camera")`, which answers `false` for a
document its own headers have denied — turning an ambiguous "denied" into an
identified cause:

```
[payload/scanner] the camera would not start — name=NotAllowedError permission=denied
cameras=1 secure=true frame=false policy=false stage=request
origin=http://localhost:3000 code=refused-by-site
```

The fix is `camera=(self)`: this app may use its own camera, no other origin may
use this document's, and an embedded copy cannot inherit it. The microphone and the
location stay closed outright, because nothing here asks for either.

Three things came out of it, which is why it is written down rather than quietly
fixed:

- `next.config.test.ts` reads the real config and asserts the header contains
  `camera=(self)` and never `camera=()`. `tsc` accepted the broken value and
  `next build` shipped it happily; nothing else in the toolchain reads that file.
- The failure copy now checks the **policy** before it checks permissions, framed
  or not, and says plainly when a refusal is set where the page is served rather
  than in a browser — because a policy overrules every permission, so any advice
  about a setting is advice that cannot work.
- `permission: denied` while the site's settings say "allow" is the signature of a
  policy, not of a permission. That is the reading that would have saved the three
  rounds.

### How the Slingshot mark was verified

The home page's backdrop is a trajectory deflected by the letter O — no planet; the
letter is the mass, and what the planet left behind is a faint bloom on the glyph.
The physics is the point, so it is checked rather than eyeballed:
`probes/tmp-arc-geometry.mjs` resolves the SVG arc from the same `d` string the renderer
uses and asserts four things.

- The arc's centre **is** the letter: both resolve to `(300, 160)`, the o's centre
  in the artwork's own coordinates.
- The straight legs are exactly **tangent** to it — the incoming direction `(1, 0)`
  equals the tangent at the start, and `(0, -1)` equals the tangent at the end — so
  the path has one smooth bend and no corner.
- The arc's midpoint sits 45 units from the letter where the chord's midpoint sits
  31.8, so the curve bulges *away* from its own chord: it bends around the letter
  rather than away from it. The path clears the glyph by 19 units where the glyph's
  own radius is 26 — a graze at roughly twice its width.
- The motes stand 100, then 115, then 135 units apart **measured along the path**.

That last one is a trap worth recording. The first version of this check measured
mote gaps as straight lines, and the fourth mote sits on the outgoing leg, where a
straight line undercuts the distance actually travelled — so the check reported a
gap that *shrank* while the artwork did exactly the right thing. A verification
that measures the wrong quantity is worse than none, because it is believed.

The first version of the mark failed the third test: two cubics joined at a point
gave the path an inflection, so it bent one way and then back — a wobble that
resembles no manoeuvre. Flipping the arc's `sweep` flag reintroduces the same
fault, which makes that one character the thing not to touch.

### How the Core husk was verified

The codebase held two opposite beliefs about what a Core burn leaves behind, and
one of them had to be wrong:

- `lib/solana/core-burn.ts` said the program "closes the asset itself and
  returns its rent to the owner".
- `lib/solana/rent.ts` and `lib/solana/liveness.ts` said it "shrinks the account
  to one zero byte instead of closing it", and went to the trouble of pricing and
  filtering that husk.

`probes/tmp-core-husk.mjs` settles it by building the exact instruction the app builds,
simulating it against a real mainnet asset (`simulateTransaction` cannot change
state), and reading the account **after** the simulated transaction:

| | |
|---|---|
| Simulation | `err: null` — the burn would succeed, 10,838 CU |
| Asset account after | still exists |
| Lamports after | **655,320**, down from 1,788,160 |
| Data after | **1 byte, `[0]`** |

So the husk is real, and the second belief was right. The first is fixed in the
comment rather than in code, because the code was correct: nothing in this app
acts on the assumption that a Core account disappears.

**Nothing can close it.** The Core program's instruction set — read from the
installed SDK rather than from memory — is `burn`, `transfer`, `create`,
`execute`, `freeze`, the plugin instructions, and the collection/group
instructions. There is no `close`, and no variant of `burn` that removes the
account. So the residue is stranded, permanently, at roughly 0.000655 SOL per
burned asset.

**Why this matters for a wallet that "still shows" a burned NFT.** A husk is an
account that exists, so anything resolving the asset by account finds it and —
unless it checks the one byte — keeps listing it. That is not an index lag and it
never resolves itself. Spacedust reads the byte (`isCoreHusk`) and filters it,
which is why a Core asset can be gone from this app's grid and still visible in a
wallet. For a cNFT the mechanism is the same but the remnant is different: the
burn replaces the leaf's data and leaves the leaf in the tree, and no rent is
reclaimed for a compressed asset at all.

Two probe errors are worth recording, because both would have produced a wrong
answer if believed. The first built the burn without the asset's collection
account and read `Custom: 25` — a failed simulation, which says nothing about
post-state, but the "account after" field came back null and the probe printed
"GONE → the burn closes it". The second compared a withheld transfer fee to the
string `"0"` when the RPC returns a number. The current script refuses to draw a
conclusion from a failed simulation at all.

### How the NFT burn path was measured against Token Metadata's

The Void used to burn a plain NFT with the SPL Token program — burn the amount,
close the token account — which returns the token account's rent and leaves the
**metadata** and **master edition** accounts alive. Those are the accounts a
wallet's index reads to describe the NFT, so the asset carried on being listed
after it was burned, and their rent stayed on chain.

Token Metadata's SDK also exposes `burnNft`, so `probes/tmp-nft-wipe.mjs` built that
instruction against real mainnet NFTs and read every account **after** the
simulated transaction (read-only: a simulation cannot land):

| Account | After `burnNft` | Rent held |
|---|---|---|
| token account | closed — 0 bytes, 0 lamports | 2,039,280 |
| metadata account | **closed** | 3,733,800 |
| master edition | **closed** | 1,030,080 |
| mint | survives — 82 bytes | 1,461,600 |

Zero bytes *and* zero lamports is how a closed account appears in a simulation
result. So Token Metadata's burn returns three accounts' rent where the SPL path
returned one — **8,264,760 lamports (0.00826 SOL) against 2,039,280** on the
same NFT — and leaves nothing for an index to describe the asset from.

Both branches are verified, because the collection slot is the one account that
differs between them: an NFT **in a collection** needs the collection's metadata
account, and one **without** leaves that slot to the SDK, which marks it absent
by passing the program id — the same sentinel that made a Core burn look
malformed until it was actually simulated. Both simulated clean.

**The Void now takes this route** for plain NFTs, through
`lib/solana/nft-burn.ts`, which passes every account explicitly. If the builder
cannot produce an instruction it falls back to the SPL burn and says so in the
row's warnings: a weaker burn, reported as one rather than performed quietly.
pNFTs already went through Token Metadata; this brings plain NFTs into line.

The mint is the exception and stays that way: only its mint authority can close
it, and that authority is normally given up when an NFT is minted.

Rent is now priced from the accounts a burn actually closes, read in one batched
call, rather than from the rent constant — which was right when a burn closed
exactly one account of a known size, and wrong the moment it closed three.

**A wallet comparison settles who is at fault when a burned asset still shows.**
Reading the same wallet through the same index: Backpack lists only the assets
that were never burned, while Phantom lists the burned ones too — before *and*
after a full reinstall, which rules out a client cache. So the chain state, the
index and the `burnt` flag are all correct, and one wallet simply does not act on
that flag when it builds an owner's asset list. Worth knowing before suspecting a
burn: this app filters the flag itself, which is why a burned asset disappears
here while still showing in a wallet that does not.

Two probe errors are worth recording, because both produced plausible-looking
output. The first omitted the owner's signer slot and got
`MissingRequiredSignature`; the second, with a signature but no collection
metadata account, got `Custom: 103`. In both cases the RPC still returned `null`
for the watched accounts, which this file's earlier version would have printed as
"GONE" — the opposite of what it meant. The current script refuses to interpret
post-state after a failed simulation at all.

### How the burn routes were verified

A burn destroys something irreversibly, so each route was checked against the
chain *before* it was offered. The checks are recorded here rather than assumed:

- **cNFT (Bubblegum, V1 and V2).** Real leaves were simulated on mainnet with
  `sigVerify: false` — five of six clean for V1 across six trees, two of eight
  for V2 — which is where the leaf-index trap, the canopy size ceiling and the
  V2 signer roles were found, not in production. A real cNFT has since been
  burned through the app's own preview → sign → confirm flow.
- **pNFT (Token Metadata).** Ten real pNFTs simulated clean at 619 bytes each,
  collection metadata included — and the first four tried *failed*, all with
  Token Metadata's `LockedToken`, which is how the locked-or-listed precondition
  came to be checked on the row instead of discovered at a wallet prompt. The
  on-chain read that answers it was then validated over **30** more pNFTs: every
  unlocked one simulated clean, every locked one was refused by the program.
- **Core (`mpl-core`) and SPL NFTs.** The instructions were decoded byte by byte
  and simulated on mainnet (`Program log: Instruction: Burn` … success) before
  shipping, and NFT burns have since completed in the browser with their rent
  returned.

Simulation with `sigVerify: false` is what makes this possible without holding
anyone's key: the runtime treats each required signer slot as signed, so an
authority-gated instruction can be exercised and its logs read. The
distinguishing bytes are then asserted in the test suite, so the wiring stays
locked after the fact.

**Standard 5 was hunted and not found — so it stays unverified.** The plumbing
reads each pNFT's token standard from its own metadata and maps 4 and 5
correctly, but a print could not be *found* to test against: 4,088 pNFTs read
from four entire collections (every one standard 4), 550 recent Token Metadata
transactions (no `PrintV1` at all), and a chain-level filter for
`tokenStandard = Some(5)` with a `Some(4)` control proving the offset and
encoding were right. So this build refuses a print with its reason rather than
sending an instruction that has never been exercised.

**And a correction worth keeping.** For one round I concluded a user's failing
NFT was such a print, because Token Metadata's error 6 is `InvalidEditionKey`.
It was not: the program was **Core**, where 6 is `IncorrectAccount`. The number
alone could not tell them apart, and I had guessed at the program instead of
reading it — the same mistake, in the same shape, as the slippage pattern that
matched every program's `Custom: 26`. Failures now name the program they came
from, which is the fix for the class rather than for the instance.

**One bug came out of it backwards.** Testing pNFTs needed their token account,
and DAS returns that for a non-fungible as `token_info.associated_token_address`
— not `token_info.token_accounts`, which it fills only for fungibles. The
scanner read the latter, so every SPL NFT and every pNFT was arriving with no
account at all and being refused as "its token account could not be located",
which read like a scanner failure because it was one. A Core-heavy wallet had
hidden it: those need no token account. Fixed, and the field it should have been
using is now the one documented in the code.

**Two checks were written and then removed on the evidence.** A umi `Pda` turned
out to be a tuple — `[address, bump]` — so `new PublicKey(pda.toString())` was
invalid, the throw was swallowed, and the first version of the on-chain read
silently returned *nothing* for 30 pNFTs: a refusal that never fired. It is now
converted through Metaplex's own adapter, and the read reports 30 of 30. Reading
the *rule set* was dropped for the opposite reason: it flagged all 30 as having
rules while 25 of those same assets simulated a clean burn, and a check that
wrong would block burns that work. Rule-set cases are left to the simulation,
which stops them before anyone signs.

---

## Cost

**Spacedust can run at $0 with no accounts at all.**

- **Core RPC** — the official public endpoint. No signup, no key.
- **Jupiter** — works keyless, or free with a key.
- **Vercel Hobby** — free, and the app fits comfortably.
- **No database** — history lives in `localStorage`.

Adding a **free Helius key** (no card, ~50k credits/day) keeps the cost at $0
while making scans substantially faster and more reliable, because the DAS
indexer sidesteps the per-method rate limit the public endpoint imposes.

Scaling past a few thousand daily users, the things that would actually cost
money are Helius credits and Vercel function invocations, not the architecture.

### Other free alternatives

If you would rather not use Helius at all, the free core-RPC path already covers
it. For more headroom without any account, point
`NEXT_PUBLIC_FALLBACK_RPC_URL` at another free provider — **QuickNode**,
**Alchemy** and **Chainstack** all have free Solana tiers, and the code is
provider-agnostic (it speaks plain JSON-RPC).

A single hosted RPC URL is the one thing you will eventually need for a public
deployment. That is the irreducible cost. Everything else is free.

---

## Scripts

```bash
npm run dev         # dev server
npm run build       # production build
npm run start       # serve the production build
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run test:watch  # vitest, watching
```

## Tests

Type-checking and a green build verify that the code is *coherent*, not that it
is *correct*. Every bug that reached production here was of the other kind: a
build that passed and a number that was wrong — a fee of 2.06% where the UI
promised 1.5%, rent overstated by 37%, an NFT classified as dust and
pre-selected for burning.

Where a rule needed *measuring* rather than reasoning, the script that measured it
is kept in `probes/` — read-only, run by hand, and cited by name wherever the
number appears. `npm test` never calls one: several make dozens of RPC calls and
take minutes. They exist so a claim in this file can be re-checked instead of
taken on trust.

So the suite targets **invariants rather than coverage**, one file per rule that
has already been violated once:

| File | The rule it locks |
|---|---|
| `lib/solana/rent.test.ts` | The Void's fee is a rate on the rent it is given, floored, and never a constant — and a burned Core asset's one-byte husk is priced, so its rent is not claimed as returned |
| `lib/solana/liveness.test.ts` | A missing account is not always a dead asset (a cNFT's id is a leaf, never an account) and a tiny account is not always a live one (a burned Core asset is one zero byte) — and the index's `burnt` flag is believed only when it is literally `true` |
| `lib/sweep/plan-void.test.ts` | The SOL transfer sent on chain is 22,326 lamports — 1.5% of the rent the chain reports, and a frozen token account is refused before a burn is built for it |
| `lib/sweep/summary.test.ts` | Reclaimed rent comes from the plan, and the fee reported is the one actually applied |
| `lib/sweep/void-prompt.test.ts` | "Left behind" means left behind *by this sweep*, not present in the wallet |
| `lib/sweep/phase.test.ts` | Whatever phase a successful `prepare()` settles on is not a busy one |
| `lib/security/instruction-audit.test.ts` | Every instruction a plan produces is checked against the program and the destination it is supposed to touch, so a built plan cannot quietly point somewhere else — and each flow's "accepts" case runs through the real builder the app ships, so a change to an instruction layout fails here rather than at a wallet prompt |
| `lib/solana/submit.test.ts` | An expired blockhash ends the *wait*, not the transaction: nothing is called failed until the chain has been asked, including a transaction an RPC refused after accepting it |
| `lib/sweep/nft-burnability.test.ts` | Anything we cannot build a *correct* burn for is refused, with a reason |
| `lib/sweep/hidden-assets.test.ts` | Hiding is stable and reversible: the list only grows when asked, never duplicates, and an id removed comes back exactly once |
| `lib/sweep/plan-nft-burn.test.ts` | A plain NFT is burned through Token Metadata — one instruction naming the metadata and master edition accounts, so nothing is left for an index to describe the asset from — with the SPL fallback taken, and reported, only when that builder fails; a Core asset goes through the Core program's instruction |
| `lib/sweep/preview.test.ts` | A preview is discarded the moment its selection moves, so the button always describes what will be signed — and that both burn flows are actually wired to that rule |
| `lib/solana/simulate-error.test.ts` | A program's `Custom` code is only named when we have checked *which* program raised it — `17` means `AccountFrozen` from the token program and something else from anything else |
| `lib/solana/compose.test.ts` | The audit is told about every close the composer will make — including the derived-ATA fallback for a holding the scanner could not name, which is the close that used to be reported as one "the plan did not name"; a non-canonical account declares nothing, because nothing is closed |
| `app/api/plan/route.test.ts` | The money path refuses what the app would never send: an owner that is not an address, an output asset outside the SOL/USDC/JUP allow-list, more tokens than a sweep can carry, slippage outside the band, and a swap amount that is not a whole base-unit string — while both a partial amount and the original whole-balance request still parse |
| `lib/solana/cnft-burn.test.ts` | A cNFT burn is Bubblegum's `Burn` with each leaf fact at its own offset and the proof appended — and for V2, `burnV2` with the payer and authority as the signers, not the leaf owner |
| `lib/solana/pnft-burn.test.ts` | A pNFT burn is Token Metadata's `burnV1` with an amount of one, from the account the scan found, asking *only* the owner to sign |
| `lib/sweep/recoverable.test.ts` | The read-only total never promises rent it cannot deliver: frozen, transfer-hooked, fee-charging and unnamed accounts are excluded by reason and counted, an unusable price reads as no price, the native balance is never part of the total, a pool share leaves the promise in value *and* in rent, and a named staking token is counted once as `staked` rather than twice as a pool share |
| `lib/sweep/sweepable.test.ts` | One rule, both screens: a staking token, a pool share, a frozen holding and a transfer-hooked mint are all unsellable — so the sweeper's own list cannot offer to sell what the read-only scan promised a sweep would not touch |
| `lib/sweep/amounts.test.ts` | A partial amount never carries a close: `emptiesAccount` is true only for the exact balance and false one base unit short, `100%` returns the balance and never 99.99% of it, percentages floor rather than round up, an over-balance amount is refused rather than clamped, and a balance past `Number.MAX_SAFE_INTEGER` survives without losing a unit |
| `lib/sweep/pool-positions.test.ts` | Shape is a signal and a market is the verdict: a program-controlled mint is refused only when nothing prices it, a revoked authority is not a program, and a wallet-controlled one never is — the market half exists because Pudgy Penguins is program-controlled, priced, and was wrongly refused |
| `lib/staking/staked-tokens.test.ts` | Every registry mint is a real, well-formed address, none is duplicated, and none is wrapped SOL — which Jupiter's `lst` tag groups in with the rest and which is not staked anything |
| `lib/staking/native-stake.test.ts` | A real mainnet stake account decodes field for field, the state moves through activating → active → deactivating → idle, and a zero field reads as absent rather than as `11111…` — the vault of a 48-byte `Lockup` that put the voter at 124 and not 76 |
| `lib/solana/approvals.test.ts` | An approval is reported only when a real delegate exists, `u64::MAX` is the only thing called unlimited, a self-delegation is not a risk, and a frozen account is kept in the list while being excluded from anything that could be signed |
| `lib/sweep/empty-accounts.test.ts` | An already-empty account is refused by reason — a foreign close authority, withheld fees — while a frozen one is **accepted**, which is the opposite of every other flow here; and no address is ever counted twice, because a second close of the same account fails the whole transaction |
| `lib/solana/close-accounts.test.ts` | Rent is priced only from the accounts that actually made it into a transaction, the compute budget covers the worst packet the byte limit can produce, and a close charges the network fee and nothing else |
| `lib/sweep/asset-labels.test.ts` | Two assets sharing a name are told apart in the grid — and a name that is *not* shared is left exactly as the collection wrote it, because the fix for one unreadable row must not become a suffix on every row in the app |
| `lib/utils/sanitize.test.ts` | Whole units become base units without ever passing through a float — `Number("0.1") * 1e9` is 100000000.00000001, and that hair is the difference between a transfer that empties an account and one that leaves a residue the account can then never be closed for |
| `lib/payload/destination.test.ts` | A destination is an address or a *reason*, never a guess: a scanned code becomes one of the three shapes it can be (with the amount inside a payment request deliberately ignored), the test transfer is 0.001 SOL, and a real QR code round-trips through the project's own encoder and the scanner's own decoder |
| `lib/payload/plan-send.test.ts` | A batch is built only for the destination that was verified, at per-token amounts — and a close is attached only to a send that empties its account, because a close with a residue left in it is refused on chain with `Custom: 11` |
| `lib/payload/preparation.test.ts` | A disabled button is never indistinguishable from a dead one: the gate on Payload's two actions is a pure function of the state, including the combination that started it — assets selected, verification off, both actions correctly available |
| `lib/payload/camera-failure.test.ts` | A camera refusal names *who* refused it: never a browser setting when the browser already allows the camera, never a setting at all when a policy denies it, and never a diagnosis from a question the browser did not answer |
| `lib/salvage/plan-delete.test.ts` | The compute budget for a domain delete is floored rather than sized like a swap's — a real delete measures 1,801 CU, and the priority fee is billed on the budget *requested*, so headroom nobody uses is money spent |
| `lib/sweep/burn-result-copy.test.ts` | The burn report describes the batch, not the tab it was read on: an NFT and a cNFT burned in one transaction are counted and priced separately, so a rent claim can never contradict the asset that just returned its rent |
| `next.config.test.ts` | The response headers allow the camera **to this origin** and never deny it to every origin — `Permissions-Policy: camera=()` made the scanner impossible while every permission setting, and the browser's own camera preview, said "allow" |
| `app/api/rpc/route.test.ts` | Every RPC method the browser reaches for is on the proxy's allow-list — including the ones it never names, because a `*Parsed*` call is a plain call with an encoding, and the route still consults the list |

Every one of these was validated by mutation: reintroducing the original bug and
confirming the suite fails. Two tests are worth calling out because they are
unusual on purpose — `plan-void.test.ts` decodes the packed transaction and
asserts the on-chain lamport amount, and `phase.test.ts` reads the hook sources
to check that no `prepare()` settles on a phase that leaves the UI stuck.

## License

MIT. Not financial advice.
