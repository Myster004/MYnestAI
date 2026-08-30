#!/usr/bin/env node
/**
 * Helper to run the full Android build pipeline:
 *   1) prepare assets (copy sillytavern payload)
 *   2) optional: ensure node binaries present (warn if missing)
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

// Check node binaries
const nodeBin = path.join(androidDir, 'app/src/main/assets/node/arm64-v8a/bin/node');
const genericBin = path.join(androidDir, 'app/src/main/assets/node/bin/node');
if (!fs.existsSync(nodeBin) && !fs.existsSync(genericBin)) {
    console.warn('\nWARNING: No Node binary found in assets/node/');
    console.warn('  Run: node android/scripts/download-node.mjs');
    console.warn('  Or place binaries manually. APK will build but will FAIL at runtime.\n');
}

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
