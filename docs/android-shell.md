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
cd ~/spacedust-apk/spacedust
export JAVA_HOME=$HOME/.jdks/jdk-17.0.21+9/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export SOLANA_MOBILE_KEYSTORE_PASSWORD=$(cat ~/.spacedust-signing/keystore-password.txt)
export SOLANA_MOBILE_KEY_PASSWORD=$SOLANA_MOBILE_KEYSTORE_PASSWORD
npx solana-mobile@latest webshell build spacedust
```

Output: `app/build/outputs/apk/release/app-release.apk`.

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

The build is reproducible from this document plus the keystore. Neither the
keystore nor its password is in this repository; both are in a KeePassXC entry
titled `Spacedust signing key`.

## Custody of the signing key

Losing the keystore or its password means the app can never be updated again.
The certificate cannot be regenerated and the application id cannot be
re-registered under a new one.

- The keystore is PKCS12, one entry, alias `spacedust`.
- Back up to two places: the password manager and an offline copy. A vault whose
  master password is forgotten is a locked box.
- A dApp Store key must differ from any Google Play key, if the app is ever
  listed in both.
- After signing, check the certificate digest against the value above before
  uploading. A mismatch means the wrong key was used, and it would be permanent.

## Not yet done

- **No device or emulator has run this APK.** It builds, signs and declares the
  right package, version, label, icon and permissions; whether the shell loads
  the site and completes an MWA handshake on real hardware is unverified.
- **Publisher account and KYC/KYB** for the dApp Store. The assets are covered
  in [listing-assets.md](listing-assets.md).
