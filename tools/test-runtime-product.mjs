// Shared builders for a genuinely valid canonical runtime product.
//
// Both the product verifier suite and the release verifier suite need a product that
// passes every internal check, so the provenance shape and the product assembly live
// in one place instead of being copied between suites. The only thing a caller
// normally varies is the ref and the package version, which is what distinguishes a
// branch build from a release-tag build.
import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import path from 'node:path';

import { createDeterministicZip } from './deterministic-zip.mjs';
import { generateReleaseMetadata } from './generate-release-metadata.mjs';
import { serializeRuntimeRequirements } from './generate-runtime-requirements.mjs';
import {
    canonicalJson,
    DEFAULT_PACKAGE_VERSION,
    generateManifest,
    REQUIREMENTS_PATH,
    sha256,
    zipBasenameForVersion,
} from './runtime-package-manifest.mjs';

export const digest = '1'.repeat(64);

export function provenance() {
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

export async function writeNew(filename, data) {
    const handle = await open(filename, 'wx', 0o644);
    try { await handle.writeFile(data); } finally { await handle.close(); }
}

export async function writeRuntimeProduct(root, {
    ref = 'refs/heads/pyodide-314-runtime',
    requirements = serializeRuntimeRequirements(),
    manifestOverrides = {},
    releaseOverrides = {},
    packageVersion = DEFAULT_PACKAGE_VERSION,
} = {}) {
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
        ref,
        packageVersion,
    }), ...releaseOverrides })));
    return { fortwebCommitSha, zipBasename, zipDigest };
}
