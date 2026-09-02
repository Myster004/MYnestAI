# SillyTavern — Android Embedded Node.js (prebuilt libnode.so)

Standalone Android APK (ARM64) that bundles a **prebuilt Node.js** via `libnode.so` + a JNI bridge, plus the full **SillyTavern** server, and hosts it at `http://127.0.0.1:8000` via an embedded WebView. No Termux, no root, no WSL, no source compilation needed. Data stays on-device (`/data/data/app.sillytavern.android/files/`).

## Architecture

```
APK
 ├── jniLibs/arm64-v8a/libnode.so          <- prebuilt Node.js shared library
 ├── libnative-node.so                      <- small JNI bridge (calls node::Start)
 ├── assets/sillytavern/                    <- SillyTavern web app + node_modules
 └── assets/nodelibs/                       <- (optional) dependent .so files

At first launch (AssetExtractor):
  assets/sillytavern -> files/sillytavern
  assets/nodelibs    -> files/nodelibs   (optional extras)

NodeService loads libnode.so via NativeNode (System.loadLibrary)
and runs `node server.js --dataRoot files/data --port 8000` in the
SillyTavern working directory using the embedded JNI bridge.
MainActivity's WebView loads http://127.0.0.1:8000/.
```

**Native Node source (prebuilt, ARM64 Android):**

* `gmaclennan/nodejs-mobile` — Node.js **24.18.0** (mobile rev `-0`), tag `v24.18.0-0`
* Library: `libnode.so` — placed at `android/app/src/main/jniLibs/arm64-v8a/libnode.so`
* Headers: matching `node.h` + friends at `android/app/src/main/node/include/node/`
* Does **not** compile Node, does **not** run `make`/`icupkg`, works from Windows or Linux.
* Uses `node::Start(argc, argv)` (see `node.h`).

**Key files**

* `android/app/src/main/cpp/native-node.cpp:1` – JNI bridge calling `node::Start(argc, argv)`
* `android/app/src/main/cpp/CMakeLists.txt:1` – imports prebuilt libnode.so, builds native-node
* `android/app/src/main/java/app/sillytavern/android/NativeNode.java:1` – Java wrapper, loads libnode + native-node
* `android/app/src/main/java/app/sillytavern/android/NodeService.java:1` – foreground service, starts embedded Node
* `android/app/src/main/java/app/sillytavern/android/AssetExtractor.java:1` – APK → filesDir extraction
* `android/app/src/main/java/app/sillytavern/android/AppConstants.java:1` – ports/paths constants
* `android/scripts/prepare-node-android.mjs:1` – downloads+places prebuilt libnode.so + headers
* `android/scripts/validate-node-android.mjs:1` – validates ARM64 Android ELF + headers
* `android/scripts/prepare-assets.mjs:1` – copies repo payload into `assets/sillytavern`

## Prerequisites

* **Node 20+** on build machine (`node -v` – used by the prepare/validate scripts).
* **Android SDK** 34, Build-Tools 34, **CMake 3.22.1**, **JDK 17**.
* **Gradle Wrapper 8.7** – included (`android/gradlew`, `android/gradlew.bat`).
* **No NDK/source build needed** for the Node runtime (it's prebuilt). An NDK is only
  needed if you rebuild the JNI bridge from `cpp/` (AGP bundles a default NDK for CMake).

## Quick Start (Debug APK, ARM64)

```bash
# 1) Install deps (once)
npm install

# 2) Prepare assets – copies repo + node_modules into android/assets
npm run android:prepare

# 3) Prepare prebuilt Node.js (libnode.so + headers) – downloads from gmaclennan/nodejs-mobile
npm run android:node:prepare

# 4) Validate (optional but recommended)
npm run android:node:validate

# 5) Build – fails early if libnode.so is missing/invalid
npm run android:build
# or: cd android && .\gradlew.bat assembleDebug

# APK:
#   android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Release (signed):

```bash
keytool -genkey -v -keystore android/app/release.keystore -alias st -keyalg RSA -keysize 2048 -validity 10000
# add release signing to android/gradle.properties or ~/.gradle/gradle.properties
node android/scripts/build.mjs --release
```

## NPM Scripts

Added to root `package.json`:

```json
{
  "android:prepare": "node android/scripts/prepare-assets.mjs",
  "android:node:prepare": "node android/scripts/prepare-node-android.mjs",
  "android:node:validate": "node android/scripts/validate-node-android.mjs",
  "android:build": "node android/scripts/build.mjs",
  "android:build:release": "node android/scripts/build.mjs --release",
  "android:clean": "node -e \"import('node:fs').then(fs=>{ fs.rmSync('android/app/src/main/assets/sillytavern',{recursive:true,force:true}); fs.rmSync('android/app/build',{recursive:true,force:true}); console.log('cleaned'); })\""
}
```

## ABI

* Only **arm64-v8a** is supported (the prebuilt libnode.so is ARM64 Android).
* `android/app/build.gradle` sets `ndk { abiFilters 'arm64-v8a' }`.
* Other ABIs (x86, x86_64, armeabi-v7a) are not bundled – the APK targets modern ARM64 phones.

## How the embedded Node is loaded & started

1. `NativeNode.java` runs `System.loadLibrary("node")` then `System.loadLibrary("native-node")`.
   - `libnode.so` and dependent libs live in the app's `nativeLibraryDir` (from `jniLibs`).
   - If extra libs are needed, they're placed under `assets/nodelibs/` and copied to
     `files/nodelibs` by `AssetExtractor` (Android linker picks them up via `dlopen`'s
     search path once copied to a known dir).
2. `NodeService` (foreground service) extracts `assets/sillytavern` to `files/sillytavern`.
3. It builds the Node argv: `[server.js, --dataRoot, files/data, --port, <port>]`.
4. `NativeNode.startNodeAsync(argv, cwd, callback)` runs `node::Start(argc, argv)` on a
   daemon thread (working directory = `files/sillytavern`).
5. The app polls `http://127.0.0.1:<port>/` until it returns 200/302, then loads the WebView.

## GitHub Actions

`android/scripts` + `.github/workflows/build-node-android.yml` were replaced:
the old workflow compiled Node 20.18.1 from source (which failed at the ICU
`icupkg` step with "Exec format error"). The new workflow:

1. Checks out MYnestAI
2. Runs `npm run android:node:prepare` → downloads prebuilt libnode.so + headers
3. Runs `npm run android:node:validate` → checks ELF64 / AArch64 (**without executing** it on the x64 host)
4. `npm install` + `npm run android:prepare`
5. `./gradlew assembleDebug`
6. Uploads the APK

This never compiles Node, never runs `make` or ICU tools, and never executes an
Android binary on the Linux host.

## Troubleshooting

* **Build fails: "libnode.so is missing"** → run `npm run android:node:prepare`.
* **"libnode.so too small / not ELF"** → the prebuilt download was wrong/corrupt; delete
  `android/app/src/main/jniLibs/arm64-v8a/libnode.so` and re-run `npm run android:node:prepare -- --force`.
* **White screen / ERR_CONNECTION_REFUSED** → embedded Node didn't start. Check
  `adb logcat -s NodeService NativeNode MainActivity`.
* **"Assets up to date, skipping extraction" but old code** → bump `versionName` in
  `android/app/build.gradle` or delete `/files/.st_installed_version`.
* **Port 8000 in use** → another instance running. `adb shell am force-stop app.sillytavern.android`.

## License

Same as SillyTavern: AGPL-3.0.

## TODO / Future

* Optional Play Asset Delivery to keep base APK < 150 MB.
* `android:prepare --minify` to strip `tests/`, `docs`, sourcemaps.
* Evaluate embedding a lighter `lite` nodejs-mobile flavor if size matters.
