# Android shell

The Solana dApp Store needs an installable artefact, and this product is a web
app. `solana-mobile`'s webshell wraps https://spacedust.cc in a WebView with
Mobile Wallet Adapter bridging, so the same code that runs in a mobile browser
runs inside the shell. Nothing in this repository changed to make that work:
`components/wallet/mobile-wallet-adapter.tsx` already registers the
wallet-standard MWA adapter on the web side.

## The artefact

| Property | Value |
|---|---|
| Package | `cc.spacedust.app` |
| Version | 1.0.0, `versionCode` 1 |
| `minSdk` / `targetSdk` | 28 / 37 |
| Size | 2,091,379 bytes |
| Signer | `CN=Spacedust` |
| Certificate SHA-256 | `298d4a7a9c024087b757dc01ac69867931343db275f9818db31fd1667e374674` |
| Permissions | `INTERNET` only |

Verified with `apksigner verify --print-certs` and `aapt2 dump badging` against
the built file, not inferred from a successful build.

## It is a shell, not a snapshot

`SOLANA_MOBILE_URL=https://spacedust.cc/` — the APK contains no copy of the
site. A deploy reaches installed users without a new APK, and a store update is
needed only to bump `versionCode` or change the shell. The trade-off is
symmetric and worth stating: a bad deploy reaches installed users too, and it
cannot be withdrawn by shipping an APK.

## Where it lives

`~/spacedust-apk/spacedust/` — outside this repository, deliberately. The
project is generated rather than hand-written, and the keystore must never be
in git history.

## Toolchain

Installed without sudo, because Homebrew's JDK cask requires it:

| Piece | Location |
|---|---|
| JDK 17 (Temurin 17.0.21+9) | `~/.jdks/jdk-17.0.21+9/Contents/Home` |
| Android SDK, cmdline-tools | `/opt/homebrew/share/android-commandlinetools` |
| build-tools | 36.0.0, installed by Gradle on first build |
| Gradle | 9.7.1, via the project's own wrapper |

SDK licences were accepted once with
`yes | sdkmanager --licenses`, so Gradle installs what a build asks for without
prompting. That is why build-tools 36 appeared even though 35 was installed
first.

## Rebuilding

```sh
cd ~/spacedust-apk
export JAVA_HOME=$HOME/.jdks/jdk-17.0.21+9/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
printf 'Keystore password (from KeePassXC): '
read -rs SOLANA_MOBILE_KEYSTORE_PASSWORD; echo
export SOLANA_MOBILE_KEYSTORE_PASSWORD
export SOLANA_MOBILE_KEY_PASSWORD=$SOLANA_MOBILE_KEYSTORE_PASSWORD
npx solana-mobile@latest webshell build spacedust
```

`read -rs` keeps the password off the screen, out of shell history and off
disk: nothing on this machine stores it, and each new shell asks again. That is
deliberate — the only copy is the attachment in the KeePassXC entry.

The prompt is a separate `printf` rather than `read -p`, because in zsh `-p`
means *coprocess*, not *prompt*: `read -rsp` fails there with `-p: no
coprocess` and leaves the variable empty, and zsh is the default shell on
macOS. Verified in both zsh and bash — the piped-input form reads all seven
characters of a test string in each, and echoes nothing.

Output: `app/build/outputs/apk/release/app-release.apk`.

`build spacedust` takes a directory relative to the current one, so run it from
`~/spacedust-apk`. From inside the project it resolves to
`spacedust/spacedust` and stops with `no twa-manifest.json found`.

A rebuild with no source changes leaves the existing APK alone — Gradle reports
`Built` but never repackages, so nothing is re-signed. Delete the APK to force
one. Doing that produced a file with an identical certificate digest and an
identical size, which is the property that matters: the same key signs every
version, so each one installs as an update.

`gradle.properties` holds the identity of the shell, and is the only file that
needs editing for an update:

```
SOLANA_MOBILE_URL=https://spacedust.cc/
SOLANA_MOBILE_APPLICATION_ID=cc.spacedust.app
SOLANA_MOBILE_VERSION_CODE=1
SOLANA_MOBILE_VERSION_NAME=1.0.0
```

**Every store update needs a higher `SOLANA_MOBILE_VERSION_CODE`.** The
application id must never change: it is what makes the new file an update of
the listed app rather than a second app.

The build is reproducible from this document plus the keystore. The keystore
file lives in the generated project, outside this repository, because builds
read it; the password exists only as an attachment in the KeePassXC entry
titled `Spacedust signing key`. Nothing on disk holds it in plaintext.

## Custody of the signing key

Losing the keystore or its password means the app can never be updated again.
The certificate cannot be regenerated and the application id cannot be
re-registered under a new one.

- The keystore is PKCS12, one entry, alias `spacedust`.
- Two copies, two media: the vault on this machine and an offline copy on
  removable media, both opened and checked rather than assumed. A vault whose
  master password is forgotten is a locked box.
- The offline copy goes stale silently — re-copy it after any change to the
  vault.
- A dApp Store key must differ from any Google Play key, if the app is ever
  listed in both.
- After signing, check the certificate digest against the value above before
  uploading. A mismatch means the wrong key was used, and it would be permanent.

## On a device

Installed over `adb install -r` onto a Galaxy S24 FE running Android 16 and
driven by `adb shell input` with screenshots taken from the device.

- **Launches and renders.** The hero, wordmark, starfield and the saucer's
  textures all drew; the model is textured rather than flat, which is the same
  `blob:` CSP fix that the store screenshots depend on.
- **Touch, scrolling and client-side routing work.** Tapping the hero CTA
  reached `/scan` without a reload, and the typed address carried across to the
  scan page and back to the landing card.
- **The RPC path works from inside the WebView.** A generated address with no
  history returned token accounts 0, empty rent 0, approvals 0, `$0.00`,
  `+0 SOL` and "Read-only result. Nothing is signed." — a real round trip
  through `/api/rpc`, not a cached state.
- **MWA does not appear at all — the shell cannot connect a wallet.** The picker
  lists Phantom, Solflare, Backpack, WalletConnect and Jupiter, and no
  "Mobile Wallet Adapter" row. Phantom, Backpack and Jupiter read "Not
  installed" although `pm list packages` shows `app.phantom`,
  `app.backpack.mobile` and `ag.jup.jupiter.android` on that device, and
  tapping Solflare's "Detected — try connecting" dispatches nothing: the app
  stays foreground and no intent is logged. Every row is a configured extension
  adapter reporting `NotDetected`/`Loadable`; not one Standard-registry wallet
  is in the list.

  The same picker, in Chrome on the same phone, shows the same five rows with
  the same states, so this is the web app's mobile path rather than the wrapper.

  The library explains the first half of it
  (`@solana-mobile/wallet-standard-mobile@0.7.0`, `registerMwa`):

  ```js
  if (getIsLocalAssociationSupported() && (!isWebView(ua) || isSolanaMobileWebShell(ua)))
    registerWallet(new LocalSolanaMobileWalletAdapterWallet(config));
  else … console.warn("MWA not registered: device or environment not supported");
  ```

  A generic WebView gets no wallet unless its user agent carries
  `Solana Mobile Web Shell`. This shell does append exactly that string — the
  debug build logged
  `… Mobile Safari/537.36 Solana Mobile Web Shell`, with `isSecureContext` true
  and `/android/i` matching — so the guard should pass, and the registration is
  being lost somewhere after it. Nothing is logged to say so: this WebView
  forwards console messages to the shell, and a reload produced no MWA warning
  and no console lines at all.

  Consequence: the APK installs, renders and can scan, but
  **cannot sign anything**, which is what it exists for. Do not submit it until
  this is fixed.

### Avast flags it

Avast One raised **"Suspicious app found"** for `cc.spacedust.app` on install,
with detection ID `e6907338984d`, offering an uninstall button. The app was not
blocked and ran normally afterwards.

Nothing in the APK explains it: the only permission is `INTERNET`, and the
detection is not a named family. It is the usual heuristic for an APK that is
self-signed and installed from outside a store — the same reason Play Protect
warns on sideloads. Two things follow:

- Report it as a false positive at
  <https://www.avast.com/false-positive-file-form.php> with that detection ID
  and a link to <https://spacedust.cc>, so the next build's hash is not flagged.
- Distribution through the dApp Store does not exempt the file from these
  heuristics; expect the warning to persist for some users until the vendor
  clears the hash.

## Not yet done

- **Wallet connection is the blocker.** See "MWA does not appear at all" above: the
  shell can scan but cannot sign, so it is not submittable yet. The next step is
  to find where the registration is lost — check that the effect that calls
  `registerMwa` runs at all in this WebView (a temporary `console.log` beside it,
  and the same page in a plain Chrome tab for comparison), then that the
  Standard-registry wallet reaches `useWallet().wallets`
  (`@solana/wallet-adapter-react@0.15.40` merges via
  `useStandardWalletAdapters`, which the provider does rely on).
- **Publisher account and KYC/KYB** for the dApp Store. The assets are covered
  in [listing-assets.md](listing-assets.md).
- **A cosmetic nit:** a thin scrollbar is drawn down the right edge of the
  WebView. It is unobtrusive, but Android renders it persistently where macOS
  fades it out, so it appears in the app and in none of the store screenshots.
