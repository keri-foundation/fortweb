import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { writeRuntimeProduct } from './test-runtime-product.mjs';

const execFileAsync = promisify(execFile);
const VERIFIER = fileURLToPath(new URL('./verify-fortweb-release.sh', import.meta.url));
const REPO = 'keri-foundation/fortweb';
const TAG = 'v1.2.3';

async function scratch(prefix) {
    return mkdtemp(path.join(os.tmpdir(), `fortweb-release-${prefix}-`));
}

// The verifier must fail closed before it reaches the network, so these cases are
// fully offline. A non-zero exit is the expected result for every rejection.
async function verify(args, env = process.env) {
    try {
        const result = await execFileAsync('bash', [VERIFIER, ...args], { env });
        return { code: 0, stderr: result.stderr, stdout: result.stdout };
    } catch (error) {
        return { code: error.code ?? 1, stderr: error.stderr ?? '', stdout: error.stdout ?? '' };
    }
}

test('release verification refuses tags that are not v-prefixed release versions', async () => {
    const out = await scratch('out');
    try {
        for (const tag of ['', 'latest', 'main', 'refs/heads/main', 'refs/tags/v1.2.3', '1.2.3', 'v1.2', 'vx']) {
            const result = await verify(['--repo', REPO, '--tag', tag, '--out', out]);
            assert.notEqual(result.code, 0, `tag should be rejected: ${tag}`);
            assert.match(result.stderr, /--tag (must be a v-prefixed release version|is required)/, tag);
        }
    } finally {
        await rm(out, { recursive: true, force: true });
    }
});

test('release verification refuses repositories that are not a plain owner/name', async () => {
    const out = await scratch('out');
    try {
        for (const repo of ['', 'fortweb', 'a/b/c', 'a/', '/b', '../x', 'a/../b']) {
            const result = await verify(['--repo', repo, '--tag', TAG, '--out', out]);
            assert.notEqual(result.code, 0, `repository should be rejected: ${repo}`);
            assert.match(result.stderr, /--repo (must be|is required)/, repo);
        }
    } finally {
        await rm(out, { recursive: true, force: true });
    }
});

test('release verification refuses publisher workflow paths outside the workflows directory', async () => {
    const out = await scratch('out');
    try {
        for (const workflow of ['evil.yml', 'workflows/x.yml', '.github/actions/x.yml', '.github/workflows/../evil.yml', '']) {
            const result = await verify(['--repo', REPO, '--tag', TAG, '--out', out, '--expected-workflow', workflow]);
            assert.notEqual(result.code, 0, `workflow should be rejected: ${workflow}`);
            assert.match(result.stderr, /--expected-workflow must not contain path traversal|--expected-workflow must be a \.github\/workflows/, workflow);
        }
    } finally {
        await rm(out, { recursive: true, force: true });
    }
});

test('local verification requires an explicit attestation skip', async () => {
    const product = await scratch('product');
    const out = await scratch('out');
    try {
        const result = await verify(['--repo', REPO, '--tag', TAG, '--out', out, '--product-dir', product]);
        assert.notEqual(result.code, 0);
        assert.match(result.stderr, /--skip-attestation-for-local-only/);
    } finally {
        await rm(product, { recursive: true, force: true });
        await rm(out, { recursive: true, force: true });
    }
});

test('a failing local verification preserves the caller product directory and writes no receipt', async () => {
    const product = await scratch('product');
    const out = await scratch('out');
    try {
        await writeFile(path.join(product, 'keep.txt'), 'caller data\n');
        const result = await verify([
            '--repo', REPO, '--tag', TAG, '--out', out,
            '--product-dir', product, '--skip-attestation-for-local-only',
        ]);
        assert.notEqual(result.code, 0);
        assert.match(result.stderr, /missing release metadata/);
        assert.equal(existsSync(path.join(product, 'keep.txt')), true);
        assert.equal(existsSync(path.join(out, 'fortweb-verification-receipt.json')), false);
    } finally {
        await rm(product, { recursive: true, force: true });
        await rm(out, { recursive: true, force: true });
    }
});

test('a product that nominates its own publisher is rejected before any package check', async () => {
    const product = await scratch('product');
    const out = await scratch('out');
    try {
        await mkdir(product, { recursive: true });
        await writeFile(path.join(product, 'fortweb-release.json'), JSON.stringify({
            artifact_name: 'fortweb-runtime-1.2.3.zip',
            artifact_sha256: '0'.repeat(64),
            commit_sha: '1'.repeat(40),
            ref: 'refs/tags/v1.2.3',
            workflow_identity: 'https://github.com/attacker/fork/.github/workflows/evil.yml@refs/tags/v1.2.3',
        }));
        const result = await verify([
            '--repo', REPO, '--tag', TAG, '--out', out,
            '--product-dir', product, '--skip-attestation-for-local-only',
        ]);
        assert.notEqual(result.code, 0);
        assert.match(result.stderr, /recorded workflow identity is neither/);
        assert.doesNotMatch(result.stderr, /verify-runtime-package/);
        assert.equal(existsSync(path.join(out, 'fortweb-verification-receipt.json')), false);
    } finally {
        await rm(product, { recursive: true, force: true });
        await rm(out, { recursive: true, force: true });
    }
});

test('an unpublished local build passes the trust gate and is then checked by the canonical verifier', async () => {
    const product = await scratch('product');
    const out = await scratch('out');
    try {
        await mkdir(product, { recursive: true });
        await writeFile(path.join(product, 'fortweb-release.json'), JSON.stringify({
            artifact_name: 'fortweb-runtime-1.2.3.zip',
            artifact_sha256: '0'.repeat(64),
            commit_sha: '1'.repeat(40),
            ref: 'refs/heads/pyodide-314-runtime',
            workflow_identity: 'unpublished-local-build',
        }));
        const result = await verify([
            '--repo', REPO, '--tag', TAG, '--out', out,
            '--product-dir', product, '--skip-attestation-for-local-only',
        ]);
        assert.notEqual(result.code, 0);
        // The trust-root gate admits this product; the delegated verifier rejects it.
        assert.match(result.stderr, /verify-runtime-package/);
        assert.equal(existsSync(path.join(out, 'fortweb-verification-receipt.json')), false);
    } finally {
        await rm(product, { recursive: true, force: true });
        await rm(out, { recursive: true, force: true });
    }
});

const RELEASE_IDENTITY = `https://github.com/${REPO}/.github/workflows/fortweb-runtime-package.yml@refs/tags/${TAG}`;

// A stand-in for `gh`, placed first in PATH. It supports only the two subcommands the
// release path uses, and it pins the expected release tag, repository, artifact name,
// and identity. Because it accepts exactly one identity value, a verifier that passed
// anything else fails here. The regex flag variants exit non-zero on purpose: this path
// requires an exact identity, so a weakened or misspelled flag must never pass.
const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail

printf '%s\\n' "$*" >> "\${FAKE_GH_LOG}"

case "\${1:-}" in
  release)
    [[ "\${2:-}" == "download" ]] || { echo "fake gh: unsupported release subcommand" >&2; exit 2; }
    tag="\${3:-}"
    shift 3
    dir=""; pattern=""; repo=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --repo) repo="$2"; shift 2 ;;
        --pattern) pattern="$2"; shift 2 ;;
        --dir) dir="$2"; shift 2 ;;
        --clobber) shift ;;
        *) echo "fake gh: unexpected release argument: $1" >&2; exit 2 ;;
      esac
    done
    [[ "\${tag}" == "\${FAKE_GH_TAG}" ]] || { echo "fake gh: unexpected tag \${tag}" >&2; exit 1; }
    [[ "\${repo}" == "\${FAKE_GH_REPO}" ]] || { echo "fake gh: unexpected repo \${repo}" >&2; exit 1; }
    cp "\${FAKE_GH_ASSETS}/\${pattern}" "\${dir}/\${pattern}"
    ;;
  attestation)
    [[ "\${2:-}" == "verify" ]] || { echo "fake gh: unsupported attestation subcommand" >&2; exit 2; }
    artifact="\${3:-}"
    shift 3
    identity=""; repo=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --repo) repo="$2"; shift 2 ;;
        --cert-identity) identity="$2"; shift 2 ;;
        --cert-identity-regex|--cert-identity-regexp)
          echo "fake gh: exact --cert-identity is required, got $1" >&2; exit 3 ;;
        *) echo "fake gh: unexpected attestation argument: $1" >&2; exit 2 ;;
      esac
    done
    [[ "$(basename "\${artifact}")" == "\${FAKE_GH_ARTIFACT}" ]] || { echo "fake gh: unexpected artifact \${artifact}" >&2; exit 1; }
    [[ "\${repo}" == "\${FAKE_GH_REPO}" ]] || { echo "fake gh: unexpected repo \${repo}" >&2; exit 1; }
    [[ "\${identity}" == "\${FAKE_GH_IDENTITY}" ]] || { echo "fake gh: unexpected identity \${identity}" >&2; exit 1; }
    ;;
  *)
    echo "fake gh: unsupported command: \${1:-}" >&2
    exit 2
    ;;
esac
`;

function fakeGhEnv({ assets, bin, identity = RELEASE_IDENTITY, log }) {
    return {
        ...process.env,
        FAKE_GH_ARTIFACT: 'fortweb-runtime-1.2.3.zip',
        FAKE_GH_ASSETS: assets,
        FAKE_GH_IDENTITY: identity,
        FAKE_GH_LOG: log,
        FAKE_GH_REPO: REPO,
        FAKE_GH_TAG: TAG,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    };
}

async function releaseHarness(prefix) {
    const root = await scratch(prefix);
    const assets = path.join(root, 'assets');
    const bin = path.join(root, 'bin');
    const out = path.join(root, 'out');
    const log = path.join(root, 'gh.log');
    await mkdir(assets, { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(out, { recursive: true });
    await writeRuntimeProduct(assets, { ref: `refs/tags/${TAG}`, packageVersion: '1.2.3' });
    await writeFile(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
    await writeFile(log, '');
    return { assets, bin, log, out, root };
}

test('release mode downloads the tagged assets and verifies an exact publisher identity', async () => {
    const { assets, bin, log, out, root } = await releaseHarness('release');
    try {
        // No --product-dir and no attestation skip, so this genuinely enters release mode.
        const result = await verify(
            ['--repo', REPO, '--tag', TAG, '--out', out],
            fakeGhEnv({ assets, bin, log }),
        );
        assert.equal(result.code, 0, result.stderr);
        const receipt = JSON.parse(await readFile(path.join(out, 'fortweb-verification-receipt.json'), 'utf8'));
        assert.equal(receipt.verification_mode, 'release');
        assert.equal(receipt.attestation_verified, true);
        assert.equal(receipt.package_version, '1.2.3');
        assert.equal(receipt.artifact_name, 'fortweb-runtime-1.2.3.zip');
        assert.equal(receipt.workflow_identity, RELEASE_IDENTITY);
        const invocations = await readFile(log, 'utf8');
        assert.match(invocations, /release download v1\.2\.3 --repo keri-foundation\/fortweb/);
        assert.match(invocations, /attestation verify .*fortweb-runtime-1\.2\.3\.zip --repo keri-foundation\/fortweb --cert-identity /);
        assert.doesNotMatch(invocations, /--cert-identity-regex/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('release mode fails closed when the attestation identity is not the exact expected one', async () => {
    const { assets, bin, log, out, root } = await releaseHarness('release-identity');
    try {
        // Same repository and workflow, different tag: a plausible but wrong identity.
        const wrong = `https://github.com/${REPO}/.github/workflows/fortweb-runtime-package.yml@refs/tags/v9.9.9`;
        const result = await verify(
            ['--repo', REPO, '--tag', TAG, '--out', out],
            fakeGhEnv({ assets, bin, identity: wrong, log }),
        );
        assert.notEqual(result.code, 0);
        assert.match(result.stderr, /unexpected identity/);
        assert.equal(existsSync(path.join(out, 'fortweb-verification-receipt.json')), false);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
