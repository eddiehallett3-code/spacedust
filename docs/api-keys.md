# API keys and secrets — inventory and exposure audit

**Date:** 2026-10-18. No secret values are recorded in this file.

## Inventory

| Variable | Scope | Used for | Browser exposure |
|---|---|---|---|
| `HELIUS_API_KEY` | Server-only | Helius RPC/DAS, including the `/api/rpc` proxy | **Not exposed.** Read only in `lib/config/env.ts`; used by API routes and `*.server.ts` modules. |
| `FEE_SPONSOR_SECRET_KEY` | Server-only | The fee sponsor: a hot wallet that pays a user's network fee and is repaid from the rent in the same transaction | **Not exposed.** Read only in `lib/sponsor/config.ts`, which imports `server-only`; never logged, and only the public address is ever returned (`/api/sponsor` GET). Leave unset to disable. |
| `JUPITER_API_KEY` | Server-only | Price, quote and swap-build APIs in `lib/jupiter/server.ts` | **Not exposed.** Attached server-side. |
| `RATE_LIMIT_REDIS_URL` / `RATE_LIMIT_REDIS_TOKEN` | Server-only | Optional shared rate-limit counters (Upstash-compatible) | **Not exposed.** Only `lib/api/rate-limit-store.ts` reads them. |
| `RATE_LIMIT_REDIS_KV_REST_API_URL` / `..._TOKEN` | Server-only | Vercel Upstash integration aliases | **Not exposed.** |
| `UPSTASH_REDIS_REST_URL` / `..._TOKEN` | Server-only | Upstash aliases | **Not exposed.** |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Server-only | Vercel KV aliases | **Not exposed.** |
| `NEXT_PUBLIC_FALLBACK_RPC_URL` | Public | Keyless fallback Solana RPC | **Public by design.** Current value is `https://api.mainnet-beta.solana.com` with no query parameters. Must never contain an API key. |
| `NEXT_PUBLIC_FEE_WALLET` | Public | Solana address that receives the rent fee | **Public by design.** A receiving address, visible on chain anyway. |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | Public | WalletConnect/Reown project identifier | **Public by design.** Project IDs are client-side identifiers, not secrets. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` / `NEXT_PUBLIC_LEGAL_*` | Public | Contact details shown on legal pages/footer | **Public by design.** |
| `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_TWITTER_URL`, `NEXT_PUBLIC_GITHUB_URL` | Public | Branding, canonical URLs, social links | **Public by design.** |
| `CSP_ENFORCE`, `NEXT_DIST_DIR` | Build/server | CSP mode, build directory | **Not exposed.** |
| `VERCEL_OIDC_TOKEN` | Local/Vercel internal | Not read by app code | **Not exposed.** |

There are **no** Stripe, card-payment, email-marketing, analytics, session-replay
or SMS provider keys in the app. Spacedust does not process fiat payments; its
fee is an on-chain SOL transfer.

## Verification performed

- `NEXT_DIST_DIR=.next-audit npm run build` completed successfully.
- Scanned the generated `.next-audit/static` and `.next-audit/server` output for
  the actual values of `HELIUS_API_KEY`, `JUPITER_API_KEY`,
  `RATE_LIMIT_REDIS_TOKEN`, the Upstash/Vercel KV token aliases and
  `VERCEL_OIDC_TOKEN`.
- **Result:** no secret value appeared in any generated file. The only hits for
  `helius-rpc.com/?api-key=` were server chunks (`server/app/api/rpc/route.js`
  and a server chunk), where the key is attached to the upstream request.
- `.env.local` is ignored by git (`.gitignore` rule `.env*.local`).
- `lib/config/env.ts` now imports `server-only`, so an accidental client import
  fails the build instead of silently relying on Next not inlining it.

## Rules to keep it that way

1. Never prefix `HELIUS_API_KEY`, `JUPITER_API_KEY`, the Redis token or any other
   credential with `NEXT_PUBLIC_`.
2. The browser talks to `/api/rpc`; it must never be given a provider URL that
   contains a key.
3. If `NEXT_PUBLIC_FALLBACK_RPC_URL` is changed, verify it has no `api-key`,
   `token` or equivalent query parameter. Put keyed access in a server-only
   variable instead.
4. Do not commit `.env.local`, `.env.production` or Vercel environment dumps.
   Rotate a key immediately if one is ever pasted into a public issue or chat.
5. Keep redaction in `lib/api/redact.ts` around any upstream error that might
   contain a URL with credentials.
