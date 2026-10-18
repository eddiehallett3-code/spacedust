# Security policy

Spacedust is a non-custodial Solana wallet tool. It builds transactions in the
browser and asks your wallet to sign them: it never asks for a private key or a
seed phrase, holds no keyring, and cannot move funds on its own.

## Reporting a vulnerability

Please use GitHub's private reporting, not a public issue:

**https://github.com/eddiehallett3-code/spacedust/security/advisories/new**

If that page is unavailable, open an issue saying only *"security report — please
contact me"*; I will reply with a private channel. Do not put the details in the
issue.

What helps most: what you did, what happened, the request or transaction you saw,
and which flow it was (Slingshot, The Void, Payload, close, revoke, scan). A
minimal reproduction or a failing test is better than prose.

## In scope

- **The instructions a transaction is built from**, and the audit that checks
  them — anything that could make a signed transaction do something the preview
  did not describe.
- **The API routes** — `/api/plan`, `/api/tokens`, `/api/rpc`, `/api/asset-proof`,
  `/api/health` — key leakage, SSRF, unauthenticated spend, or a way around the
  budgets.
- **The fee and rent arithmetic** — a figure the user is shown, or a transfer that
  does not match the rule it claims to apply.
- **The origin boundary** — anything that lets another site act as this app, or
  lets this app act on another origin's behalf.

## Out of scope

- Vulnerabilities in Solana, Jupiter, Helius, Reown/WalletConnect or a wallet
  extension itself. Those belong upstream; I will happily help route a report.
- Anything that requires the user's private key, a malicious extension, or a
  compromised device.
- Rate-limit observations against a personal deployment. The budgets are
  documented in the README and fail open by design; the shared counter is the
  part that holds.

## What to expect

Best effort, from one person. I aim to acknowledge within a few days and to ship
a fix or a clear explanation as quickly as I can. There is no bug bounty.

## Supported version

The deployed site at `spacedust.cc`, built from `main`. Older commits are
history, not releases.

## Never share these

No one from Spacedust will ask for a seed phrase, a private key, or a signature
over chat, email or social media. The `/security` page says the same and names
the only account this project posts from.
