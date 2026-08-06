import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const HEALTH_SCRIPT = path.join(PROJECT_DIR, 'tools/runtime-contract-health.mjs');
const PACKAGE_SCRIPT = path.join(PROJECT_DIR, 'tools/package-runtime.mjs');
const TEST_ROOT = path.join(PROJECT_DIR, '.tmp/runtime-contract-health-tests');

function runHealth(zipPath) {
    return execFileSync('node', [HEALTH_SCRIPT, zipPath], {
        cwd: PROJECT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function runPackager(args = []) {
    return execFileSync('node', [PACKAGE_SCRIPT, ...args], {
        cwd: PROJECT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

async function createWorkspace() {
    await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    return mkdtemp(path.join(TEST_ROOT, 'health-'));
}

function findZip(outDir) {
    const output = execFileSync('find', [outDir, '-maxdepth', '1', '-type', 'f', '-name', 'fortweb-runtime-*.zip'], {
        cwd: PROJECT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const zips = output.split(/\r?\n/u).map((l) => l.trim()).filter(Boolean);
    assert.ok(zips.length === 1, `Expected exactly one ZIP, found ${zips.length}`);
    return zips[0];
}

test('generated runtime requirements contract is healthy and manifest-bound', async () => {
    const outDir = await createWorkspace();
    try {
        runPackager(['--no-build', '--out-dir', outDir]);
        const zipPath = findZip(outDir);
        const result = JSON.parse(runHealth(zipPath));
        assert.equal(result.status, 'PASS');
        assert.equal(result.contract_path, 'contracts/runtime-requirements.json');
        assert.equal(result.schema, 'fort.runtime-requirements.v1');
        assert.equal(result.version, 1);
        assert.equal(result.producer, 'fortweb');
        assert.equal(result.inventory_entries, 1);
        assert.ok(result.actual_bytes > 0);
        assert.equal(result.actual_bytes, result.manifest_bytes);
        assert.equal(result.actual_sha256, result.manifest_sha256);
        assert.equal(result.canonical_verifier, 'PASS');
    } finally {
        await rm(outDir, { recursive: true, force: true });
    }
});

test('contract health fails on manifest digest mismatch', async () => {
    const outDir = await createWorkspace();
    try {
        runPackager(['--no-build', '--out-dir', outDir]);
        const zipPath = findZip(outDir);

        // Extract and mutate the manifest's recorded digest for the contract
        const manifestText = execFileSync('unzip', ['-p', zipPath, 'fortweb-runtime/manifest.json'], {
            cwd: PROJECT_DIR,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const manifest = JSON.parse(manifestText);
        const entry = manifest.files.find((f) => f.path === 'contracts/runtime-requirements.json');
        entry.sha256 = '0'.repeat(64);

        // Rebuild a mutated ZIP
        const mutatedDir = path.join(outDir, 'mutated');
        await mkdir(mutatedDir, { recursive: true });
        execFileSync('unzip', ['-q', zipPath, '-d', mutatedDir], {
            cwd: PROJECT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const { writeFile } = await import('node:fs/promises');
        await writeFile(
            path.join(mutatedDir, 'fortweb-runtime', 'manifest.json'),
            JSON.stringify(manifest, null, 2),
        );
        const mutatedZip = path.join(outDir, 'mutated.zip');
        execFileSync('zip', ['-X', '-r', mutatedZip, '.'], {
            cwd: mutatedDir,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        assert.throws(
            () => runHealth(mutatedZip),
            (error) => /SHA-256 mismatch/i.test(error.message),
            'Expected health check to fail on manifest digest mismatch',
        );
    } finally {
        await rm(outDir, { recursive: true, force: true });
    }
});
