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

**This was attempted, not assumed.** The relevant schema code in
`@reown/appkit-wallet` was inspected first: it uses `z.object` and the
two-argument `z.record(key, value)` form, both valid in zod 4, and none of the
helpers zod 4 removed. Then the overrides were added and npm was run clean:

```
npm error Cannot read properties of null (reading 'edgesOut')
```

npm's resolver crashes when a major-version override crosses a dedupe boundary
here, so the pin could not even be installed consistently — and a package.json
that declares an override the lockfile does not contain is worse than the
advisory, because `npm ci` silently ignores it and the next `npm install` crashes.

## bigint-buffer — accepted, with the reason

`toBigIntLE()` overflows on a crafted buffer and crashes the process. There is no
patched release; the maintainer's last version is the vulnerable one, and the
advisory's own "fixed in" field is empty.

**Verified, not assumed (2026-10-25):**

- npm has published nothing since **1.1.5 on 2019-10-17**; `latest` is still
  1.1.5 and there is no newer tag, prerelease or dist-tag.
- Upstream has **25 open pull requests and 12 open issues** and no release since.
- The advisory lists *Patched versions: None*.

**Forks exist, and were not adopted.** The registry carries several:
`bigint-buffer-fixed@1.1.6` (repo `y3fers0n/bigint-buffer`, maintainer on a
trustwallet.com address), `four-flap-bigint-buffer@1.1.6`,
`@openclawcash/bigint-buffer`, `@gsknnft/bigint-buffer@2.x`,
`@exodus/bigint-buffer`, `@trufflesuite/bigint-buffer@1.1.10`.

The tarballs were unpacked and diffed against 1.1.5. What `bigint-buffer-fixed`
changes is one guard in each direction:

```js
if (!buf || !(buf instanceof Buffer)) {
    return BigInt(0);
}
```

plus removal of the native converter call from the browser build. That is a type
check, not a length check — it does not obviously address the overflow — and it
changes a bad input from an exception into **`0n`**. For a wallet app that is the
wrong trade: a silent zero reads as a zero balance, which is worse than a crash
that says nothing happened. Adopting an unaudited fork to remove an alert, while
making malformed data quieter, is a net loss.

**Why this app cannot hit it anyway.** The vulnerable function is reached only
through `@solana/buffer-layout-utils`, whose `decode` passes the result of a
`blob(length)` layout — a **fixed 8 bytes for `u64`, 16 for `u128`**. The length
is a layout constant, not something account data can influence, so the "crafted
buffer" precondition has no route in from here. In the browser bundle the native
converter is not even loaded, which is the half of the package the advisory
describes.

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
