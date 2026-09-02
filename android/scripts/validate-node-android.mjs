#!/usr/bin/env node
/**
 * Validates the prebuilt Node.js Android ARM64 runtime files.
 *
 * Checks:
 *   - libnode.so exists and is ARM64 Android ELF
 *   - Matching Node headers exist (node.h)
 *   - No standalone node executable is required
 *   - Android native build configuration is present
 *
 * Usage:
 *   node android/scripts/validate-node-android.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const appDir = path.resolve(repoRoot, 'android/app/src/main');

const checks = [];

function check(name, fn) {
    const result = fn();
    checks.push({ name, ...result });
    if (result.ok) {
        console.log(`  ✓ ${name}: ${result.message}`);
    } else {
        console.log(`  ✗ ${name}: ${result.message}`);
    }
}

function isArm64AndroidElf(filePath) {
    try {
        if (!fs.existsSync(filePath)) return { ok: false, message: 'file not found' };
        const stat = fs.statSync(filePath);
        if (stat.size < 10 * 1024 * 1024) {
            return { ok: false, message: `too small (${stat.size} bytes)` };
        }
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(20);
        const n = fs.readSync(fd, buf, 0, 20, 0);
        fs.closeSync(fd);
        if (n < 20) return { ok: false, message: 'cannot read ELF header' };

        if (buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) {
            if (buf[0] === 0x4d && buf[1] === 0x5a) {
                return { ok: false, message: 'Windows PE (MZ) – not Android' };
            }
            return { ok: false, message: 'not an ELF binary' };
        }

        const eiClass = buf[4];
        const eMachine = buf.readUInt16LE(18);

        if (eiClass !== 2) return { ok: false, message: `not 64-bit (class=${eiClass})` };
        if (eMachine !== 183) return { ok: false, message: `not AArch64 (machine=${eMachine})` };

        return { ok: true, message: `ELF64, AArch64, ${(stat.size / 1024 / 1024).toFixed(1)} MB` };
    } catch (e) {
        return { ok: false, message: e.message };
    }
}

function main() {
    console.log('');
    console.log('==============================================');
    console.log(' MYnestAI – Node.js Android Validation');
    console.log('==============================================');
    console.log('');

    const libnodePath = path.join(appDir, 'jniLibs/arm64-v8a/libnode.so');
    const nodeHeaderPath = path.join(appDir, 'node/include/node/node.h');
    const cmakePath = path.join(appDir, 'cpp/CMakeLists.txt');
    const nativeNodeCpp = path.join(appDir, 'cpp/native-node.cpp');
    const nativeNodeJava = path.join(appDir, 'java/app/sillytavern/android/NativeNode.java');

    // 1. libnode.so
    check('libnode.so exists and is ARM64 Android ELF', () => isArm64AndroidElf(libnodePath));

    // 2. Headers
    check('node.h exists', () => {
        if (!fs.existsSync(nodeHeaderPath)) return { ok: false, message: 'missing' };
        const stat = fs.statSync(nodeHeaderPath);
        return { ok: true, message: `${(stat.size / 1024).toFixed(0)} KB` };
    });

    // 3. No standalone node executable required
    check('No standalone node executable in assets', () => {
        const oldPath = path.join(appDir, 'assets/node/arm64-v8a/bin/node');
        if (fs.existsSync(oldPath)) {
            return { ok: false, message: `old binary still exists at ${path.relative(repoRoot, oldPath)} – remove it` };
        }
        return { ok: true, message: 'correctly absent (using libnode.so instead)' };
    });

    // 4. CMake configuration
    check('CMakeLists.txt exists', () => {
        if (!fs.existsSync(cmakePath)) return { ok: false, message: 'missing' };
        const content = fs.readFileSync(cmakePath, 'utf8');
        if (!content.includes('libnode.so')) return { ok: false, message: 'does not reference libnode.so' };
        return { ok: true, message: 'references libnode.so' };
    });

    // 5. JNI bridge source
    check('native-node.cpp exists', () => {
        if (!fs.existsSync(nativeNodeCpp)) return { ok: false, message: 'missing' };
        const content = fs.readFileSync(nativeNodeCpp, 'utf8');
        if (!content.includes('node::Start')) return { ok: false, message: 'does not call node::Start' };
        return { ok: true, message: 'calls node::Start(argc, argv)' };
    });

    // 6. NativeNode.java
    check('NativeNode.java exists', () => {
        if (!fs.existsSync(nativeNodeJava)) return { ok: false, message: 'missing' };
        const content = fs.readFileSync(nativeNodeJava, 'utf8');
        if (!content.includes('System.loadLibrary')) return { ok: false, message: 'does not load native libraries' };
        return { ok: true, message: 'loads libnode + native-node via System.loadLibrary' };
    });

    // Summary
    const failed = checks.filter(c => !c.ok);
    console.log('');
    if (failed.length === 0) {
        console.log('✓ All checks passed. Ready to build.');
        console.log('  Next: npm run android:build');
        process.exit(0);
    } else {
        console.error(`✗ ${failed.length} check(s) failed.`);
        console.error('');
        console.error('Run: npm run android:node:prepare   # to download and place files');
        process.exit(1);
    }
}

main();
