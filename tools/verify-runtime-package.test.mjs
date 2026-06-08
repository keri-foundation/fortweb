import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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
