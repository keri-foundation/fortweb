import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const VERIFIER = fileURLToPath(new URL('./verify-fortweb-release.sh', import.meta.url));
const REPO = 'keri-foundation/fortweb';
const TAG = 'v1.2.3';

async function scratch(prefix) {
    return mkdtemp(path.join(os.tmpdir(), `fortweb-release-${prefix}-`));
}

// The verifier must fail closed before it reaches the network, so these cases are
// fully offline. A non-zero exit is the expected result for every rejection.
async function verify(args) {
    try {
        const result = await execFileAsync('bash', [VERIFIER, ...args]);
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
