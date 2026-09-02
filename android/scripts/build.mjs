#!/usr/bin/env node
/**
 * Helper to run the full Android build pipeline:
 *   1) prepare assets (copy sillytavern payload)
 *   2) validate prebuilt libnode.so + headers are present
 *   3) invoke gradle assemble
 *
 * Usage:
 *   node android/scripts/build.mjs [--release] [--no-prepare]
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const androidDir = path.resolve(repoRoot, 'android');

const args = process.argv.slice(2);
const release = args.includes('--release');
const noPrepare = args.includes('--no-prepare');
const variant = release ? 'assembleRelease' : 'assembleDebug';

if (!noPrepare) {
    console.log('=== Preparing assets ===');
    execSync('node android/scripts/prepare-assets.mjs', { stdio: 'inherit', cwd: repoRoot });
} else {
    console.log('Skipping asset prepare (--no-prepare)');
}

// Validate prebuilt libnode.so before packaging – fail early rather than producing broken APK
const libnode = path.join(androidDir, 'app/src/main/jniLibs/arm64-v8a/libnode.so');
const nodeHeader = path.join(androidDir, 'app/src/main/node/include/node/node.h');

if (!fs.existsSync(libnode)) {
    console.error('\nERROR: Prebuilt libnode.so is missing.');
    console.error('');
    console.error('Expected:');
    console.error(`  android/app/src/main/jniLibs/arm64-v8a/libnode.so`);
    console.error('');
    console.error('Run the Node preparation step first:');
    console.error('  npm run android:node:prepare');
    console.error('  # or: node android/scripts/prepare-node-android.mjs');
    console.error('');
    console.error('See android/README.md for details.');
    console.error('The APK build is aborted to avoid producing a broken standalone APK.');
    process.exit(1);
}

if (!fs.existsSync(nodeHeader)) {
    console.error('\nERROR: Node headers (node.h) are missing.');
    console.error('');
    console.error('Expected:');
    console.error(`  android/app/src/main/node/include/node/node.h`);
    console.error('');
    console.error('Run: npm run android:node:prepare');
    process.exit(1);
}

const stat = fs.statSync(libnode);
if (stat.size < 10 * 1024 * 1024) {
    console.error(`\nERROR: libnode.so too small (${stat.size} bytes) – likely not a full Node library.`);
    console.error('Re-run: npm run android:node:prepare -- --force');
    process.exit(1);
}

const fd = fs.openSync(libnode, 'r');
const buf = Buffer.alloc(4);
fs.readSync(fd, buf, 0, 4, 0);
fs.closeSync(fd);
if (buf[0] === 0x4d && buf[1] === 0x5a) {
    console.error('\nERROR: libnode.so is Windows PE (MZ) – cannot run on Android.');
    process.exit(1);
}
if (buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) {
    console.error('\nERROR: libnode.so is not an ELF binary – likely Windows/Linux binary.');
    process.exit(1);
}
console.log(`\n✓ Prebuilt libnode.so validated: ${path.relative(repoRoot, libnode)} (${(stat.size/1024/1024).toFixed(1)} MB, ELF)`);
console.log(`✓ Node headers present: ${path.relative(repoRoot, nodeHeader)}`);

console.log(`\n=== Building APK (${variant}) ===`);
const gradleCmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
try {
    execSync(`${gradleCmd} ${variant}`, { stdio: 'inherit', cwd: androidDir });
    const apkDir = path.join(androidDir, 'app/build/outputs/apk', release ? 'release' : 'debug');
    console.log(`\nBuild complete. APKs in: ${apkDir}`);
    if (fs.existsSync(apkDir)) {
        for (const f of fs.readdirSync(apkDir)) if (f.endsWith('.apk')) {
            const fp = path.join(apkDir, f);
            const mb = (fs.statSync(fp).size / 1024 / 1024).toFixed(1);
            console.log(`  ${f} (${mb} MB)`);
        }
    }
} catch (e) {
    console.error('\nGradle build failed. Ensure Android SDK is installed and local.properties points to it.');
    console.error('  See android/README.md');
    process.exit(1);
}

