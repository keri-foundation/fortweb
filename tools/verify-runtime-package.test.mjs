import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RUNTIME_REQUIREMENTS_PATH } from './runtime-package-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const VERIFY_SCRIPT = path.join(PROJECT_DIR, 'tools/verify-runtime-package.mjs');
const PACKAGE_DIR = path.join(PROJECT_DIR, '.tmp/runtime-packages');
const TEST_ROOT = path.join(PROJECT_DIR, '.tmp/runtime-package-verifier-tests');

function runVerifier(zipPath) {
    return execFileSync('node', [VERIFY_SCRIPT, zipPath], {
        cwd: PROJECT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function expectVerifierFailure(zipPath) {
    assert.throws(
        () => runVerifier(zipPath),
        (error) => Boolean(error),
        `Expected verifier to fail for ${zipPath}`,
    );
}

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

async function findNewestZip() {
    const entries = await readdir(PACKAGE_DIR, { withFileTypes: true });
    const zips = [];

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.startsWith('fortweb-runtime-') || !entry.name.endsWith('.zip')) {
            continue;
        }

        const filePath = path.join(PACKAGE_DIR, entry.name);
        const stats = await lstat(filePath);
        zips.push({
            filePath,
            mtimeMs: stats.mtimeMs,
            name: entry.name,
        });
    }

    assert.ok(zips.length > 0, 'Expected at least one runtime package ZIP');
    zips.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
    return zips[0].filePath;
}

function unzip(zipPath, targetDir) {
    execFileSync('unzip', ['-q', zipPath, '-d', targetDir], {
        cwd: PROJECT_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function zipDirectory(sourceDir, zipPath) {
    execFileSync('zip', ['-X', '-r', zipPath, '.'], {
        cwd: sourceDir,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

async function readText(filePath) {
    return readFile(filePath, 'utf8');
}

async function createWorkspace() {
    await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    return mkdtemp(path.join(TEST_ROOT, 'package-'));
}

async function mutateZip(mutator) {
    const goodZip = await findNewestZip();
    const workDir = await createWorkspace();
    unzip(goodZip, workDir);
    await mutator(workDir);
    const zipPath = path.join(TEST_ROOT, `${path.basename(workDir)}.zip`);
    zipDirectory(workDir, zipPath);
    return zipPath;
}

test('valid runtime package passes verifier', async () => {
    const goodZip = await findNewestZip();
    const output = runVerifier(goodZip);
    assert.match(output, /Verified FortWeb runtime package:/u);
    assert.match(output, /Files verified:/u);
});

test('corrupted manifest checksum fails', async () => {
    const zipPath = await mutateZip(async (workDir) => {
        const manifestPath = path.join(workDir, 'fortweb-runtime', 'manifest.json');
        const manifest = JSON.parse(await readText(manifestPath));
        manifest.version = `${manifest.version}-corrupted`;
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    });

    expectVerifierFailure(zipPath);
});

test('corrupted packaged file fails', async () => {
    const zipPath = await mutateZip(async (workDir) => {
        const manifestPath = path.join(workDir, 'fortweb-runtime', 'manifest.json');
        const manifest = JSON.parse(await readText(manifestPath));
        const target = manifest.files.find((entry) => entry.path.endsWith('app/app/main.js'));
        assert.ok(target, 'Expected app/app/main.js in manifest');
        const filePath = path.join(workDir, 'fortweb-runtime', target.path);
        await writeFile(filePath, `${await readText(filePath)}\n// corrupted\n`);
    });

    expectVerifierFailure(zipPath);
});

test('unexpected extra file fails', async () => {
    const zipPath = await mutateZip(async (workDir) => {
        await writeFile(path.join(workDir, 'fortweb-runtime', 'unexpected-extra.txt'), 'extra');
    });

    expectVerifierFailure(zipPath);
});

test('unsafe manifest path fails', async () => {
    const zipPath = await mutateZip(async (workDir) => {
        const manifestPath = path.join(workDir, 'fortweb-runtime', 'manifest.json');
        const manifest = JSON.parse(await readText(manifestPath));
        manifest.files = [
            {
                path: '../evil.js',
                sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
                bytes: 1,
            },
            ...manifest.files.slice(1),
        ];
        const nextManifestText = `${JSON.stringify(manifest, null, 2)}\n`;
        await writeFile(manifestPath, nextManifestText);
        await writeFile(
            path.join(workDir, 'fortweb-runtime', 'checksums.sha256'),
            `${sha256(Buffer.from(nextManifestText, 'utf8'))}  manifest.json\n`,
        );
    });

    expectVerifierFailure(zipPath);
});

test('rejects duplicate ZIP entry paths before extraction', async () => {
    const workDir = await createWorkspace();
    const zipPath = path.join(workDir, 'duplicate.zip');

    try {
        const pythonScript = `
import zipfile, os
zip_path = os.environ['ZIP_PATH']
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_STORED) as zf:
    zf.writestr("fortweb-runtime/manifest.json", "{}")
    zf.writestr("fortweb-runtime/manifest.json", "{}")
`;
        execFileSync('python3', ['-c', pythonScript], {
            cwd: PROJECT_DIR,
            env: { ...process.env, ZIP_PATH: zipPath },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        assert.throws(
            () => runVerifier(zipPath),
            (error) => /duplicate/i.test(error.message),
            'Expected verifier to reject duplicate ZIP entries',
        );
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
});

test('rejects symlink ZIP entries before extraction', async () => {
    const workDir = await createWorkspace();
    const contentDir = path.join(workDir, 'fortweb-runtime');
    const zipPath = path.join(workDir, 'symlink.zip');

    try {
        await mkdir(contentDir, { recursive: true });
        await writeFile(path.join(contentDir, 'manifest.json'), '{}');
        await writeFile(path.join(contentDir, 'real-file.txt'), 'real content');
        execFileSync('ln', ['-s', 'real-file.txt', path.join(contentDir, 'link.txt')], {
            cwd: PROJECT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        execFileSync('zip', ['--symlinks', '-X', '-r', zipPath, 'fortweb-runtime'], {
            cwd: workDir,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        assert.throws(
            () => runVerifier(zipPath),
            (error) => /symlink/i.test(error.message),
            'Expected verifier to reject symlink ZIP entries',
        );
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
});

test('rejects a manifest missing schema_version', async () => {
    const zipPath = await mutateZip(async (workDir) => {
        const manifestPath = path.join(workDir, 'fortweb-runtime', 'manifest.json');
        const manifest = JSON.parse(await readText(manifestPath));
        delete manifest.schema_version;
        const updatedText = `${JSON.stringify(manifest, null, 2)}\n`;
        await writeFile(manifestPath, updatedText);
        await writeFile(
            path.join(workDir, 'fortweb-runtime', 'checksums.sha256'),
            `${sha256(Buffer.from(updatedText, 'utf8'))}  manifest.json\n`,
        );
    });

    assert.throws(
        () => runVerifier(zipPath),
        (error) => /missing required field.*schema_version/i.test(error.message),
        'Expected verifier to reject manifest missing schema_version',
    );
});

test('rejects a manifest missing fortweb_commit_sha', async () => {
    const zipPath = await mutateZip(async (workDir) => {
        const manifestPath = path.join(workDir, 'fortweb-runtime', 'manifest.json');
        const manifest = JSON.parse(await readText(manifestPath));
        delete manifest.fortweb_commit_sha;
        const updatedText = `${JSON.stringify(manifest, null, 2)}\n`;
        await writeFile(manifestPath, updatedText);
        await writeFile(
            path.join(workDir, 'fortweb-runtime', 'checksums.sha256'),
            `${sha256(Buffer.from(updatedText, 'utf8'))}  manifest.json\n`,
        );
    });

    assert.throws(
        () => runVerifier(zipPath),
        (error) => /missing required field.*fortweb_commit_sha/i.test(error.message),
        'Expected verifier to reject manifest missing fortweb_commit_sha',
    );
});

test('rejects a manifest with an empty runtime_origin', async () => {
    const zipPath = await mutateZip(async (workDir) => {
        const manifestPath = path.join(workDir, 'fortweb-runtime', 'manifest.json');
        const manifest = JSON.parse(await readText(manifestPath));
        manifest.runtime_origin = '';
        const updatedText = `${JSON.stringify(manifest, null, 2)}\n`;
        await writeFile(manifestPath, updatedText);
        await writeFile(
            path.join(workDir, 'fortweb-runtime', 'checksums.sha256'),
            `${sha256(Buffer.from(updatedText, 'utf8'))}  manifest.json\n`,
        );
    });

    assert.throws(
        () => runVerifier(zipPath),
        (error) => /non-empty string/i.test(error.message),
        'Expected verifier to reject empty runtime_origin',
    );
});

test('rejects a manifest whose entrypoint is absent from the archive', async () => {
    const zipPath = await mutateZip(async (workDir) => {
        const manifestPath = path.join(workDir, 'fortweb-runtime', 'manifest.json');
        const manifest = JSON.parse(await readText(manifestPath));
        manifest.entrypoint = 'nonexistent.html';
        const updatedText = `${JSON.stringify(manifest, null, 2)}\n`;
        await writeFile(manifestPath, updatedText);
        await writeFile(
            path.join(workDir, 'fortweb-runtime', 'checksums.sha256'),
            `${sha256(Buffer.from(updatedText, 'utf8'))}  manifest.json\n`,
        );
    });

    assert.throws(
        () => runVerifier(zipPath),
        (error) => /entrypoint.*not present/i.test(error.message),
        'Expected verifier to reject absent entrypoint',
    );
});

test('canonical manifest passes and entrypoint maps to an archive member', async () => {
    const goodZip = await findNewestZip();
    const output = runVerifier(goodZip);

    assert.match(output, /Verified FortWeb runtime package:/u);
    assert.match(output, /Files verified:/u);

    // Confirm the canonical fields are present
    const manifestText = execFileSync('unzip', ['-p', goodZip, 'fortweb-runtime/manifest.json'], {
        cwd: PROJECT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const manifest = JSON.parse(manifestText);

    assert.strictEqual(typeof manifest.schema_version, 'string', 'schema_version must be a string');
    assert.strictEqual(typeof manifest.package_version, 'string', 'package_version must be a string');
    assert.strictEqual(typeof manifest.package_name, 'string', 'package_name must be a string');
    assert.strictEqual(manifest.package_name, 'fortweb-runtime', 'package_name must be fortweb-runtime');
    assert.strictEqual(typeof manifest.producer, 'string', 'producer must be a string');
    assert.strictEqual(manifest.producer, 'fortweb', 'producer must be fortweb');
    assert.strictEqual(typeof manifest.payload_profile, 'string', 'payload_profile must be a string');
    assert.strictEqual(manifest.payload_profile, 'offline-runtime', 'payload_profile must be offline-runtime');
    assert.strictEqual(typeof manifest.fortweb_commit_sha, 'string', 'fortweb_commit_sha must be a string');
    assert.strictEqual(typeof manifest.runtime_origin, 'string', 'runtime_origin must be a string');
    assert.strictEqual(typeof manifest.entrypoint, 'string', 'entrypoint must be a string');
    assert.ok(Array.isArray(manifest.files), 'files must be an array');

    // Confirm entrypoint maps to a real archive member
    const archiveEntries = execFileSync('unzip', ['-Z1', goodZip], {
        cwd: PROJECT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const memberNames = archiveEntries
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((entryName) => {
            const prefix = 'fortweb-runtime/';
            return entryName.startsWith(prefix) ? entryName.slice(prefix.length) : entryName;
        });

    assert.ok(
        memberNames.includes(manifest.entrypoint),
        `Entrypoint '${manifest.entrypoint}' must be a member of the archive`,
    );
});

test('rejects a manifest missing package_name', async () => {
    const zipPath = await mutateZip(async (workDir) => {
        const manifestPath = path.join(workDir, 'fortweb-runtime', 'manifest.json');
        const manifest = JSON.parse(await readText(manifestPath));
        delete manifest.package_name;
        const updatedText = `${JSON.stringify(manifest, null, 2)}\n`;
        await writeFile(manifestPath, updatedText);
        await writeFile(
            path.join(workDir, 'fortweb-runtime', 'checksums.sha256'),
            `${sha256(Buffer.from(updatedText, 'utf8'))}  manifest.json\n`,
        );
    });

    assert.throws(
        () => runVerifier(zipPath),
        (error) => /missing required field.*package_name/i.test(error.message),
        'Expected verifier to reject manifest missing package_name',
    );
});

test('rejects a manifest missing producer', async () => {
    const zipPath = await mutateZip(async (workDir) => {
        const manifestPath = path.join(workDir, 'fortweb-runtime', 'manifest.json');
        const manifest = JSON.parse(await readText(manifestPath));
        delete manifest.producer;
        const updatedText = `${JSON.stringify(manifest, null, 2)}\n`;
        await writeFile(manifestPath, updatedText);
        await writeFile(
            path.join(workDir, 'fortweb-runtime', 'checksums.sha256'),
            `${sha256(Buffer.from(updatedText, 'utf8'))}  manifest.json\n`,
        );
    });

    assert.throws(
        () => runVerifier(zipPath),
        (error) => /missing required field.*producer/i.test(error.message),
        'Expected verifier to reject manifest missing producer',
    );
});

test('rejects a manifest missing payload_profile', async () => {
    const zipPath = await mutateZip(async (workDir) => {
        const manifestPath = path.join(workDir, 'fortweb-runtime', 'manifest.json');
        const manifest = JSON.parse(await readText(manifestPath));
        delete manifest.payload_profile;
        const updatedText = `${JSON.stringify(manifest, null, 2)}\n`;
        await writeFile(manifestPath, updatedText);
        await writeFile(
            path.join(workDir, 'fortweb-runtime', 'checksums.sha256'),
            `${sha256(Buffer.from(updatedText, 'utf8'))}  manifest.json\n`,
        );
    });

    assert.throws(
        () => runVerifier(zipPath),
        (error) => /missing required field.*payload_profile/i.test(error.message),
        'Expected verifier to reject manifest missing payload_profile',
    );
});

// --- Runtime requirements actual-byte integrity ---

test('verifier rejects requirements artifact with mutated content', async () => {
    const zipPath = await mutateZip(async (workDir) => {
        const rrPath = path.join(workDir, 'fortweb-runtime', RUNTIME_REQUIREMENTS_PATH);
        const rr = JSON.parse(await readText(rrPath));
        // Mutate a field: changes content but preserves size
        rr.producer = 'tampered';
        await writeFile(rrPath, JSON.stringify(rr, null, 2));
    });

    assert.throws(
        () => runVerifier(zipPath),
        (error) => /mismatch/i.test(error.message),
        'Expected verifier to reject requirements artifact with mutated content',
    );
});

test('verifier rejects requirements artifact with changed size', async () => {
    const zipPath = await mutateZip(async (workDir) => {
        const rrPath = path.join(workDir, 'fortweb-runtime', RUNTIME_REQUIREMENTS_PATH);
        const original = await readText(rrPath);
        // Append content — changes byte size
        await writeFile(rrPath, `${original}\n// extra bytes\n`);
    });

    assert.throws(
        () => runVerifier(zipPath),
        (error) => /Byte size mismatch/i.test(error.message),
        'Expected verifier to reject requirements artifact with changed size',
    );
});

test('verifier rejects requirements artifact missing from extracted tree', async () => {
    const zipPath = await mutateZip(async (workDir) => {
        const rrPath = path.join(workDir, 'fortweb-runtime', RUNTIME_REQUIREMENTS_PATH);
        await rm(rrPath);
    });

    assert.throws(
        () => runVerifier(zipPath),
        (error) => /missing manifest-listed files/i.test(error.message),
        'Expected verifier to reject when requirements artifact is absent from tree',
    );
});
