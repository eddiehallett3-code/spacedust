# Security advisories — what is open, and why

**Date:** 2026-10-25. No secret values, no user data.

Dependabot reports **2 high, 4 moderate** on `main`, and `npm audit` lists sixteen
high-severity *packages*. Those are two different numbers because a single
advisory in a deep dependency marks every package above it. Here is the
reduction, so the next person does not re-derive it.

| Advisories actually in the tree | CVSS | Patched? |
|---|---|---|
| `zod` < 4.6.6 — CVE-2023-54404 | 8.2 | **4.6.6+** |
| `bigint-buffer` ≤ 1.1.5 — CVE-2025-3194 | 7.7 | **none exists** |

Everything else the scanner names — `@reown/appkit*`, `@solana/spl-token`,
`@solana/buffer-layout-utils`, `@bonfida/spl-name-service`, `@coinbase/cdp-sdk`,
`abitype` — is one of those two arriving through a dependency chain.

## zod — patched where it matters

The attack: *submit a large array to an application using an array schema without
a length constraint*. Zod accumulates one issue object per failing element with no
cap, so memory growth is unbounded and the process dies. It is a denial of
service against a parser, not a way to reach a wallet.

**Where this app is exposed: nowhere, twice over.**

1. Every array schema in this repo carries a bound. `app/api/plan/route.ts` has
   `.min(1).max(MAX_TOKENS_PER_SWEEP)`; `app/api/asset-proof/route.ts` has
   `.min(1).max(MAX_IDS)`. There is no unbounded `z.array(...)` in `app/` or `lib/`.
2. The copy our own code and `abitype` resolve to is now **4.6.7** — the patched
   release, pinned exactly in `package.json`.

**What remains:** two `zod@3.x` copies, both inside packages that declare
`^3.x` themselves — `@reown/appkit-wallet@1.8.24` (3.22.4) and
`@coinbase/cdp-sdk@1.58.0` (3.25.76, reached only through `@base-org/account` and
the Coinbase Smart Wallet path this app never enables). The 3.x line has no patch
and never will; the fix landed in 4.6.6.

Forcing zod 4 into those two means a major-version override inside the package
that parses WalletConnect session data — the code path that makes signing work.
A version mismatch there does not fail loudly; it fails during a signature. That
trade is not worth taking for a denial-of-service advisory whose precondition
(an unbounded array schema) is not present in any schema this app controls.

## bigint-buffer — accepted, with the reason

`toBigIntLE()` overflows on a crafted buffer and crashes the process. There is no
patched release; the maintainer's last version is the vulnerable one, and the
advisory's own "fixed in" field is empty.

Reached only through `@solana/buffer-layout-utils` (inside `@solana/spl-token`),
which decodes **account data the app fetched from its own RPC proxy**. An attacker
who can serve that data has already compromised Helius or the proxy, at which
point a browser tab crash is the least of it. Impact is availability only —
confidentiality and integrity are untouched, which matters here because the
thing worth protecting is a signature, not uptime.

## Re-checking

```sh
npm audit --omit=dev                     # what the scanner sees
npm ls zod abitype bigint-buffer --all   # where the counts actually come from
```

Two things would change the conclusion above: a **zod 3.x patch** (take it
immediately) or **`@reown/appkit` moving to zod 4** (then the override question
disappears and this file should be updated rather than deleted).

## Also fixed this week, for the record

`next` 15.5.27 → **15.5.28**, closing a **critical**: unauthenticated RCE in the
Image Optimization API via SVG. This app serves remote images through that
optimizer, and `dangerouslyAllowSVG` is off, so the SVG route was closed — the
patch closed the rest. Verified after deploy: the optimizer serves PNGs and
returns 400 for SVG.
