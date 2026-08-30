#!/usr/bin/env node
/**
 * Download Node.js binaries for Android ABIs.
 *
 * SillyTavern requires Node >=20. Android needs a Bionic-linked binary, not
 * the glibc linux-x64 builds from nodejs.org. We therefore try:
 *  1) nodejs-mobile prebuilt (Bionic, NDK cross-compiled) – preferred
 *  2) Termux package mirror (also Bionic) – fallback
 *  3) Warn and allow user to place custom binaries
 *
 * Binaries are placed into:
 *   android/app/src/main/assets/node/<abi>/bin/node
 *   - arm64-v8a
 *   - armeabi-v7a
 *   - x86_64
 *   - x86
 *
 * Usage:
 *   node android/scripts/download-node.mjs [--node-version 20.18.0] [--force]
 *   node android/scripts/download-node.mjs --from-url https://example.com/node-arm64.zip --abi arm64-v8a
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const assetsNodeRoot = path.resolve(repoRoot, 'android/app/src/main/assets/node');

const args = process.argv.slice(2);
function argVal(name, def) {
    const i = args.indexOf(name);
    if (i !== -1 && args[i+1]) return args[i+1];
    return def;
}
const nodeVersion = argVal('--node-version', '20.18.1');
const force = args.includes('--force');
const customUrl = argVal('--from-url', null);
const customAbi = argVal('--abi', 'arm64-v8a');

const ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86'];

// Mirrors – ordered by preference. First successful wins.
// nodejs-mobile releases are the most reliable for Android.
// Example URL pattern (check https://github.com/nodejs-mobile/nodejs-mobile/releases):
//   https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v20.18.1/node-v20.18.1-android-arm64.tar.gz
// Termux mirror example (uses .deb): https://packages.termux.dev/apt/termux-main/pool/main/n/nodejs/nodejs_20.18.1_aarch64.deb

function mirrorUrls(version, abi) {
    // Map ABI to nodejs-mobile arch naming
    const archMap = {
        'arm64-v8a': 'arm64',
        'armeabi-v7a': 'armv7l',
        'x86_64': 'x64',
        'x86': 'x86',
    };
    const arch = archMap[abi] || abi;
    // Nodejs-mobile URL candidates (try a few version-tag formats)
    return [
        `https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v${version}/node-v${version}-android-${arch}.tar.gz`,
        `https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v${version}/node-v${version}-android-${arch}.tar.xz`,
        // Termux deb (fallback – requires extraction)
        `https://packages.termux.dev/apt/termux-main/pool/main/n/nodejs/nodejs_${version}_aarch64.deb`,
    ];
}

function download(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const client = url.startsWith('https') ? https : http;
        console.log(`  GET ${url}`);
        client.get(url, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close();
                fs.unlinkSync(dest);
                return download(res.headers.location, dest).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                file.close();
                try { fs.unlinkSync(dest); } catch {}
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
        }).on('error', err => {
            try { fs.unlinkSync(dest); } catch {}
            reject(err);
        });
    });
}

async function tryDownload(abi) {
    const destDir = path.join(assetsNodeRoot, abi, 'bin');
    const destFile = path.join(destDir, 'node');
    if (!force && fs.existsSync(destFile)) {
        console.log(`  ${abi}: already exists at ${destFile} (use --force to re-download)`);
        return true;
    }
    fs.mkdirSync(destDir, { recursive: true });

    if (customUrl) {
        // Custom URL mode – single ABI
        const tmp = path.join(destDir, 'dl.tmp');
        await download(customUrl, tmp);
        // Try to detect if it's a tar, zip, or raw binary
        if (customUrl.endsWith('.tar.gz') || customUrl.endsWith('.tgz')) {
            execSync(`tar -xzf "${tmp}" -C "${destDir}" --strip-components=1 || tar -xzf "${tmp}" -C "${destDir}"`, { stdio: 'inherit' });
            // Find node binary inside
            // If not found, assume tmp itself is node? fallback
        } else {
            fs.copyFileSync(tmp, destFile);
        }
        try { fs.unlinkSync(tmp); } catch {}
        if (fs.existsSync(destFile)) { fs.chmodSync(destFile, 0o755); return true; }
        // Search recursively
        const found = findNodeBinary(destDir);
        if (found && found !== destFile) { fs.copyFileSync(found, destFile); fs.chmodSync(destFile, 0o755); return true; }
        return fs.existsSync(destFile);
    }

    for (const url of mirrorUrls(nodeVersion, abi)) {
        const tmp = path.join(destDir, 'dl.tmp.' + (url.endsWith('.deb') ? 'deb' : 'tgz'));
        try {
            await download(url, tmp);
            if (url.endsWith('.deb')) {
                // Extract Termux deb: ar x then tar -xJf data.tar.xz
                console.log(`    extracting deb…`);
                const debTmp = path.join(destDir, '_deb');
                fs.mkdirSync(debTmp, { recursive: true });
                execSync(`ar x "${tmp}"`, { cwd: debTmp, stdio: 'pipe' });
                // data.tar.xz or data.tar.gz
                const dataTar = fs.readdirSync(debTmp).find(f => f.startsWith('data.'));
                if (!dataTar) throw new Error('No data.tar in deb');
                execSync(`tar -xf "${path.join(debTmp, dataTar)}" -C "${debTmp}"`, { stdio: 'pipe' });
                const srcBin = path.join(debTmp, 'data/data/com.termux/files/usr/bin/node');
                if (fs.existsSync(srcBin)) {
                    fs.copyFileSync(srcBin, destFile);
                    fs.chmodSync(destFile, 0o755);
                    fs.rmSync(debTmp, { recursive: true, force: true });
                    fs.unlinkSync(tmp);
                    console.log(`  ${abi}: installed from Termux deb`);
                    return true;
                }
                fs.rmSync(debTmp, { recursive: true, force: true });
                throw new Error('node not found in deb');
            } else {
                // tar.gz
                execSync(`tar -xzf "${tmp}" -C "${destDir}"`, { stdio: 'pipe' });
                fs.unlinkSync(tmp);
                // Find node binary – may be at ./bin/node or ./node
                let found = findNodeBinary(destDir);
                if (found) {
                    if (found !== destFile) {
                        fs.copyFileSync(found, destFile);
                    }
                    fs.chmodSync(destFile, 0o755);
                    // Clean other extracted files besides bin/node
                    // keep only bin/node for smaller APK
                    console.log(`  ${abi}: installed from ${url}`);
                    return true;
                }
                console.log(`  ${abi}: no node binary in ${url} extract`);
            }
        } catch (e) {
            console.log(`  ${abi}: failed ${url} -> ${e.message}`);
            try { fs.unlinkSync(tmp); } catch {}
            continue;
        }
    }
    return false;
}

function findNodeBinary(dir) {
    const candidates = [
        path.join(dir, 'bin/node'),
        path.join(dir, 'node'),
        path.join(dir, 'nodejs/bin/node'),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    // recursive search (max depth 3)
    function walk(d, depth) {
        if (depth > 3) return null;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const fp = path.join(d, e.name);
            if (e.isFile() && e.name === 'node') return fp;
            if (e.isDirectory()) {
                const r = walk(fp, depth+1);
                if (r) return r;
            }
        }
        return null;
    }
    try { return walk(dir, 0); } catch { return null; }
}

async function main() {
    console.log(`Node version: ${nodeVersion}`);
    console.log(`Assets root: ${assetsNodeRoot}`);
    if (customUrl) {
        console.log(`Custom URL mode: ${customUrl} -> ${customAbi}`);
        const ok = await tryDownload(customAbi);
        if (!ok) {
            console.error(`Failed to install custom node for ${customAbi}`);
            process.exit(1);
        }
        console.log('Done');
        return;
    }

    let any = false;
    for (const abi of ABIS) {
        console.log(`\n[${abi}]`);
        const ok = await tryDownload(abi);
        if (ok) any = true;
        else console.log(`  ${abi}: SKIPPED (no mirror succeeded) – you can place a binary manually at ${path.join(assetsNodeRoot, abi, 'bin/node')}`);
    }

    if (!any) {
        console.log('\nNo ABIs succeeded. Options:');
        console.log('  1) Place prebuilt Bionic node binaries manually:');
        for (const abi of ABIS) console.log(`     ${path.join(assetsNodeRoot, abi, 'bin/node')}`);
        console.log('  2) Build Node for Android via NDK: https://github.com/nodejs/node/blob/main/BUILDING.md#building-for-android');
        console.log('  3) Use Termux: pkg install nodejs && cp $PREFIX/bin/node <dest>');
        console.log('\nYou can also run a minimal APK without bundled node and rely on system node, but that breaks standalone requirement.');
        process.exit(1);
    }

    // Copy primary ABI to generic fallback location for older extractor logic
    const primary = path.join(assetsNodeRoot, 'arm64-v8a/bin/node');
    const generic = path.join(assetsNodeRoot, 'bin/node');
    if (fs.existsSync(primary) && !fs.existsSync(generic)) {
        fs.mkdirSync(path.dirname(generic), { recursive: true });
        fs.copyFileSync(primary, generic);
        fs.chmodSync(generic, 0o755);
        console.log(`\nCopied ${primary} -> ${generic} (fallback)`);
    }

    console.log('\nNode assets ready. Verify:');
    for (const abi of ABIS) {
        const p = path.join(assetsNodeRoot, abi, 'bin/node');
        if (fs.existsSync(p)) {
            const sz = (fs.statSync(p).size / 1024 / 1024).toFixed(1);
            console.log(`  ${abi}: ${sz} MB`);
        }
    }
    console.log('\nNext: npm run android:prepare && npm run android:build');
}

main().catch(e => { console.error(e); process.exit(1); });
