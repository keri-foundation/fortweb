import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, open, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createDeterministicZip } from './deterministic-zip.mjs';
import { generateReleaseMetadata } from './generate-release-metadata.mjs';
import { serializeRuntimeRequirements } from './generate-runtime-requirements.mjs';
import {
    canonicalJson,
    DEFAULT_PACKAGE_VERSION,
    generateManifest,
    REQUIREMENTS_PATH,
    sha256,
    validateProvenance,
    zipBasenameForVersion,
} from './runtime-package-manifest.mjs';
import { verifyProduct, PROJECT_DIR } from './verify-runtime-package.mjs';
import { readRuntimePayloads } from './package-runtime.mjs';
import { digest, provenance, writeNew, writeRuntimeProduct as fixture } from './test-runtime-product.mjs';

const DEFAULT_ZIP_BASENAME = zipBasenameForVersion(DEFAULT_PACKAGE_VERSION);

test('provenance rejects malformed toolchain identities', () => {
    const cases = [
        ['node_sha256', 'bad', /node_sha256/],
        ['pyodide_release_commit', 'bad', /pyodide_release_commit/],
        ['emsdk_commit', 'bad', /emsdk_commit/],
        ['python_version', '', /python_version/],
        ['abi', '   ', /abi/],
        ['node_bytes', 0, /node_bytes/],
        ['node_bytes', Number.MAX_SAFE_INTEGER + 1, /node_bytes/],
    ];
    for (const [key, value, pattern] of cases) {
        const candidate = provenance();
        candidate.toolchain[key] = value;
        assert.throws(() => validateProvenance(candidate), pattern, key);
    }
});

test('Keripy provenance accepts an absent metadata patch and validates older patch digests', () => {
    const candidate = provenance();
    assert.equal(validateProvenance(candidate), candidate);
    candidate.packages.keripy.metadata_patch_sha256 = 'bad';
    assert.throws(() => validateProvenance(candidate), /metadata_patch_sha256/);
    delete candidate.packages.keripy.metadata_patch_sha256;
    assert.equal(validateProvenance(candidate), candidate);
    candidate.packages.keripy.unexpected = digest;
    assert.throws(() => validateProvenance(candidate), /Provenance package keripy/);
});

test('portable verifier accepts the canonical generic product and rejects a bad sidecar', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fortweb-runtime-package-portable.'));
    try {
        await fixture(root);
        const report = await verifyProduct(root);
        assert.equal(report.zip_entries, 7);
        assert.equal(report.package_version, DEFAULT_PACKAGE_VERSION);
        await rm(path.join(root, `${DEFAULT_ZIP_BASENAME}.sha256`));
        await writeNew(path.join(root, `${DEFAULT_ZIP_BASENAME}.sha256`), Buffer.from('bad\n'));
        await assert.rejects(verifyProduct(root), /sidecar/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('portable verifier pins every version-bearing product name and field', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fortweb-runtime-package-version.'));
    try {
        await fixture(root, { packageVersion: '1.2.3' });
        const report = await verifyProduct(root, { packageVersion: '1.2.3' });
        assert.equal(report.package_version, '1.2.3');
        assert.deepEqual(
            report.product_files.map((row) => row.path).sort(),
            ['fortweb-release.json', 'fortweb-runtime-1.2.3.zip', 'fortweb-runtime-1.2.3.zip.sha256'],
        );
        // Deriving the version from the metadata keeps local/dev verification working.
        assert.equal((await verifyProduct(root)).package_version, '1.2.3');
        // An expected version from the trusted tag must reject a differently versioned product.
        await assert.rejects(verifyProduct(root, { packageVersion: '1.2.4' }), /package version/);
        // Product filenames must agree with the expected version, not just the metadata.
        await rename(
            path.join(root, 'fortweb-runtime-1.2.3.zip'),
            path.join(root, 'fortweb-runtime-1.2.4.zip'),
        );
        await assert.rejects(verifyProduct(root, { packageVersion: '1.2.3' }), /file set is not exact/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('portable verifier rejects a manifest that disagrees with the expected version', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fortweb-runtime-package-manifest-version.'));
    try {
        await fixture(root, { packageVersion: '1.2.3', manifestOverrides: { package_version: '1.2.4' } });
        await assert.rejects(verifyProduct(root, { packageVersion: '1.2.3' }), /Manifest package_version/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('portable verifier rejects incompatible contracts even with matching package checksums', async () => {
    const v1 = { ...JSON.parse(serializeRuntimeRequirements()), schema: 'fort.runtime-requirements.v1', version: 1 };
    const contradictory = JSON.parse(serializeRuntimeRequirements());
    contradictory.forbidden_behaviors.push('network_fetch');
    const cases = [
        [{ requirements: canonicalJson(v1) }, /Runtime requirements mismatch/],
        [{ requirements: canonicalJson(contradictory) }, /Runtime requirements mismatch/],
        [{ manifestOverrides: { schema_version: '1.0.0' } }, /Manifest schema_version/],
        [{ manifestOverrides: { runtime_origin: 'https://appassets.androidplatform.net' } }, /Manifest has an unexpected key set/],
        [{ releaseOverrides: { schema_version: '1.0.0' } }, /Release metadata mismatch/],
        [{ releaseOverrides: { runtime_origin: 'https://appassets.androidplatform.net' } }, /Release metadata mismatch/],
    ];
    for (const [overrides, expected] of cases) {
        const root = await mkdtemp(path.join(os.tmpdir(), 'fortweb-runtime-contract.'));
        try {
            await fixture(root, overrides);
            await assert.rejects(verifyProduct(root), expected);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }
});

test('producer reads only the complete verified runtime and rejects unsafe paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fortweb-runtime-input.'));
    try {
        await mkdir(path.join(root, 'app'));
        await writeFile(path.join(root, 'app/index.html'), 'app');
        const rows = [{ path: 'app/index.html', bytes: 3, sha256: sha256('app') }];
        // macOS exposes its temporary directory through /var -> /private/var.
        const { realpath } = await import('node:fs/promises');
        const runtime = await realpath(root);
        assert.equal((await readRuntimePayloads(runtime, rows)).get('app/index.html').toString(), 'app');
        await assert.rejects(readRuntimePayloads(runtime, [{ ...rows[0], path: '../outside' }]), /path/i);
        await writeFile(path.join(root, 'extra'), 'extra');
        await assert.rejects(readRuntimePayloads(runtime, rows), /file set/);
        await rm(path.join(root, 'extra'));
        await writeFile(path.join(root, 'app/index.html'), 'changed');
        await assert.rejects(readRuntimePayloads(runtime, rows), /byte mismatch/);
        await rm(path.join(root, 'app/index.html'));
        await symlink('../outside', path.join(root, 'app/index.html'));
        await assert.rejects(readRuntimePayloads(runtime, rows), /symlink/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('CLI entry point verifies through a symlinked path instead of silently exiting 0', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fortweb-runtime-package-symlink.'));
    const product = path.join(root, 'product');
    const linkDir = path.join(root, 'linkdir');
    try {
        await mkdir(product);
        await fixture(product);
        await mkdir(linkDir);
        // A symlink to the file and a symlink to its directory both have to work,
        // because both make a lexical main-module comparison fail.
        const linkedFile = path.join(linkDir, 'verify-runtime-package.mjs');
        await symlink(fileURLToPath(new URL('./verify-runtime-package.mjs', import.meta.url)), linkedFile);
        await symlink(path.join(PROJECT_DIR, 'tools'), path.join(linkDir, 'tools'));
        const linkedDirPath = path.join(linkDir, 'tools', 'verify-runtime-package.mjs');

        for (const entry of [linkedFile, linkedDirPath]) {
            const valid = spawnSync(process.execPath, [entry, '--product-dir', product], { encoding: 'utf8' });
            assert.equal(valid.status, 0, valid.stderr);
            assert.notEqual(valid.stdout.trim(), '', `symlinked CLI produced no output: ${entry}`);
            assert.equal(JSON.parse(valid.stdout).ok, true);

            const missing = spawnSync(process.execPath, [entry], { encoding: 'utf8' });
            assert.notEqual(missing.status, 0, `symlinked CLI without arguments must fail closed: ${entry}`);
            assert.match(missing.stderr, /Usage/);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('portable verifier rejects a writerless FIFO product entry without blocking', async (t) => {
    // The metadata filename is version independent, so an implementation may be
    // tempted to resolve it before inventorying directory entry types. Opening it is
    // what blocks: a FIFO with no writer hangs forever. This regression pins the fix
    // at the sharpest possible name.
    const probe = spawnSync('mkfifo', [], { encoding: 'utf8' });
    if (probe.error?.code === 'ENOENT') {
        // Availability is probed rather than assumed. The regression must run on the
        // Linux hosted path; a developer platform without mkfifo skips explicitly
        // instead of silently passing.
        t.skip('mkfifo is unavailable on this platform; the FIFO regression requires the Linux hosted path');
        return;
    }
    const root = await mkdtemp(path.join(os.tmpdir(), 'fortweb-runtime-package-fifo.'));
    const product = path.join(root, 'product');
    try {
        await mkdir(product);
        await fixture(product);
        await rm(path.join(product, 'fortweb-release.json'));
        const fifo = spawnSync('mkfifo', [path.join(product, 'fortweb-release.json')], { encoding: 'utf8' });
        assert.equal(fifo.status, 0, fifo.stderr);
        // No writer is ever started, so anything that opens this path blocks. The
        // subprocess timeout converts that hang into an explicit assertion failure
        // rather than a stuck CI job.
        const result = spawnSync(process.execPath, [
            fileURLToPath(new URL('./verify-runtime-package.mjs', import.meta.url)),
            '--product-dir', product,
        ], { encoding: 'utf8', timeout: 15000 });
        assert.equal(result.error, undefined, 'the verifier must not block on a writerless FIFO');
        assert.notEqual(result.status, 0, 'a FIFO product entry must fail closed');
        assert.match(result.stderr, /Unexpected product entry type: fortweb-release\.json/);
        assert.equal(result.stdout.includes('"ok": true'), false, 'no success receipt may be produced');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
