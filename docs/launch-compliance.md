# Launch compliance checklist

**Date:** 2026-10-18. This is an engineering checklist, not legal advice. Have
the final wording reviewed by a qualified lawyer in the operator's jurisdiction.

## Implemented

- `/privacy` — controller/contact block, data categories, lawful bases,
  third-party processors, cookies/local storage, retention, rights, transfers,
  security, deletion and complaints.
- `/terms` — non-custodial service description, eligibility, user duties, fees,
  third parties, no advice, prohibited uses, IP, warranty/availability,
  liability cap and exclusions, indemnity, governing law.
- `/refund-policy` — on-chain finality, non-refundable network fees, when the
  Spacedust rent fee applies, wrong-address/amount rule, no card chargebacks,
  request process and consumer rights.
- Refund wording at the fee/checkout surfaces: Payload preview, The Void token
  panel, The Void NFT panel, Salvage/rent-reclaim, Slingshot and Approvals.
- `/delete-data` — disconnects the wallet and clears localStorage,
  sessionStorage, accessible cookies, IndexedDB, Cache Storage and service
  workers for this origin. It explains that there is no Spacedust account and
  that on-chain data cannot be deleted.
- Essential-storage notice in the root providers. It is dismissible, stored
  locally, and links to `/privacy`.
- Footer legal links and sitemap entries.
- `docs/privacy-data-map.md` — every third-party service and the data it sees.
- `docs/api-keys.md` — every key/variable and its exposure.

## Launch blockers — supply these before deploying the legal pages

Set these Vercel environment variables (public values, no secrets):

```bash
LEGAL_ENTITY=Spacedust             # project/trading name, or your legal name
LEGAL_EMAIL=                       # monitored privacy/legal mailbox — required
LEGAL_JURISDICTION=England and Wales
LEGAL_ADDRESS=                     # optional for a hobby project
NEXT_PUBLIC_SUPPORT_EMAIL=         # optional general support mailbox
```

For a hobby project based in England, a monitored email is enough for the
privacy contact; a postal address is optional. Add a service/trading address
when operating as a sole trader or company if consumer/trader rules require it.
Do not publish a home address just to fill the field.

The pages show a visible "not configured" warning if `LEGAL_EMAIL` is missing.
Do not launch with that warning visible.

Confirm:

- [ ] `LEGAL_ENTITY` is correct (project name for a hobby; legal/trading name
      once a sole trader or company).
- [ ] The mailbox exists, is monitored, and can receive legal/privacy requests.
- [ ] The governing law and jurisdiction are correct.
- [ ] Counsel has reviewed the privacy policy and terms before the project is
      run as a business; the current wording is a template, not legal advice.
- [ ] The refund wording matches how fees are actually charged on chain. A
      separate refund page is optional if there is no card checkout; a short
      "Fees and refunds" section is enough.
- [ ] If the operator is outside the UK/EU but targets those users, whether an
      Article 27 representative is required.
- [ ] The hosting/RPC/Jupiter/Reown/Upstash processors and their data locations
      are acceptable, with any DPAs in place.
- [ ] No analytics or optional tracker has been added since this review. If one
      is, a real consent control is required first.

## Key audit result

`docs/api-keys.md` records the full inventory. At the time of this checklist:

- `HELIUS_API_KEY`, `JUPITER_API_KEY`, Redis tokens and `VERCEL_OIDC_TOKEN` are
  server-only and were **not found in the generated client bundle**.
- `NEXT_PUBLIC_FALLBACK_RPC_URL` is keyless (public Solana RPC).
- `NEXT_PUBLIC_FEE_WALLET` and `NEXT_PUBLIC_REOWN_PROJECT_ID` are public by
  design; neither is a secret.
- `.env.local` is gitignored.
- `lib/config/env.ts` now imports `server-only`, so a client import fails at
  build time.

## Verification steps

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
2. Open `/privacy`, `/terms`, `/refund-policy`, `/delete-data`; confirm footer
   links, contact block and no missing-contact warning.
3. Clear site data; confirm the storage notice appears once and dismisses.
4. Connect a wallet, run `/delete-data`; confirm the wallet disconnects, local
   preferences/history are gone, and the page reloads.
5. Open each fee preview; confirm the refund sentence is visible next to the fee,
   not only in the footer.
6. Re-run the client bundle key scan if any dependency or env variable changes.

## Notes

- There is no Spacedust account, so "delete my account" is implemented as
  "disconnect and delete local data." If accounts are added later, a server-side
  deletion endpoint and retention job will be required.
- The cookie notice is a transparency notice for strictly necessary storage, not
  a consent gate, because there are no optional analytics/advertising trackers.
  Revisit if analytics is added.
- This checklist and the pages are templates; legal review is still required.
