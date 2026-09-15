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

const DEFAULT_ZIP_BASENAME = zipBasenameForVersion(DEFAULT_PACKAGE_VERSION);

const digest = '1'.repeat(64);

function provenance() {
    const packageKeys = {
        hio: ['commit', 'version', 'wheel_filename', 'wheel_sha256'],
        keripy: ['commit', 'metadata_patch_sha256', 'version', 'wheel_filename', 'wheel_sha256'],
        msgpack: ['source_sha256', 'version', 'wheel_filename', 'wheel_sha256'],
        cbor2: ['cargo_acquisition_sha256', 'cargo_lock_sha256', 'source_sha256', 'version', 'wheel_filename', 'wheel_sha256'],
        blake3: ['cargo_acquisition_sha256', 'final_cargo_lock_sha256', 'lock_patch_sha256', 'original_cargo_lock_sha256', 'source_patch_sha256', 'source_sha256', 'version', 'wheel_filename', 'wheel_sha256'],
        cryptography: ['cargo_acquisition_sha256', 'cargo_lock_sha256', 'source_sha256', 'version', 'wheel_filename', 'wheel_sha256'],
        openssl: ['source_sha256', 'version'],
        pysodium: ['conversion_patch_sha256', 'libsodium_source_sha256', 'libsodium_version', 'source_archive_sha256', 'source_commit', 'source_project', 'version', 'wheel_filename', 'wheel_sha256'],
    };
    const packages = Object.fromEntries(Object.entries(packageKeys).map(([name, keys]) => [
        name,
        Object.fromEntries(keys.map((key) => [
            key,
            key.includes('sha256') ? digest : (key === 'commit' || key === 'source_commit' ? '1'.repeat(40) : 'fixed'),
        ])),
    ]));
    const runtime = Object.fromEntries([
        'baseline_runtime_source_identity_sha256', 'baseline_runtime_final_verification_sha256',
        'baseline_runtime_canonical_inventory_sha256', 'baseline_runtime_tree_aggregate_sha256',
        'current_runtime_inventory_sha256', 'current_runtime_tree_aggregate_sha256',
        'runtime_closure_sha256', 'wheelhouse_manifest_sha256',
    ].map((key) => [key, digest]));
    const toolchainKeys = [
        'wheelhouse_toolchain_sha256', 'pyodide_version', 'python_version', 'emscripten_version',
        'abi', 'pyodide_release_commit', 'pyodide_lock_sha256', 'pyodide_core_sha256',
        'xbuildenv_sha256', 'emsdk_commit', 'rust_version', 'node_version',
        'node_sha256', 'node_bytes',
    ];
    const toolchain = Object.fromEntries(toolchainKeys.map((key) => [
        key,
        key === 'node_bytes'
            ? 1
            : (key.includes('sha256')
                ? digest
                : (key.endsWith('_commit') ? '1'.repeat(40) : 'fixed')),
    ]));
    const consumer = { commit: '1'.repeat(40), files: [{ path: 'x', sha256: digest }] };
    return {
        consumers: { fort_ios: consumer, fortoid: consumer },
        packages,
        packaging: { package_inputs_sha256: digest, profile: 'fortweb.deterministic-zip.v1', source_files: [] },
        runtime,
        schema: 'fortweb.runtime-package-provenance.v2',
        source: { fortweb_commit_sha: '1'.repeat(40), source_identity_sha256: digest },
        toolchain,
    };
}

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

async function writeNew(filename, data) {
    const handle = await open(filename, 'wx', 0o644);
    try { await handle.writeFile(data); } finally { await handle.close(); }
}

async function fixture(root, { requirements = serializeRuntimeRequirements(), manifestOverrides = {}, releaseOverrides = {}, packageVersion = DEFAULT_PACKAGE_VERSION } = {}) {
    const content = new Map([['app/index.html', Buffer.from('app')]]);
    for (let index = 0; index < 3; index += 1) {
        content.set(`payload/${String(index).padStart(3, '0')}.bin`, Buffer.from([index]));
    }
    content.set(REQUIREMENTS_PATH, Buffer.from(requirements));
    const rows = [...content].map(([memberPath, data]) => ({
        bytes: data.length, path: memberPath, sha256: sha256(data),
    })).sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
    const packageProvenance = provenance();
    const fortwebCommitSha = packageProvenance.source.fortweb_commit_sha;
    const manifestValue = generateManifest({
        files: rows,
        provenance: packageProvenance,
        fortwebCommitSha,
        packageVersion,
    });
    assert.equal(manifestValue.schema_version, '2.0.0');
    assert.equal(Object.hasOwn(manifestValue, 'runtime_origin'), false);
    const manifest = Buffer.from(canonicalJson({ ...manifestValue, ...manifestOverrides }));
    const checksum = Buffer.from(`${sha256(manifest)}  manifest.json\n`);
    const zip = createDeterministicZip([
        ...[...content].map(([memberPath, data]) => ({ name: `fortweb-runtime/${memberPath}`, data })),
        { name: 'fortweb-runtime/manifest.json', data: manifest },
        { name: 'fortweb-runtime/checksums.sha256', data: checksum },
    ]);
    const zipDigest = sha256(zip);
    const zipBasename = zipBasenameForVersion(packageVersion);
    await writeNew(path.join(root, zipBasename), zip);
    await writeNew(path.join(root, `${zipBasename}.sha256`), Buffer.from(`${zipDigest}  ${zipBasename}\n`));
    await writeNew(path.join(root, 'fortweb-release.json'), Buffer.from(canonicalJson({ ...generateReleaseMetadata({
        artifactSha256: zipDigest,
        artifactBytes: zip.length,
        fortwebCommitSha,
        ref: 'refs/heads/pyodide-314-runtime',
        packageVersion,
    }), ...releaseOverrides })));
}

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
