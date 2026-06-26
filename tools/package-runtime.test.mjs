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
