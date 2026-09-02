#!/usr/bin/env node
/**
 * Downloads and prepares the prebuilt Node.js libnode.so for Android ARM64.
 *
 * Source: gmaclennan/nodejs-mobile v24.18.0-0
 *   https://github.com/gmaclennan/nodejs-mobile/releases/tag/v24.18.0-0
 *
 * Produces:
 *   android/app/src/main/jniLibs/arm64-v8a/libnode.so
 *   android/app/src/main/node/include/node/node.h
 *
 * Does NOT compile Node.js. Does NOT require WSL, NDK, or make.
 *
 * Usage:
 *   node android/scripts/prepare-node-android.mjs
 *   node android/scripts/prepare-node-android.mjs --force   # re-download
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const androidDir = path.resolve(repoRoot, 'android');
const appDir = path.resolve(androidDir, 'app/src/main');

// ─── Configuration ──────────────────────────────────────────────────────────
const NODE_VERSION = '24.18.0';
const MOBILE_REV = '0';
const RELEASE_TAG = `v${NODE_VERSION}-${MOBILE_REV}`;
const REPO = 'gmaclennan/nodejs-mobile';

// The zip file name in the release assets
const ZIP_NAME = `nodejs-mobile-android-${NODE_VERSION}-${MOBILE_REV}.zip`;
const DOWNLOAD_URL = `https://github.com/${REPO}/releases/download/${RELEASE_TAG}/${ZIP_NAME}`;

// Destinations
const JNI_LIBS_DIR = path.join(appDir, 'jniLibs/arm64-v8a');
const NODE_HEADERS_DIR = path.join(appDir, 'node/include/node');
const TEMP_DIR = path.join(repoRoot, '.tmp-node-download');

// Minimum expected file sizes
const MIN_LIBNODE_SIZE = 10 * 1024 * 1024; // 10 MB (libnode.so is ~54 MB)
const MIN_NODE_H_SIZE = 1000; // node.h is ~50 KB

// ─── Helpers ────────────────────────────────────────────────────────────────

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function isArm64AndroidElf(filePath) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(20);
        const n = fs.readSync(fd, buf, 0, 20, 0);
        fs.closeSync(fd);
        if (n < 20) return { valid: false, reason: 'file too small' };

        // ELF magic: 0x7F 'E' 'L' 'F'
        if (buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) {
            return { valid: false, reason: 'not an ELF binary' };
        }

        const eiClass = buf[4]; // 1=32-bit, 2=64-bit
        const eMachine = buf.readUInt16LE(18);

        // EM_AARCH64 = 183 (0xB7)
        if (eiClass !== 2) return { valid: false, reason: `expected 64-bit ELF, got class ${eiClass}` };
        if (eMachine !== 183) return { valid: false, reason: `expected EM_AARCH64 (183), got ${eMachine}` };

        return { valid: true, reason: `ELF64, AArch64 (machine=${eMachine})` };
    } catch (e) {
        return { valid: false, reason: e.message };
    }
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        console.log(`  Downloading: ${url}`);
        const followRedirect = (redirectUrl) => {
            https.get(redirectUrl, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    console.log(`  Following redirect to: ${res.headers.location}`);
                    followRedirect(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode} for ${redirectUrl}`));
                    return;
                }
                const file = fs.createWriteStream(dest);
                let downloaded = 0;
                res.on('data', (chunk) => {
                    downloaded += chunk.length;
                    if (downloaded % (10 * 1024 * 1024) < chunk.length) {
                        process.stdout.write(`  Downloaded ${(downloaded / 1024 / 1024).toFixed(1)} MB\r`);
                    }
                });
                res.pipe(file);
                file.on('finish', () => { file.close(); console.log(`  Downloaded ${(downloaded / 1024 / 1024).toFixed(1)} MB`); resolve(); });
                file.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
            }).on('error', reject);
        };
        followRedirect(url);
    });
}

function extractZip(zipPath, destDir) {
    // Use PowerShell Expand-Archive or tar
    console.log(`  Extracting to ${destDir}...`);
    try {
        // Windows: use Expand-Archive
        execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, {
            stdio: 'pipe',
            timeout: 60000,
        });
    } catch {
        // Fallback: try tar (available on Windows 10+)
        try {
            execSync(`tar -xf "${zipPath}" -C "${destDir}"`, { stdio: 'pipe', timeout: 60000 });
        } catch (e2) {
            throw new Error(`Failed to extract zip: ${e2.message}. Install PowerShell or tar.`);
        }
    }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const force = args.includes('--force');
    const validateOnly = args.includes('--validate');

    console.log('');
    console.log('==============================================');
    console.log(' MYnestAI – Prebuilt Node.js Prepare');
    console.log('==============================================');
    console.log(`Node version : ${NODE_VERSION}`);
    console.log(`Source       : ${REPO} ${RELEASE_TAG}`);
    console.log(`Target ABI   : arm64-v8a`);
    console.log('');

    // ── Check existing ──
    const libnodeDest = path.join(JNI_LIBS_DIR, 'libnode.so');
    const nodeHeader = path.join(NODE_HEADERS_DIR, 'node.h');

    const libExists = fs.existsSync(libnodeDest);
    const headerExists = fs.existsSync(nodeHeader);

    if (libExists) {
        const stat = fs.statSync(libnodeDest);
        const elf = isArm64AndroidElf(libnodeDest);
        const mb = (stat.size / 1024 / 1024).toFixed(1);
        if (elf.valid) {
            console.log(`  ✓ ${path.relative(repoRoot, libnodeDest)} — OK (${mb} MB, ${elf.reason})`);
        } else {
            console.log(`  ✗ ${path.relative(repoRoot, libnodeDest)} — INVALID: ${elf.reason} (${mb} MB)`);
        }
    } else {
        console.log(`  ✗ ${path.relative(repoRoot, libnodeDest)} — MISSING`);
    }

    if (headerExists) {
        const stat = fs.statSync(nodeHeader);
        console.log(`  ✓ ${path.relative(repoRoot, nodeHeader)} — OK (${(stat.size / 1024).toFixed(0)} KB)`);
    } else {
        console.log(`  ✗ ${path.relative(repoRoot, nodeHeader)} — MISSING`);
    }
    console.log('');

    if (validateOnly) {
        if (libExists && headerExists) {
            const elf = isArm64AndroidElf(libnodeDest);
            if (elf.valid) {
                console.log('Validation passed.');
                process.exit(0);
            }
        }
        console.error('Validation FAILED.');
        process.exit(1);
    }

    if (libExists && headerExists && !force) {
        const elf = isArm64AndroidElf(libnodeDest);
        if (elf.valid) {
            console.log('✓ Prebuilt Node.js already prepared. Use --force to re-download.');
            console.log('  Next: npm run android:build');
            process.exit(0);
        }
    }

    // ── Download ──
    console.log(`Downloading prebuilt Node.js from ${REPO}...`);
    ensureDir(TEMP_DIR);
    const zipPath = path.join(TEMP_DIR, ZIP_NAME);

    try {
        await downloadFile(DOWNLOAD_URL, zipPath);
    } catch (e) {
        console.error('');
        console.error(`Failed to download: ${e.message}`);
        console.error('');
        console.error('If the download fails, you can manually:');
        console.error(`  1. Download from: ${DOWNLOAD_URL}`);
        console.error(`  2. Extract libnode.so to: ${JNI_LIBS_DIR}/`);
        console.error(`  3. Extract include/node/ to: ${NODE_HEADERS_DIR}/`);
        process.exit(1);
    }

    // ── Extract ──
    const extractDir = path.join(TEMP_DIR, 'extracted');
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
    ensureDir(extractDir);
    extractZip(zipPath, extractDir);

    // ── Locate files ──
    // The zip typically contains:
    //   bin/arm64-v8a/libnode.so
    //   include/node/node.h
    //   (may be nested under a top-level directory)

    // Find libnode.so
    function findFile(dir, name) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isFile() && entry.name === name) return full;
            if (entry.isDirectory()) {
                const found = findFile(full, name);
                if (found) return found;
            }
        }
        return null;
    }

    const libnodeSrc = findFile(extractDir, 'libnode.so');
    const nodeHeaderSrc = findFile(extractDir, 'node.h');

    if (!libnodeSrc) {
        console.error('');
        console.error('ERROR: libnode.so not found in downloaded zip.');
        console.error(`  Zip contents in ${extractDir}:`);
        try {
            const walk = (d, prefix = '') => {
                for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                    console.error(`  ${prefix}${e.name}${e.isDirectory() ? '/' : ''}`);
                    if (e.isDirectory()) walk(path.join(d, e.name), prefix + '  ');
                }
            };
            walk(extractDir);
        } catch {}
        process.exit(1);
    }

    // ── Validate libnode.so ──
    const stat = fs.statSync(libnodeSrc);
    console.log(`  Found libnode.so: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);

    if (stat.size < MIN_LIBNODE_SIZE) {
        console.error(`ERROR: libnode.so too small (${stat.size} bytes) – expected >= ${MIN_LIBNODE_SIZE}`);
        process.exit(1);
    }

    const elf = isArm64AndroidElf(libnodeSrc);
    if (!elf.valid) {
        console.error(`ERROR: libnode.so is not ARM64 Android ELF: ${elf.reason}`);
        process.exit(1);
    }
    console.log(`  ✓ Validated: ${elf.reason}`);

    // ── Copy to destinations ──
    ensureDir(JNI_LIBS_DIR);
    fs.copyFileSync(libnodeSrc, libnodeDest);
    console.log(`  ✓ Copied libnode.so to ${path.relative(repoRoot, libnodeDest)}`);

    if (nodeHeaderSrc) {
        // Copy the ENTIRE header directory recursively (include/node/…). This
        // is required because node.h pulls in uv/*.h, cppgc/*, and v8-*.h
        // sub-trees – copying only node.h is not enough to compile the JNI bridge.
        const headerSrcDir = path.dirname(nodeHeaderSrc);
        fs.rmSync(NODE_HEADERS_DIR, { recursive: true, force: true });
        ensureDir(NODE_HEADERS_DIR);

        function copyTree(srcDir, dstDir) {
            for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
                const srcPath = path.join(srcDir, e.name);
                const dstPath = path.join(dstDir, e.name);
                if (e.isDirectory()) {
                    fs.mkdirSync(dstPath, { recursive: true });
                    copyTree(srcPath, dstPath);
                } else if (e.isFile()) {
                    fs.copyFileSync(srcPath, dstPath);
                } else if (e.isSymbolicLink()) {
                    const target = fs.readlinkSync(srcPath);
                    try { fs.symlinkSync(target, dstPath); } catch { /* best-effort */ }
                }
            }
        }
        copyTree(headerSrcDir, NODE_HEADERS_DIR);

        const hCount = (function count(dir) {
            let n = 0;
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                n += e.isDirectory() ? count(path.join(dir, e.name)) : 1;
            }
            return n;
        })(NODE_HEADERS_DIR);
        console.log(`  ✓ Copied ${hCount} header files to ${path.relative(repoRoot, NODE_HEADERS_DIR)}`);
    } else {
        console.warn('  ⚠ node.h not found in zip – headers will be missing');
    }

    // ── Cleanup ──
    try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch {}

    console.log('');
    console.log('✓ Prebuilt Node.js prepared successfully.');
    console.log('');
    console.log('  libnode.so  : android/app/src/main/jniLibs/arm64-v8a/libnode.so');
    console.log('  node.h      : android/app/src/main/node/include/node/node.h');
    console.log('');
    console.log('Next steps:');
    console.log('  npm run android:node:validate  # verify the files');
    console.log('  npm run android:build          # build APK');
}

main().catch(e => { console.error(e); process.exit(1); });
