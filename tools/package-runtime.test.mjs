import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const PACKAGE_SCRIPT = path.join(PROJECT_DIR, 'tools/package-runtime.mjs');
const TEST_ROOT = path.join(PROJECT_DIR, '.tmp/runtime-package-tests');

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
    return mkdtemp(path.join(TEST_ROOT, 'pkg-'));
}

function findZip(outDir) {
    const output = execFileSync('find', [outDir, '-maxdepth', '1', '-type', 'f', '-name', 'fortweb-runtime-*.zip'], {
        cwd: PROJECT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    const zips = output
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);

    assert.ok(zips.length === 1, `Expected exactly one ZIP in ${outDir}, found ${zips.length}`);
    return zips[0];
}

async function readZipText(zipPath, internalPath) {
    try {
        return execFileSync('unzip', ['-p', zipPath, internalPath], {
            cwd: PROJECT_DIR,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch {
        return null;
    }
}

test('--out-dir is honored', async () => {
    const outDir = await createWorkspace();
    try {
        runPackager(['--no-build', '--out-dir', outDir]);

        const zipPath = findZip(outDir);
        const stats = await lstat(zipPath);
        assert.ok(stats.isFile(), `Expected a ZIP file at ${zipPath}`);

        const manifestText = await readZipText(zipPath, 'fortweb-runtime/manifest.json');
        assert.ok(manifestText, 'Expected manifest.json inside the ZIP');
        const manifest = JSON.parse(manifestText);
        assert.ok(Array.isArray(manifest.files), 'Expected manifest.files to be an array');
    } finally {
        await rm(outDir, { recursive: true, force: true });
    }
});

test('default output behavior remains intact', async () => {
    const defaultDir = path.join(PROJECT_DIR, '.tmp/runtime-packages');

    // Clean the default directory first so we can detect the new artifact
    await rm(defaultDir, { recursive: true, force: true });
    await mkdir(defaultDir, { recursive: true });

    try {
        runPackager(['--no-build']);

        const zipPath = findZip(defaultDir);
        const stats = await lstat(zipPath);
        assert.ok(stats.isFile(), `Expected a ZIP file at ${zipPath}`);
    } finally {
        await rm(defaultDir, { recursive: true, force: true });
    }
});

test('manifest/checksum stability across equivalent runs', async () => {
    const dir1 = await createWorkspace();
    const dir2 = await createWorkspace();

    try {
        runPackager(['--no-build', '--out-dir', dir1]);
        runPackager(['--no-build', '--out-dir', dir2]);

        const zip1 = findZip(dir1);
        const zip2 = findZip(dir2);

        const manifest1 = await readZipText(zip1, 'fortweb-runtime/manifest.json');
        const manifest2 = await readZipText(zip2, 'fortweb-runtime/manifest.json');
        assert.ok(manifest1, 'Expected manifest.json in first ZIP');
        assert.ok(manifest2, 'Expected manifest.json in second ZIP');

        const checksums1 = await readZipText(zip1, 'fortweb-runtime/checksums.sha256');
        const checksums2 = await readZipText(zip2, 'fortweb-runtime/checksums.sha256');
        assert.ok(checksums1, 'Expected checksums.sha256 in first ZIP');
        assert.ok(checksums2, 'Expected checksums.sha256 in second ZIP');

        assert.strictEqual(manifest1, manifest2, 'manifest.json content must be byte-identical across runs');
        assert.strictEqual(checksums1, checksums2, 'checksums.sha256 content must be byte-identical across runs');
    } finally {
        await rm(dir1, { recursive: true, force: true });
        await rm(dir2, { recursive: true, force: true });
    }
});

test('writes a checksum sidecar beside the runtime ZIP', async () => {
    const outDir = await createWorkspace();

    try {
        runPackager(['--no-build', '--out-dir', outDir]);

        const zipPath = findZip(outDir);
        const sidecarPath = `${zipPath}.sha256`;

        // Sidecar must exist as a file beside the ZIP
        const sidecarStats = await lstat(sidecarPath);
        assert.ok(sidecarStats.isFile(), `Expected sidecar file at ${sidecarPath}`);

        // Sidecar filename must be based on the ZIP basename
        assert.ok(
            path.basename(sidecarPath) === `${path.basename(zipPath)}.sha256`,
            `Sidecar basename must be ZIP basename + .sha256, got ${path.basename(sidecarPath)}`,
        );
    } finally {
        await rm(outDir, { recursive: true, force: true });
    }
});

test('checksum sidecar matches final ZIP bytes', async () => {
    const outDir = await createWorkspace();

    try {
        runPackager(['--no-build', '--out-dir', outDir]);

        const zipPath = findZip(outDir);
        const sidecarPath = `${zipPath}.sha256`;

        // Read the sidecar
        const sidecarContent = await readFile(sidecarPath, 'utf8');

        // Must be exactly one line: <64-hex-sha256>  <zip-basename>\n
        const lines = sidecarContent.split('\n');
        assert.strictEqual(lines.length, 2, 'Sidecar must contain exactly one newline');
        assert.strictEqual(lines[1], '', 'Sidecar must end with a newline');

        const sidecarLine = lines[0];
        const match = sidecarLine.match(/^([0-9a-f]{64})  (.+)$/u);
        assert.ok(match, `Sidecar must match format "<sha256>  <basename>", got: ${sidecarLine}`);

        const sidecarHash = match[1];
        const sidecarBasename = match[2];

        // Basename in sidecar must match the ZIP basename
        assert.strictEqual(sidecarBasename, path.basename(zipPath),
            'Sidecar basename must match the ZIP basename');

        // Independently hash the ZIP bytes and compare
        const zipBuffer = await readFile(zipPath);
        const actualHash = createHash('sha256').update(zipBuffer).digest('hex');
        assert.strictEqual(sidecarHash, actualHash,
            'Sidecar SHA-256 must match the independently computed ZIP hash');
    } finally {
        await rm(outDir, { recursive: true, force: true });
    }
});

test('manifest contains required package identity fields', async () => {
    const outDir = await createWorkspace();

    try {
        runPackager(['--no-build', '--out-dir', outDir]);

        const zipPath = findZip(outDir);
        const manifestText = await readZipText(zipPath, 'fortweb-runtime/manifest.json');
        assert.ok(manifestText, 'Expected manifest.json');
        const manifest = JSON.parse(manifestText);

        assert.strictEqual(manifest.package_name, 'fortweb-runtime',
            'package_name must be fortweb-runtime');
        assert.strictEqual(manifest.producer, 'fortweb',
            'producer must be fortweb');
        assert.strictEqual(manifest.payload_profile, 'offline-runtime',
            'payload_profile must be offline-runtime');
        assert.strictEqual(manifest.entrypoint, 'app/index.html',
            'entrypoint must be app/index.html');
        assert.strictEqual(manifest.schema_version, '1.0.0',
            'schema_version must be 1.0.0');
    } finally {
        await rm(outDir, { recursive: true, force: true });
    }
});

test('manifest files use canonical field names', async () => {
    const outDir = await createWorkspace();

    try {
        runPackager(['--no-build', '--out-dir', outDir]);

        const zipPath = findZip(outDir);
        const manifestText = await readZipText(zipPath, 'fortweb-runtime/manifest.json');
        const manifest = JSON.parse(manifestText);

        for (const entry of manifest.files) {
            assert.ok(typeof entry.path === 'string', 'each file entry must have path');
            assert.ok(typeof entry.sha256 === 'string' && entry.sha256.length === 64,
                'each file entry must have sha256 as 64-char hex');
            assert.ok(Number.isInteger(entry.bytes) && entry.bytes >= 0,
                'each file entry must have bytes as non-negative integer');
            assert.ok(!('size' in entry),
                'file entries must use canonical bytes field, not size');
        }
    } finally {
        await rm(outDir, { recursive: true, force: true });
    }
});

// --- Runtime Requirements Tests ---

test('runtime requirements artifact exists at conventional path', async () => {
    const outDir = await createWorkspace();

    try {
        runPackager(['--no-build', '--out-dir', outDir]);

        const zipPath = findZip(outDir);
        const reqText = await readZipText(zipPath,
            'fortweb-runtime/contracts/runtime-requirements.json');
        assert.ok(reqText, 'runtime-requirements.json must exist at contracts/runtime-requirements.json');
        const req = JSON.parse(reqText);

        assert.strictEqual(req.schema, 'fort.runtime-requirements.v1');
        assert.strictEqual(req.version, 1);
        assert.strictEqual(req.producer, 'fortweb');
        assert.strictEqual(req.payload_profile, 'offline-runtime');
        assert.ok(typeof req.capabilities === 'object' && req.capabilities !== null,
            'must have capabilities object');
        assert.ok(Array.isArray(req.forbidden_behaviors),
            'must have forbidden_behaviors array');
    } finally {
        await rm(outDir, { recursive: true, force: true });
    }
});

test('runtime requirements have all required capabilities', async () => {
    const outDir = await createWorkspace();

    try {
        runPackager(['--no-build', '--out-dir', outDir]);

        const zipPath = findZip(outDir);
        const reqText = await readZipText(zipPath,
            'fortweb-runtime/contracts/runtime-requirements.json');
        const req = JSON.parse(reqText);

        const requiredCaps = [
            'stable_origin_across_launches',
            'persistent_storage_partition',
            'secure_context',
            'remote_network_prohibition',
            'bundled_assets_only',
            'worker_availability',
            'main_frame_provenance',
            'origin_provenance',
            'deterministic_entrypoint',
            'no_fallback_shell_substitution',
        ];

        for (const cap of requiredCaps) {
            const entry = req.capabilities[cap];
            assert.ok(entry, `capability ${cap} must be present`);
            assert.strictEqual(entry.required, true,
                `capability ${cap} must be required: true`);
            assert.ok(typeof entry.description === 'string' && entry.description.length > 0,
                `capability ${cap} must have a non-empty description`);
        }
    } finally {
        await rm(outDir, { recursive: true, force: true });
    }
});

test('runtime requirements appear exactly once in file inventory', async () => {
    const outDir = await createWorkspace();

    try {
        runPackager(['--no-build', '--out-dir', outDir]);

        const zipPath = findZip(outDir);
        const manifestText = await readZipText(zipPath, 'fortweb-runtime/manifest.json');
        const manifest = JSON.parse(manifestText);

        const matches = manifest.files.filter(
            (f) => f.path === 'contracts/runtime-requirements.json',
        );
        assert.strictEqual(matches.length, 1,
            'runtime-requirements.json must appear exactly once in file inventory');
    } finally {
        await rm(outDir, { recursive: true, force: true });
    }
});

test('runtime requirements SHA-256 matches exact packaged bytes', async () => {
    const outDir = await createWorkspace();

    try {
        runPackager(['--no-build', '--out-dir', outDir]);

        const zipPath = findZip(outDir);
        const manifestText = await readZipText(zipPath, 'fortweb-runtime/manifest.json');
        const manifest = JSON.parse(manifestText);

        const entry = manifest.files.find(
            (f) => f.path === 'contracts/runtime-requirements.json',
        );
        assert.ok(entry, 'requirements entry must exist in file inventory');

        const bytes = execFileSync('unzip', ['-p', zipPath,
            'fortweb-runtime/contracts/runtime-requirements.json'], {
            cwd: PROJECT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const actualHash = createHash('sha256').update(bytes).digest('hex');

        assert.strictEqual(entry.sha256, actualHash,
            'manifest SHA-256 must match independently computed hash of ZIP bytes');
        assert.strictEqual(entry.bytes, bytes.length,
            'manifest bytes must match actual file size');
    } finally {
        await rm(outDir, { recursive: true, force: true });
    }
});

test('manifest contains typed contracts descriptor', async () => {
    const outDir = await createWorkspace();

    try {
        runPackager(['--no-build', '--out-dir', outDir]);

        const zipPath = findZip(outDir);
        const manifestText = await readZipText(zipPath, 'fortweb-runtime/manifest.json');
        const manifest = JSON.parse(manifestText);

        assert.ok(manifest.contracts, 'manifest must have contracts field');
        assert.ok(manifest.contracts.runtime_requirements,
            'contracts must have runtime_requirements descriptor');
        assert.strictEqual(
            manifest.contracts.runtime_requirements.path,
            'contracts/runtime-requirements.json',
            'typed descriptor path must match conventional path',
        );
    } finally {
        await rm(outDir, { recursive: true, force: true });
    }
});

test('runtime requirements are deterministic across equivalent runs', async () => {
    const dir1 = await createWorkspace();
    const dir2 = await createWorkspace();

    try {
        runPackager(['--no-build', '--out-dir', dir1]);
        runPackager(['--no-build', '--out-dir', dir2]);

        const zip1 = findZip(dir1);
        const zip2 = findZip(dir2);

        const req1 = await readZipText(zip1,
            'fortweb-runtime/contracts/runtime-requirements.json');
        const req2 = await readZipText(zip2,
            'fortweb-runtime/contracts/runtime-requirements.json');

        assert.strictEqual(req1, req2,
            'runtime-requirements.json must be byte-identical across runs');
    } finally {
        await rm(dir1, { recursive: true, force: true });
        await rm(dir2, { recursive: true, force: true });
    }
});

test('existing package tests still pass after requirements addition', async () => {
    const outDir = await createWorkspace();

    try {
        runPackager(['--no-build', '--out-dir', outDir]);

        const zipPath = findZip(outDir);
        const manifestText = await readZipText(zipPath, 'fortweb-runtime/manifest.json');
        const manifest = JSON.parse(manifestText);

        assert.strictEqual(manifest.package_name, 'fortweb-runtime');
        assert.strictEqual(manifest.producer, 'fortweb');
        assert.strictEqual(manifest.entrypoint, 'app/index.html');
        assert.ok(Array.isArray(manifest.files));

        const filePaths = manifest.files.map((f) => f.path);
        assert.ok(filePaths.includes('app/index.html'),
            'existing entrypoint must still be present');
        assert.ok(filePaths.includes('contracts/runtime-requirements.json'),
            'new requirements artifact must be present');
    } finally {
        await rm(outDir, { recursive: true, force: true });
    }
});
