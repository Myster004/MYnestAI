#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const args = process.argv.slice(2);

function argVal(name, def) {
    const index = args.indexOf(name);
    return index !== -1 && args[index + 1] ? args[index + 1] : def;
}

const nodeVersion = argVal('--node-version', '20.18.1');
const abi = argVal('--abi', 'arm64-v8a');

const assetsDest = path.resolve(
    repoRoot,
    `android/app/src/main/assets/node/${abi}/bin/node`,
);

console.log('');
console.log('==============================================');
console.log(' MYnestAI Android Node Runtime');
console.log('==============================================');
console.log(`Node version : ${nodeVersion}`);
console.log(`Android ABI  : ${abi}`);
console.log(`Destination  : ${assetsDest}`);
console.log('');

function validateBinary(file) {
    if (!fs.existsSync(file)) {
        console.error(`ERROR: Node binary does not exist:`);
        console.error(`  ${file}`);
        return false;
    }

    const stat = fs.statSync(file);

    if (stat.size < 1024 * 1024) {
        console.error(`ERROR: Node binary is suspiciously small:`);
        console.error(`  ${stat.size} bytes`);
        return false;
    }

    const fd = fs.openSync(file, 'r');

    try {
        const header = Buffer.alloc(4);
        fs.readSync(fd, header, 0, 4, 0);

        // ELF magic: 0x7F 'E' 'L' 'F'
        if (
            header[0] !== 0x7f ||
            header[1] !== 0x45 ||
            header[2] !== 0x4c ||
            header[3] !== 0x46
        ) {
            console.error('ERROR: File is not an ELF binary.');
            return false;
        }
    } finally {
        fs.closeSync(fd);
    }

    fs.accessSync(file, fs.constants.X_OK);

    console.log('✓ ELF binary detected');
    console.log(`✓ Size: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);

    return true;
}

function runGithubWorkflow() {
    console.log('The Node Android binary is not present.');
    console.log('');
    console.log('Build it using GitHub Actions:');
    console.log('');
    console.log('  .github/workflows/build-node-android.yml');
    console.log('');
    console.log('After the GitHub Actions job completes:');
    console.log('');
    console.log('  1. Download the Node artifact.');
    console.log('  2. Extract it into:');
    console.log('');
    console.log(
        `     android/app/src/main/assets/node/${abi}/bin/node`,
    );
    console.log('');
}

function main() {
    if (!fs.existsSync(assetsDest)) {
        console.error('✗ Android Node runtime is missing.');
        console.error('');
        runGithubWorkflow();
        process.exit(1);
    }

    console.log('Checking Android Node runtime...');
    console.log('');

    if (!validateBinary(assetsDest)) {
        console.error('');
        console.error('Validation FAILED.');
        process.exit(1);
    }

    console.log('');
    console.log('✓ Android Node runtime is present.');
    console.log('');
    console.log('Next step:');
    console.log('');
    console.log('  npm run android:build');
    console.log('');
}

main();