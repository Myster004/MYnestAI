# SillyTavern — Android Embedded Node.js Standalone

Standalone Android APK that bundles **Node.js 20** + the full **SillyTavern** server and hosts it at `http://127.0.0.1:8000` via an embedded WebView. No Termux, no root, no external server needed. Data stays on-device (`/data/data/app.sillytavern.android/files/`).

This mirrors `src/electron/` (Electron wrapper) but for Android: a `foreground Service` runs `node server.js --dataRoot <files>/data` and a `MainActivity` WebView loads the local URL. Lifecycle, logs, and a notification keep the server alive.

## Architecture

```
APK assets/
  sillytavern/        <- copied repo (server.js, src/, public/, node_modules/, default/)
  node/<abi>/bin/node <- per-ABI Node binaries (arm64-v8a, armeabi-v7a, x86_64, x86)

At first launch:
  APK assets -> getFilesDir()  (AssetExtractor.java)
    /data/data/app.sillytavern.android/files/
      sillytavern/server.js
      sillytavern/src/...
      sillytavern/public/...
      sillytavern/node_modules/...   (bundled)
      node/arm64-v8a/bin/node        (chmod +x)
      data/                          (user chats/characters/worlds – NEVER wiped)
      node.log
      .st_installed_version

  NodeService (foreground) spawns:
    node  files/sillytavern/server.js  --dataRoot files/data  --port 8000

  MainActivity:
    Service RUNNING -> WebView.loadUrl("http://127.0.0.1:8000/")
    Pull-to-refresh, back=history, file chooser for uploads
```

**Key files**

* `android/app/src/main/java/app/sillytavern/android/MainActivity.java:1` – WebView host, service binding, file chooser, pull-refresh
* `android/app/src/main/java/app/sillytavern/android/NodeService.java:1` – foreground service, `ProcessBuilder` spawn, health polling, notification
* `android/app/src/main/java/app/sillytavern/android/AssetExtractor.java:1` – APK → filesDir extraction, version check, `chmod +x`
* `android/app/src/main/java/app/sillytavern/android/AppConstants.java:1` – ports/paths constants
* `android/scripts/prepare-assets.mjs:1` – copies repo payload into `assets/sillytavern`
* `android/scripts/download-node.mjs:1` – fetches Bionic Node binaries per ABI

## Prerequisites

* **Node 20+** on build machine (`node -v`)
* **Android SDK** 34, Build-Tools 34, NDK not required (unless rebuilding Node)
* **Java 17** (`java -version`)
* **Gradle 8.7** (or use wrapper `./gradlew`)

Set SDK location:

```bash
cp android/local.properties.example android/local.properties
# edit sdk.dir=/path/to/Android/Sdk
```

On Windows `C:\Users\you\AppData\Local\Android\Sdk` (escape as `C\:\\Users\\you\\...`).

## Quick Start (Debug APK)

```bash
# 1) Install deps (once)
npm install

# 2) Prepare assets – copies repo + node_modules into android/assets
npm run android:prepare
# or: node android/scripts/prepare-assets.mjs

# 3) Fetch Node binaries (Bionic) – needs network
npm run android:node
# or: node android/scripts/download-node.mjs --node-version 20.18.1
# To place your own: copy a Termux `node` binary to
#   android/app/src/main/assets/node/arm64-v8a/bin/node  (chmod +x)

# 4) Build
npm run android:build
# or: cd android && ./gradlew assembleDebug   (or gradlew.bat on Windows)

# APK:
#   android/app/build/outputs/apk/debug/app-debug.apk
# Install:
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Release (signed):

```bash
# Generate keystore once
keytool -genkey -v -keystore android/app/release.keystore -alias st -keyalg RSA -keysize 2048 -validity 10000

# Add to android/gradle.properties or ~/.gradle/gradle.properties:
# MYAPP_RELEASE_STORE_FILE=release.keystore
# MYAPP_RELEASE_KEY_ALIAS=st
# MYAPP_RELEASE_STORE_PASSWORD=***
# MYAPP_RELEASE_KEY_PASSWORD=***

node android/scripts/build.mjs --release
# APK: android/app/build/outputs/apk/release/app-release.apk
```

## NPM Scripts

Added to root `package.json`:

```json
{
  "android:prepare": "node android/scripts/prepare-assets.mjs",
  "android:node": "node android/scripts/download-node.mjs",
  "android:build": "node android/scripts/build.mjs",
  "android:build:release": "node android/scripts/build.mjs --release",
  "android:clean": "rimraf android/app/src/main/assets/sillytavern android/app/build"
}
```

## Universal Device Fit (All Android Models)

Tested matrix: **phones 4.7"–6.8" (320dp–480dp), tablets 7"–12.9" (sw600dp/sw720dp), foldables (horizontal/vertical), ChromeOS, Android 7.0 (API24) → 14 (API34)**. Key fixes for universal fit:

* **ABI splits + universal APK** – `android/app/build.gradle:36` enables `splits.abi` (`arm64-v8a`, `armeabi-v7a`, `x86_64`, `x86`) with `universalApk true` and `bundle { abi { enableSplit true } }`. Per-ABI APK is ~60MB lighter; Play delivers only the device’s ABI. `AppConstants.java:53` / `NodeService.java:152` does ABI fallback (tries primary `SUPPORTED_ABIS[0]` then any bundled ABI then `bin/node`) so ChromeOS (x86 on ARM) still boots.
* **Screen responsiveness** – `res/values/dimens.xml:1` + `values-sw600dp/dimens.xml:1` + `values-sw720dp/dimens.xml:1` scale splash; `layout/activity_main.xml:1` uses `ScrollView+MaterialButton` centered, `layout-land/activity_main.xml:1` splits splash horizontally for short heights (480dp). Edge-to-edge + `WindowInsetsCompat` in `MainActivity.java:1` handles gesture nav / cutouts on all OEM skins (Samsung One UI, MIUI, etc.) and `supports-screens` + `resizeableActivity true` + `configChanges="smallestScreenSize|density"` in `AndroidManifest.xml:17` supports foldables without recreation.
* **OS version compat** – `minSdk 24` with `coreLibraryDesugaring` (`gradle.properties:1`) so Java 17 works on Nougat; `SplashScreen` + `WindowCompat.setDecorFitsSystemWindows` for Android 7–14; `WebSettings` shims (`mixedContentMode` API21+, `forceDark` API29+, `algorithmicDarkeningAllowed` API33+) in `MainActivity.java:88`; legacy `openFileChooser` shim for Samsung/Huawei WebViews (Chrome 60+); `onRenderProcessGone` recovery for low-RAM killers; `POST_NOTIFICATIONS` runtime request on API33+ so foreground notification doesn’t crash on Android 13+.
* **Storage & process** – `AssetExtractor.java:1` checks `StatFs.getAvailableBytes()` vs `MIN_FREE_SPACE_BYTES=350MB` and shows human error on 8GB devices; `NodeService.java:1` does port fallback `8000→8010` for OEMs that reserve 8000, log rotation at `2MB` (`AppConstants.java:31`) for eMMC, and `TMPDIR` writable for native modules.
* **Themes/icons** – `themes.xml:1` + `values-night/themes.xml:1` + `values-v31/themes.xml:1` transparent system bars for edge-to-edge + dark/light + Material You dynamic color; `mipmap-anydpi-v26/ic_launcher.xml:1` vector adaptive icon scales to all densities (mdpi→xxxhdpi).

### BUILD: APK Size

* Bundling `node_modules` adds ~80–180 MB uncompressed (~40–90 MB compressed APK) depending on deps. This is required for **offline standalone**.
* To slim: `node android/scripts/prepare-assets.mjs --no-node-modules` then the APK will need to run `npm install` on device (slow, not recommended).
* `tiktoken`, `vectra` native prebuilds are for glibc; on Android they fall back to wasm/JS. Vectors still work but slower.

### Data Root & Config

* On Android, `COMMAND_LINE_ARGS.dataRoot` is forced to `filesDir/data` via CLI (`server.js:8` → `CommandLineParser:290`).
* `default/config.yaml:3` `dataRoot: ./data` is overridden; `port: 8000`, `listen: false` (loopback only) is intentional.
* User data survives upgrades: `AssetExtractor` deletes only `sillytavern/` + `node/` on version bump, never `data/`.
* Access logs, uploads, vectors go under `data/`.

### Node Binary Details

Android is **Bionic libc**, not glibc – you **cannot** use `nodejs.org/dist/...-linux-arm64.tar.gz` directly (will fail with `not executable`). Valid sources:

1. **nodejs-mobile** releases: NDK-cross-compiled Bionic binaries (preferred). The download script probes `github.com/nodejs-mobile/nodejs-mobile/releases`.
2. **Termux** `nodejs` deb: `packages.termux.dev/apt/.../nodejs_*_aarch64.deb` → `data/data/com.termux/files/usr/bin/node` (Bionic, tested).
3. Manual: compile Node with NDK (`./configure --dest-os=android --dest-cpu=arm64`).

Verify binary on device:

```bash
adb shell /data/data/app.sillytavern.android/files/node/arm64-v8a/bin/node -v
# should print v20.x.x, not "No such file"
```

### WebView Quirks

* `mixedContentMode=ALWAYS_ALLOW`, `allowUniversalAccessFromFileURLs=true` so ST's fetch to `127.0.0.1` works.
* File chooser (`onShowFileChooser`) proxies to system picker for avatar/background uploads.
* External links (`http` outside 127.0.0.1) open in system browser.
* Pull-to-refresh reloads or restarts the service if not RUNNING.

### Permissions

* `INTERNET` – local server + outbound LLM APIs (OpenAI, Claude, etc.).
* `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_DATA_SYNC` – keep Node alive beyond Activity.
* `usesCleartextTraffic=true` – allow `http://127.0.0.1:8000` without TLS.

### Troubleshooting

* **APK builds but crashes at splash “Node binary missing”** → you skipped `android:node`. Place a Bionic `node` at `assets/node/<abi>/bin/node` and rebuild.
* **White screen / WebView ERR_CONNECTION_REFUSED** → Node died. Check `adb logcat -s NodeService MainActivity` and `adb shell cat /data/data/app.sillytavern.android/files/node.log`.
* **“Assets up to date, skipping extraction” but old code** → bump `versionName` in `android/app/build.gradle` or delete `/files/.st_installed_version`.
* **Large file upload fails** → WebView limits, try Chrome Custom Tab via external browser settings in ST.
* **Port 8000 in use** → another instance running. `adb shell am force-stop app.sillytavern.android`.

### Development Loop

```bash
# Fast public-only change (no need to re-prepare assets):
adb push public/scripts/my.js /data/data/app.sillytavern.android/files/sillytavern/public/scripts/my.js
adb shell am force-stop app.sillytavern.android && adb shell am start -n app.sillytavern.android/.MainActivity
```

## Security

* Server binds only to `127.0.0.1:8000` (`listen: false`) – not exposed to LAN.
* `enableUserAccounts` / `whitelistMode` / `basicAuthMode` from `config.yaml` still apply if you enable them.
* CSRF is enabled by default; WebView sends correct cookies.

## Electron Parity

| Feature | Electron (`src/electron/index.js:24`) | Android (`NodeService.java`) |
|---|---|---|
| Load URL | `BrowserWindow.loadURL(appUrl)` | `WebView.loadUrl("http://127.0.0.1:8000")` |
| Start trigger | `serverEvents SERVER_STARTED` | Poll `/` until 200/302 |
| Data dir | `process.cwd()` | `getFilesDir()/data` |
| Notification | OS window | Foreground notification |

## License

Same as SillyTavern: AGPL-3.0.

## TODO / Future

* Split `node_modules` via Play Asset Delivery or download on first run to keep base APK < 150 MB (Play limit).
* Add `android:prepare --minify` to strip `tests/`, `docs`, sourcemaps.
* NDK rebuild of `tiktoken`/`better-sqlite3` for ARM64 Bionic for native speed.
* Backup/restore via SAF (Storage Access Framework).
