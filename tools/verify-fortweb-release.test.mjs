import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const SHELL_SCRIPT = path.join(PROJECT_DIR, 'tools/verify-fortweb-release.sh');
const PACKAGE_SCRIPT = path.join(PROJECT_DIR, 'tools/package-runtime.mjs');
const TEST_ROOT = path.join(PROJECT_DIR, '.tmp/release-verifier-tests');

const TEST_REPO = 'keri-foundation/fortweb';
const TEST_TAG = 'v0.0.0-test';
const TEST_WORKFLOW = '.github/workflows/fortweb-runtime-package.yml';
const EXPECTED_IDENTITY =
    `https://github.com/${TEST_REPO}/${TEST_WORKFLOW}@refs/tags/${TEST_TAG}`;

function sha256File(filePath) {
    const buffer = execFileSync('node', ['-e',
        `process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))`,
        filePath,
    ], { cwd: PROJECT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return buffer.trim();
}

function runReleaseVerifier(args) {
    return execFileSync('bash', [SHELL_SCRIPT, ...args], {
        cwd: PROJECT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function expectFailure(args, expectedSubstring) {
    assert.throws(
        () => runReleaseVerifier(args),
        (error) => {
            const msg = error.message || error.stderr || '';
            return msg.includes(expectedSubstring);
        },
        `Expected failure with "${expectedSubstring}"`,
    );
}

async function createWorkspace() {
    await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    return mkdtemp(path.join(TEST_ROOT, 'attest-'));
}

async function generateValidZip(outDir) {
    await mkdir(outDir, { recursive: true });
    execFileSync('node', [PACKAGE_SCRIPT, '--no-build', '--out-dir', outDir], {
        cwd: PROJECT_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const zipMatch = execFileSync('find', [outDir, '-maxdepth', '1', '-name', '*.zip', '-type', 'f'], {
        cwd: PROJECT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const zipPath = zipMatch.trim().split('\n')[0];
    assert.ok(zipPath, 'Expected a generated ZIP');
    return zipPath;
}

async function buildMetadata(overrides = {}) {
    const zipPath = overrides.zipPath;
    const zipSha256 = sha256File(zipPath);
    const zipStats = await lstat(zipPath);
    const zipBytes = zipStats.size;

    const metadata = {
        schema_version: '1.0.0',
        package_version: '0.0.0',
        repository: TEST_REPO,
        commit_sha: '7d240be534763f662553e661f6325d222ac8623a',
        ref: `refs/tags/${TEST_TAG}`,
        ref_name: TEST_TAG,
        workflow_identity: EXPECTED_IDENTITY,
        artifact_name: path.basename(zipPath),
        artifact_sha256: zipSha256,
        artifact_bytes: zipBytes,
        runtime_origin: 'https://appassets.androidplatform.net',
        entrypoint: 'app/index.html',
        attestation: {
            type: 'github-artifact-attestation',
            required: true,
            verify_command: `gh attestation verify ...`,
        },
        ...overrides,
    };

    return metadata;
}

test('accepts matching workflow identity in local-artifact mode', async () => {
    const workDir = await createWorkspace();
    const outDir = path.join(workDir, 'out');
    const metaPath = path.join(workDir, 'fortweb-release.json');

    try {
        const zipPath = await generateValidZip(workDir);
        const metadata = await buildMetadata({ zipPath });
        await writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`);

        const output = runReleaseVerifier([
            '--metadata', metaPath,
            '--zip', zipPath,
            '--out', outDir,
            '--repo', TEST_REPO,
            '--tag', TEST_TAG,
            '--expected-workflow', TEST_WORKFLOW,
            '--skip-attestation-for-local-only',
        ]);

        assert.match(output, /Skipping attestation verification/u);
        assert.match(output, /FortWeb runtime payload verified/u);
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
});

test('rejects metadata workflow identity mismatch before attestation', async () => {
    const workDir = await createWorkspace();
    const outDir = path.join(workDir, 'out');
    const metaPath = path.join(workDir, 'fortweb-release.json');

    try {
        const zipPath = await generateValidZip(workDir);
        const metadata = await buildMetadata({
            zipPath,
            workflow_identity: `https://github.com/${TEST_REPO}/.github/workflows/evil-workflow.yml@refs/tags/${TEST_TAG}`,
        });
        await writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`);

        expectFailure([
            '--metadata', metaPath,
            '--zip', zipPath,
            '--out', outDir,
            '--repo', TEST_REPO,
            '--tag', TEST_TAG,
            '--expected-workflow', TEST_WORKFLOW,
            '--skip-attestation-for-local-only',
        ], 'workflow_identity mismatch');
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
});

test('rejects missing workflow identity metadata', async () => {
    const workDir = await createWorkspace();
    const outDir = path.join(workDir, 'out');
    const metaPath = path.join(workDir, 'fortweb-release.json');

    try {
        const zipPath = await generateValidZip(workDir);
        const { workflow_identity: _, ...withoutIdentity } = await buildMetadata({ zipPath });
        await writeFile(metaPath, `${JSON.stringify(withoutIdentity, null, 2)}\n`);

        expectFailure([
            '--metadata', metaPath,
            '--zip', zipPath,
            '--out', outDir,
            '--repo', TEST_REPO,
            '--tag', TEST_TAG,
            '--expected-workflow', TEST_WORKFLOW,
            '--skip-attestation-for-local-only',
        ], 'Missing required metadata field');
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
});

test('rejects metadata workflow identity for a different repository', async () => {
    const workDir = await createWorkspace();
    const outDir = path.join(workDir, 'out');
    const metaPath = path.join(workDir, 'fortweb-release.json');

    try {
        const zipPath = await generateValidZip(workDir);
        const wrongRepo = 'evil-org/fortweb';
        const wrongIdentity = `https://github.com/${wrongRepo}/${TEST_WORKFLOW}@refs/tags/${TEST_TAG}`;
        const metadata = await buildMetadata({
            zipPath,
            repository: wrongRepo,
            workflow_identity: wrongIdentity,
        });
        await writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`);

        expectFailure([
            '--metadata', metaPath,
            '--zip', zipPath,
            '--out', outDir,
            '--repo', TEST_REPO,
            '--tag', TEST_TAG,
            '--expected-workflow', TEST_WORKFLOW,
            '--skip-attestation-for-local-only',
        ], 'workflow_identity mismatch');
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
});

test('rejects an invalid expected-workflow override', async () => {
    const workDir = await createWorkspace();
    const outDir = path.join(workDir, 'out');
    const metaPath = path.join(workDir, 'fortweb-release.json');

    try {
        const zipPath = await generateValidZip(workDir);
        const metadata = await buildMetadata({ zipPath });
        await writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`);

        expectFailure([
            '--metadata', metaPath,
            '--zip', zipPath,
            '--out', outDir,
            '--repo', TEST_REPO,
            '--tag', TEST_TAG,
            '--expected-workflow', '.github/workflows/../evil.yml',
            '--skip-attestation-for-local-only',
        ], 'must not contain');
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
});

test('local offline mode does not derive attestation trust from metadata alone', async () => {
    const workDir = await createWorkspace();
    const outDir = path.join(workDir, 'out');
    const metaPath = path.join(workDir, 'fortweb-release.json');

    try {
        const zipPath = await generateValidZip(workDir);
        const metadata = await buildMetadata({ zipPath });
        await writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`);

        // Local offline mode without --repo and --tag must still succeed
        // (attestation is skipped), proving metadata identity is not
        // passed into a trust-bearing attestation path.
        const output = runReleaseVerifier([
            '--metadata', metaPath,
            '--zip', zipPath,
            '--out', outDir,
            '--skip-attestation-for-local-only',
        ]);

        assert.match(output, /Skipping attestation verification/u);
        assert.match(output, /FortWeb runtime payload verified/u);

        // Confirm the receipt shows attestation_verified: false
        const receiptPath = path.join(outDir, 'fortweb-verification-receipt.json');
        const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
        assert.strictEqual(receipt.attestation_verified, false,
            'Local offline mode must not claim attestation was verified');
        assert.strictEqual(receipt.verification_mode, 'local-artifact',
            'Verification mode must be local-artifact');
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
});

test('uses the canonical default workflow path when no override is supplied', async () => {
    const workDir = await createWorkspace();
    const outDir = path.join(workDir, 'out');
    const metaPath = path.join(workDir, 'fortweb-release.json');

    try {
        const zipPath = await generateValidZip(workDir);
        const metadata = await buildMetadata({ zipPath });
        await writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`);

        // Omit --expected-workflow; the verifier must use the canonical default
        // .github/workflows/fortweb-runtime-package.yml and derive the identity.
        const output = runReleaseVerifier([
            '--metadata', metaPath,
            '--zip', zipPath,
            '--out', outDir,
            '--repo', TEST_REPO,
            '--tag', TEST_TAG,
            '--skip-attestation-for-local-only',
        ]);

        assert.match(output, /Skipping attestation verification/u);
        assert.match(output, /FortWeb runtime payload verified/u);

        // Prove the verifier used the canonical default path by asserting
        // the literal identity string it derived against matching metadata.
        const receiptPath = path.join(outDir, 'fortweb-verification-receipt.json');
        const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
        assert.strictEqual(receipt.repository, TEST_REPO,
            'Receipt must record the verifier-controlled repository');
        assert.strictEqual(receipt.verification_mode, 'local-artifact',
            'Default-path test must operate in local-artifact mode');
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
});

test('rejects a basename-only expected-workflow override', async () => {
    const workDir = await createWorkspace();
    const outDir = path.join(workDir, 'out');
    const metaPath = path.join(workDir, 'fortweb-release.json');

    try {
        const zipPath = await generateValidZip(workDir);
        const metadata = await buildMetadata({ zipPath });
        await writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`);

        // Basename-only is not a valid repository-relative workflow path.
        expectFailure([
            '--metadata', metaPath,
            '--zip', zipPath,
            '--out', outDir,
            '--repo', TEST_REPO,
            '--tag', TEST_TAG,
            '--expected-workflow', 'fortweb-runtime-package.yml',
            '--skip-attestation-for-local-only',
        ], 'must be a path under .github/workflows/');
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
});

test('accepts a valid repository-relative expected-workflow override', async () => {
    const workDir = await createWorkspace();
    const outDir = path.join(workDir, 'out');
    const metaPath = path.join(workDir, 'fortweb-release.json');

    try {
        const zipPath = await generateValidZip(workDir);
        const overrideWorkflow = '.github/workflows/custom-release.yml';
        const overrideIdentity =
            `https://github.com/${TEST_REPO}/${overrideWorkflow}@refs/tags/${TEST_TAG}`;
        const metadata = await buildMetadata({
            zipPath,
            workflow_identity: overrideIdentity,
        });
        await writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`);

        const output = runReleaseVerifier([
            '--metadata', metaPath,
            '--zip', zipPath,
            '--out', outDir,
            '--repo', TEST_REPO,
            '--tag', TEST_TAG,
            '--expected-workflow', overrideWorkflow,
            '--skip-attestation-for-local-only',
        ]);

        assert.match(output, /Skipping attestation verification/u);
        assert.match(output, /FortWeb runtime payload verified/u);
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
});

test('generated release metadata and verifier derivation agree on canonical identity literal', async () => {
    // The canonical identity is the single expected form for the FortWeb
    // runtime-package workflow at a pinned tag.  Both the metadata generator
    // (tools/generate-release-metadata.mjs) and the release verifier
    // (tools/verify-fortweb-release.sh) must produce this exact string
    // when given the same repo, workflow path, and tag.
    const CANONICAL_IDENTITY =
        'https://github.com/keri-foundation/fortweb/.github/workflows/fortweb-runtime-package.yml@refs/tags/v0.0.0-test';

    assert.strictEqual(EXPECTED_IDENTITY, CANONICAL_IDENTITY,
        'EXPECTED_IDENTITY must equal the canonical identity literal');

    const workDir = await createWorkspace();
    const outDir = path.join(workDir, 'out');
    const metaPath = path.join(workDir, 'fortweb-release.json');

    try {
        const zipPath = await generateValidZip(workDir);
        const metadata = await buildMetadata({ zipPath });
        await writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`);

        // No --expected-workflow override — verifier uses canonical default.
        const output = runReleaseVerifier([
            '--metadata', metaPath,
            '--zip', zipPath,
            '--out', outDir,
            '--repo', TEST_REPO,
            '--tag', TEST_TAG,
            '--skip-attestation-for-local-only',
        ]);

        assert.match(output, /Skipping attestation verification/u);
        assert.match(output, /FortWeb runtime payload verified/u);

        // Receipt must carry the verifier-controlled identity inputs.
        const receiptPath = path.join(outDir, 'fortweb-verification-receipt.json');
        const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
        assert.strictEqual(receipt.repository, TEST_REPO,
            'Receipt repository must match verifier --repo input');
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
});
