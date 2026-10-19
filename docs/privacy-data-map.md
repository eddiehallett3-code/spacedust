# Privacy data map — third-party services

**Date:** 2026-10-18. This is the list behind `/privacy`; update both together.

## Summary

Spacedust has no account, signup, email list, analytics SDK, advertising pixel,
session-replay tool, payment processor or marketing platform. It never asks for a
private key or seed phrase. The data it handles is public wallet/transaction data,
ordinary request metadata, local browser preferences, and optional support email.

## Services

| Service | Where it runs | Data it receives | Purpose |
|---|---|---|---|
| **Helius** | Server routes → Helius RPC/DAS | Wallet address, token/NFT account data, public balances, transaction data, request metadata | Scan holdings, read accounts, simulate/submit/confirm |
| **Public Solana RPC** (fallback when Helius is unset) | Server route → public RPC | Same public wallet/transaction data | Fallback chain access |
| **Jupiter** | Server routes → Price/Swap APIs | Mints, amounts, owner/taker wallet address, slippage, quote/build inputs | Prices, routes, swap instructions, token metadata |
| **Jupiter CDN / token image hosts** | Browser image requests | IP address, user agent, image URL; no referrer | Display token/NFT logos |
| **Reown / WalletConnect** | Browser → relay | Wallet address, connection/session metadata, IP/relay metadata | Connect a mobile or WalletConnect wallet |
| **Vercel** | Hosting/CDN/serverless | IP address, user agent, URL, timestamps, error logs | Serve the site, run API routes, security/logging |
| **Upstash / Vercel KV** (optional) | Server → Redis HTTP endpoint | Counter key containing IP address + route; no request body or wallet address; 60-second expiry | Shared rate limiting |
| **Wallet apps** (Phantom, Solflare, Backpack, Jupiter, etc.) | User's wallet | Whatever the wallet itself collects; Spacedust never receives keys | Sign transactions |
| **Solscan** | Outbound link only | Receives a request only when the user clicks a transaction link | Block explorer |
| **X / GitHub** | Outbound footer links only | Receive a request only when the user clicks the link | Social/source links |

Not used: Google Analytics, Vercel Analytics, PostHog, Sentry, Mixpanel, Segment,
Hotjar, Microsoft Clarity, FullStory, advertising pixels, email marketing, card
payment processors, KYC providers.

## Local browser storage

`STORAGE_KEYS` in `lib/utils/constants.ts` is the source of truth:

- dust threshold
- output asset
- smart-filter setting
- sweep history
- hidden assets
- local sweep tally (wallets and USD)
- dismissed cookie/storage notice

Reown/AppKit may additionally store its WalletConnect session and key material in
`localStorage` or IndexedDB under its own keys. All of it is cleared by the
`/delete-data` flow, which also disconnects the wallet and clears caches/cookies
for this origin.

## Retention

- Local browser data: until the user clears it.
- Rate-limit counters: 60 seconds.
- Hosting/error logs: according to Vercel's configuration, then deleted or
  aggregated; no separate analytics database.
- Support email: as long as needed to answer and meet legal obligations.
- On-chain data: public and permanent; cannot be deleted.

## Notes for counsel

- Confirm whether a UK/EU representative is required if the operator is not
  established there.
- Confirm the legal entity, registered/postal address, monitored privacy mailbox
  and governing law. These are environment variables and are intentionally blank
  until supplied; the legal pages show a visible "not configured" state rather
  than inventing details.
- If analytics or any optional tracker is added, the storage notice must become a
  real consent control before it ships, and this map and the privacy policy must be
  updated first.
