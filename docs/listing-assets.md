# Store listing assets

Everything a wallet directory or the Solana dApp Store asks for, served from
`public/press/` so a submission form can be given a URL instead of an
attachment.

| File | Size | Format | Use |
|---|---|---|---|
| [`banner-1200x600.png`](https://spacedust.cc/press/banner-1200x600.png) | 1200×600 | PNG | Solana dApp Store banner; Phantom/Solflare headers |
| [`screenshot-1-landing.jpg`](https://spacedust.cc/press/screenshot-1-landing.jpg) | 1080×3120 | JPEG | Hero **and** the wallet scan entry point below it |
| [`screenshot-1b-landing-9x16.jpg`](https://spacedust.cc/press/screenshot-1b-landing-9x16.jpg) | 1080×1920 | JPEG | The same hero at 9:16, for stores that insist on it |
| [`screenshot-2-scan.jpg`](https://spacedust.cc/press/screenshot-2-scan.jpg) | 1080×1920 | JPEG | Read-only scan |
| [`screenshot-3-salvage.jpg`](https://spacedust.cc/press/screenshot-3-salvage.jpg) | 1080×1920 | JPEG | Salvage tools before connecting |
| [`screenshot-4-slingshot.jpg`](https://spacedust.cc/press/screenshot-4-slingshot.jpg) | 1080×1920 | JPEG | Batch swap |
| [`screenshot-5-security.jpg`](https://spacedust.cc/press/screenshot-5-security.jpg) | 1080×1920 | JPEG | Security posture |
| [`screenshot-6-how-it-works.jpg`](https://spacedust.cc/press/screenshot-6-how-it-works.jpg) | 1080×1920 | JPEG | How it works |
| [`screenshot-7-payload.jpg`](https://spacedust.cc/press/screenshot-7-payload.jpg) | 1080×1920 | JPEG | Batch send to one address |
| [`screenshot-8-void.jpg`](https://spacedust.cc/press/screenshot-8-void.jpg) | 1080×1920 | JPEG | Sending or burning what has no market |
| [`screenshot-9-approvals.jpg`](https://spacedust.cc/press/screenshot-9-approvals.jpg) | 1080×1920 | JPEG | Token approvals and what can be revoked |
| [`background-3840x2160.png`](https://spacedust.cc/press/background-3840x2160.png) | 3840×2160 | PNG | The site's own backdrop, stars included — master for publicity images |
| [`background-1920x1080.png`](https://spacedust.cc/press/background-1920x1080.png) | 1920×1080 | PNG | Same backdrop at HD |
| [`background-2400x1200.png`](https://spacedust.cc/press/background-2400x1200.png) | 2400×1200 | PNG | Wide social header / blog hero |
| [`background-1200x630.png`](https://spacedust.cc/press/background-1200x630.png) | 1200×630 | PNG | Open Graph card ratio |
| [`background-clean-1920x1080.png`](https://spacedust.cc/press/background-clean-1920x1080.png) | 1920×1080 | PNG | Same wash with no stars, for laying type over |
| [`space-subtle-1920x1080.png`](https://spacedust.cc/press/space-subtle-1920x1080.png) | 1920×1080 | PNG | The page's own backdrop with the vignette eased a little |
| [`space-1920x1080.png`](https://spacedust.cc/press/space-1920x1080.png) | 1920×1080 | PNG | **Stars and a faint hue of space** — the publicity default |
| [`space-3840x2160.png`](https://spacedust.cc/press/space-3840x2160.png) | 3840×2160 | PNG | The same, at 4K |
| [`space-rich-1920x1080.png`](https://spacedust.cc/press/space-rich-1920x1080.png) | 1920×1080 | PNG | The same, a little more glow and star density |

### Tool icons

`public/press/icons/` holds one mark per tool — `icon-<tool>.svg` and
`icon-<tool>-512.png`, in white and in `-ink` (near-black) for light layouts.
They are exported by `scripts/make-tool-icons.mjs`, which reads the path data
straight out of `components/layout/tool-emblem.tsx` rather than keeping a second
copy of the curves:

```
node scripts/make-tool-icons.mjs
```

Run it after editing an emblem. A redraw would drift from the page; this cannot.

Icon: https://spacedust.cc/dapp-icon-v7-512.png (512×512, `#000000`, opaque,
truecolour) — the flat-black tile. It is also what the site serves as its favicon,
Apple touch icon and manifest icon, so a directory listing and the browser tab show
the same artwork.

The `v6` set is the other tile: the app's own surface (`space-850` #0a0d1f under
the two body washes), which reads as a lit window on a dark sheet. Measured mean
luminance: **v6 29.0, v7 8.1** out of 255. That 8.1 is a number this project has
been bitten by before — the v2 black tile measured 8.6 and "read as an empty square
in a wallet list", which is why v6 exists. So v7 is the right tile for anything on a
white background — a directory page, a tab strip, an iOS home screen — and the wrong
one for the wallet handshake, where the icon is drawn small on a dark sheet and
keeps `/dapp-icon-v6-256.png`, `-128` and `-96`. Both sets exist at 512, 256, 192,
180, 128, 96, plus a 512 maskable with the mark inset to the safe area.

The `v3` filenames (`/dapp-icon-v3-512.png` and its siblings) serve byte-identical
artwork, because those URLs are already in the listing emails sent to Phantom,
Jupiter, Solflare and Backpack — one brand in circulation rather than two. The
wallet handshake files are truecolour, no palette, no alpha, each far under any size
cap, because the first three attempts were refused by wallets for exactly those
reasons.

## Requirements this covers

- **Solana dApp Store** — 512×512 icon, 1200×600 banner, 4–8 screenshots. All
  present. Submission also needs KYC/KYB, a signed APK and a publisher account;
  the assets are the part this repository can supply.
- **Phantom / Solflare / Backpack** — no published size rules. The 1200×600
  banner and the screenshots above are the usual shape of what an editor asks
  for, and each one is a link rather than an attachment.

## How they were produced

- **Screenshots:** `node scripts/capture-store-shots.mjs` against the production
  deployment. It drives Chrome over the DevTools Protocol — mobile emulation at
  540×960 with `deviceScaleFactor: 2`, ANGLE **Metal** for the real GPU, a clip
  so each file is 1080 wide with no post-processing, and a wait on the app's own
  readiness signal rather than a stopwatch. Dark UI, mean luminance 14–24/255.
- **The saucer's textures had never loaded in production.** The GLB carries four
  WebP textures, and three's GLTFLoader hands embedded images to
  ImageBitmapLoader through a `blob:` URL — which `connect-src` blocked. The
  console said `THREE.GLTFLoader: Couldn't load texture blob:…` and the model
  still drew, untextured, so nothing looked broken enough to investigate. Fixed
  by allowing `blob:` in `connect-src` (`lib/security/csp.ts`, pinned by
  `csp.test.ts`). Before the fix the saucer's bounding box measured 0.0% bright
  pixels and 198 distinct colours; after, 6.2% and 1,611.
- **Software WebGL is not good enough.** `--use-gl=angle --use-angle=swiftshader`
  renders this model flat even with the textures loading, and `--disable-gpu`
  removes the scene entirely: `components/landing/ufo-model.tsx` treats a failed
  `WebGLRenderer` constructor as "this visitor cannot have the model" and stays
  quiet by design. That is how the first version of these files was made.
- **No wallet was connected** for any capture. That is deliberate: no balance,
  address or holding of any real wallet appears in a public listing, and the
  states shown are the ones a first-time visitor sees.
- **Banner:** the app's own background, not a new one. `space-950` (`#04050c`)
  under the two washes `app/globals.css` puts on `body` — violet-deep at 22%
  from `50% -10%`, cyan-core at 10% from `90% 10%` — plus the hero's violet glow
  and a starfield built to the rules in
  `components/layout/starfield-background.tsx`: same four tints
  (`#e2e8ff #bae6fd #ddd6fe #ffffff`), radius and alpha derived from depth the
  same way, same density of one star per 9,000 px² (80 at this size), same faint
  halo on the nearest few. Measured against a background-only crop of
  `screenshot-1-landing.jpg`: 15.3/16.3/30.5 against 18.5/19.0/37.4.
  - **Wordmark only.** The banner is the wordmark, not the mark: an earlier
    version stacked `logo-mark.png` above it, which printed the saucer twice.
    `public/logo-text-transp.png` is the lockup the header carried at the time, and
    is kept because this recipe names it — the header itself now renders
    `public/logo-header-text-transp.png`, a straight copy of
    `Logo/header logo text.png` (1422 × 198, already transparent, ink 1332 × 138
    inset by about 14% above and below). The banner and the store screenshots
    still show the previous wordmark; re-run the capture below before a listing
    is submitted again.
  - **No meteor,** though the app draws them: a meteor is a motion cue, and
    frozen in a still it reads as a scratch on the artwork.
- Verified after generation: the clip is 540×960 or 540×1560 CSS at 2×, so every
  file is 1080 wide and nothing is upscaled; the saucer's box carries 5.4%
  bright pixels (textures decoded) and the scan card below the hero carries ink
  of its own rather than an empty band; and the banner's three text blocks all
  measure centred on x=600.

## Regenerating

```sh
# screenshots: fresh captures from production, straight into public/press/
node scripts/capture-store-shots.mjs

# add or redo one tool without refilming the set (matches on filename)
ONLY=payload,void node scripts/capture-store-shots.mjs

# point it somewhere else (a preview build), or at another Chrome
node scripts/capture-store-shots.mjs http://localhost:3000
CHROME_PATH=/path/to/chrome node scripts/capture-store-shots.mjs
```

A full run rewrites every file, so it is the wrong tool for adding one shot: the
images already published to wallets keep the bytes they were sent with unless you
ask for them by name.

The script reports the page's own console errors next to each file. Treat any
line starting `!` as a failed capture and investigate before publishing it —
that is how the missing textures were found.

The banner is not scripted in this repository; its recipe is the "Banner"
bullet above: `space-950` base, the two body washes, the hero glow, the same
starfield distribution, the wordmark at 780px wide centred on x=600 at y=168,
the tagline at 32px all-caps on y=352, and the fee line at 20px on y=400.

The 25 s budget is for the landing page specifically: three.js is imported
inside an effect and the saucer is a ~1.8 MB GLB, so a shorter budget captures
the empty stage. Every other screen settles in a few seconds.

Re-run whenever a tool's first screen changes — a listing that shows a screen
the app no longer has is worse than one with fewer screenshots.

## Copy for the submission

> **Spacedust** — https://spacedust.cc
> Non-custodial Solana wallet tools: batch-swap dust in as few transactions as
> the 1232-byte limit allows, send or burn what has no market left, batch-send a
> wallet's contents to one address, reclaim rent from empty accounts, revoke
> stale approvals, and scan any address read-only. 1.5% of the rent returned;
> swaps are free. No key ever leaves the user's wallet.

The copy above is the short version of what [submission-pack.md](submission-pack.md)
holds — the same description at four lengths, plus the field-by-field answers and
the list of directories to send it to.
