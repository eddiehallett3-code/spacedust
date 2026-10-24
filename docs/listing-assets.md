# Store listing assets

Everything a wallet directory or the Solana dApp Store asks for, served from
`public/press/` so a submission form can be given a URL instead of an
attachment.

| File | Size | Format | Use |
|---|---|---|---|
| [`banner-1200x600.png`](https://spacedust.cc/press/banner-1200x600.png) | 1200×600 | PNG | Solana dApp Store banner; Phantom/Solflare headers |
| [`screenshot-1-landing.jpg`](https://spacedust.cc/press/screenshot-1-landing.jpg) | 1080×1920 | JPEG | Landing page |
| [`screenshot-2-scan.jpg`](https://spacedust.cc/press/screenshot-2-scan.jpg) | 1080×1920 | JPEG | Read-only scan |
| [`screenshot-3-salvage.jpg`](https://spacedust.cc/press/screenshot-3-salvage.jpg) | 1080×1920 | JPEG | Salvage tools before connecting |
| [`screenshot-4-slingshot.jpg`](https://spacedust.cc/press/screenshot-4-slingshot.jpg) | 1080×1920 | JPEG | Batch swap |
| [`screenshot-5-security.jpg`](https://spacedust.cc/press/screenshot-5-security.jpg) | 1080×1920 | JPEG | Security posture |
| [`screenshot-6-how-it-works.jpg`](https://spacedust.cc/press/screenshot-6-how-it-works.jpg) | 1080×1920 | JPEG | How it works |

Icon, unchanged and already in use: https://spacedust.cc/dapp-icon-v3-512.png
(512×512, opaque).

## Requirements this covers

- **Solana dApp Store** — 512×512 icon, 1200×600 banner, 4–8 screenshots. All
  present. Submission also needs KYC/KYB, a signed APK and a publisher account;
  the assets are the part this repository can supply.
- **Phantom / Solflare / Backpack** — no published size rules. The 1200×600
  banner and the screenshots above are the usual shape of what an editor asks
  for, and each one is a link rather than an attachment.

## How they were produced

- **Screenshots:** headless Chrome against the production deployment at a
  540×960 phone viewport with `--force-device-scale-factor=2`, so each is
  1080×1920 with real text rendering, then converted to JPEG (quality 86,
  4:4:4, no chroma loss on UI text). Dark UI, mean luminance 14–24/255.
- **No wallet was connected** for any capture. That is deliberate: no balance,
  address or holding of any real wallet appears in a public listing, and the
  states shown are the ones a first-time visitor sees.
- **Banner:** flat vector gradient plus the real wordmark from
  `public/logo-mark.png`, so it stays sharp at any size a store scales it to.
- Verified after generation: every screenshot is 1080×1920 and carries
  0.5–1.0% bright text pixels (i.e. rendered, not blank), and the banner's
  text strip is non-empty.

## Regenerating

```sh
# screenshots: fresh captures from production
CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=540,960 \
  --virtual-time-budget=12000 --screenshot=/tmp/shot.png https://spacedust.cc/scan
```

Re-run whenever a tool's first screen changes — a listing that shows a screen
the app no longer has is worse than one with fewer screenshots.

## Copy for the submission

> **Spacedust** — https://spacedust.cc
> Non-custodial Solana wallet tools: batch-swap dust in as few transactions as
> the 1232-byte limit allows, send or burn what has no market left, reclaim
> rent from empty accounts, revoke stale approvals, and scan any address
> read-only. 1.5% of reclaimed rent; swaps are free. No key ever leaves the
> user's wallet.
