#!/usr/bin/env node
/**
 * Prepare SillyTavern payload for Android APK.
 *
 * Copies the repo (minus excluded patterns) into:
 *   android/app/src/main/assets/sillytavern/
 *
 * Usage:
 *   node android/scripts/prepare-assets.mjs [--include-node-modules] [--clean]
 *
 * By default includes node_modules if present (required for offline standalone).
 * Pass --no-node-modules to skip (smaller APK, requires runtime npm install – not recommended).
 *
 * Excludes: .git, data, cache, vectors, backups, android, .gradle, node_modules/.cache, etc.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const destRoot = path.resolve(repoRoot, 'android/app/src/main/assets/sillytavern');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node android/scripts/prepare-assets.mjs [options]
Options:
  --clean            Remove previous assets before copying
  --no-node-modules  Skip bundling node_modules (smaller APK, not offline)
  --help             Show this help`);
    process.exit(0);
}
const clean = args.includes('--clean');
const includeNodeModules = !args.includes('--no-node-modules');

const EXCLUDE_DIRS = new Set([
    '.git', '.github', '.vscode', '.gemini', 'android', 'data', 'cache', 'vectors', 'backups',
    'dist', '_webpack', '.gradle', 'build', 'thumbnails', 'uploads', '_uploads'
]);

const EXCLUDE_FILES = new Set([
    '.DS_Store', 'npm-debug.log'
]);

const EXCLUDE_EXT = new Set([]);

const EXCLUDE_PATHS = [
    'node_modules/.cache',
    'node_modules/.bin',
    'public/chats', 'public/characters', 'public/groups', 'public/worlds',
];

function shouldExclude(relPath, isDir) {
    const parts = relPath.split(path.sep);
    for (const p of parts) if (EXCLUDE_DIRS.has(p)) return true;
    for (const excl of EXCLUDE_PATHS) if (relPath === excl || relPath.startsWith(excl + path.sep)) return true;
    const base = parts[parts.length - 1];
    if (EXCLUDE_FILES.has(base)) return true;
    if (!isDir && EXCLUDE_EXT.has(path.extname(base))) return true;
    if (!includeNodeModules && relPath.startsWith('node_modules')) return true;
    return false;
}

function copyRecursive(src, dest) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        const rel = path.relative(repoRoot, src);
        if (rel && shouldExclude(rel, true)) {
            // console.log('skip dir', rel);
            return;
        }
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src)) {
            copyRecursive(path.join(src, entry), path.join(dest, entry));
        }
    } else {
        const rel = path.relative(repoRoot, src);
        if (shouldExclude(rel, false)) return;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
    }
}

function rmRecursive(p) {
    if (!fs.existsSync(p)) return;
    fs.rmSync(p, { recursive: true, force: true });
}

console.log(`Repo root: ${repoRoot}`);
console.log(`Dest: ${destRoot}`);
console.log(`includeNodeModules: ${includeNodeModules}`);

if (clean && fs.existsSync(destRoot)) {
    console.log('Cleaning dest…');
    rmRecursive(destRoot);
}

// Ensure node_modules exists if we plan to include
if (includeNodeModules && !fs.existsSync(path.join(repoRoot, 'node_modules'))) {
    console.warn('WARNING: node_modules not found – run `npm install` first or APK will be incomplete.');
    console.warn('         Use --no-node-modules to skip bundling intentionally.');
}

console.log('Copying files… (this may take 30-60s)');
const start = Date.now();
copyRecursive(repoRoot, destRoot);
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

// Ensure a marker for bundled version
fs.writeFileSync(path.join(destRoot, '.android-bundled'), new Date().toISOString(), 'utf8');

// Size report
function dirSize(p) {
    let total = 0;
    function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const fp = path.join(d, e.name);
            if (e.isDirectory()) walk(fp);
            else total += fs.statSync(fp).size;
        }
    }
    walk(p);
    return total;
}
const bytes = dirSize(destRoot);
const mb = (bytes / 1024 / 1024).toFixed(1);
console.log(`Done in ${elapsed}s – ${mb} MB copied to ${destRoot}`);
console.log('');
console.log('Next:');
console.log('  1) Prepare Node runtime:    npm run android:node:prepare');
console.log('  2) Build APK:              cd android && ./gradlew assembleDebug');
console.log('     Or via npm:            npm run android:build');
