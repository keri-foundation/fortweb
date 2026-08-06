import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
    lstat,
    mkdir,
    readFile,
    readdir,
    rm,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { validateManifest, validateRuntimeRequirements, RUNTIME_REQUIREMENTS_PATH } from './runtime-package-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const VERIFY_ROOT = path.join(PROJECT_DIR, '.tmp/runtime-package-verify');
const ROOT_DIR_NAME = 'fortweb-runtime';
const ROOT_PATH = `${ROOT_DIR_NAME}/`;
const MANIFEST_NAME = 'manifest.json';
const CHECKSUM_NAME = 'checksums.sha256';
const execFileAsync = promisify(execFile);

function usage() {
    process.stderr.write('Usage: node tools/verify-runtime-package.mjs <runtime-package.zip>\n');
}

function fail(message) {
    throw new Error(message);
}

function toPosixPath(filePath) {
    return filePath.split(path.sep).join('/');
}

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

function validateArchiveEntryName(entryName) {
    if (typeof entryName !== 'string' || entryName.length === 0) {
        fail('Archive entry name is invalid.');
    }

    if (entryName.startsWith('/') || entryName.startsWith('\\')) {
        fail(`Archive entry uses an absolute path: ${entryName}`);
    }

    if (entryName.includes('\\')) {
        fail(`Archive entry uses a Windows path separator: ${entryName}`);
    }

    if (entryName === ROOT_DIR_NAME || entryName === ROOT_PATH) {
        return;
    }

    if (!entryName.startsWith(ROOT_PATH)) {
        fail(`Archive entry is outside the expected package root: ${entryName}`);
    }

    const relativePath = entryName.slice(ROOT_PATH.length);
    if (relativePath.length === 0) {
        return;
    }

    const normalizedPath = path.posix.normalize(relativePath);
    if (normalizedPath !== relativePath) {
        fail(`Archive entry contains a traversal or non-canonical path: ${entryName}`);
    }

    if (normalizedPath.startsWith('../') || normalizedPath.includes('/../') || normalizedPath === '..') {
        fail(`Archive entry contains path traversal: ${entryName}`);
    }
}

function validateManifestPath(filePath) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
        fail('Manifest file path must be a non-empty string.');
    }

    if (filePath.startsWith('/') || filePath.startsWith('\\')) {
        fail(`Manifest file path must be relative: ${filePath}`);
    }

    if (filePath.includes('\\')) {
        fail(`Manifest file path must use forward slashes only: ${filePath}`);
    }

    const normalizedPath = path.posix.normalize(filePath);
    if (normalizedPath !== filePath) {
        fail(`Manifest file path must be canonical: ${filePath}`);
    }

    if (normalizedPath.startsWith('../') || normalizedPath.includes('/../') || normalizedPath === '..') {
        fail(`Manifest file path must not traverse directories: ${filePath}`);
    }

    if (normalizedPath === MANIFEST_NAME || normalizedPath === CHECKSUM_NAME) {
        fail(`Manifest file list must not include package metadata: ${filePath}`);
    }

    return normalizedPath;
}

function validateManifestEntry(entry, index) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        fail(`Manifest file entry #${index + 1} must be an object.`);
    }

    const { path: entryPath, sha256: entrySha256, bytes } = entry;
    const normalizedPath = validateManifestPath(entryPath);

    if (typeof entrySha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(entrySha256)) {
        fail(`Manifest file entry #${index + 1} has an invalid SHA-256: ${entrySha256}`);
    }

    if (!Number.isInteger(bytes) || bytes < 0) {
        fail(`Manifest file entry #${index + 1} has an invalid byte size: ${bytes}`);
    }

    return {
        path: normalizedPath,
        sha256: entrySha256,
        bytes,
    };
}

async function listArchiveEntries(zipPath) {
    const { stdout } = await execFileAsync('unzip', ['-Z1', zipPath], {
        cwd: PROJECT_DIR,
        maxBuffer: 10 * 1024 * 1024,
    });

    return stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
}

async function listArchiveEntryTypes(zipPath) {
    const { stdout } = await execFileAsync('unzip', ['-Z', zipPath], {
        cwd: PROJECT_DIR,
        maxBuffer: 10 * 1024 * 1024,
    });

    const lines = stdout.split(/\r?\n/u);
    const entries = [];
    let inEntries = false;

    for (const line of lines) {
        if (!inEntries) {
            if (line.startsWith('-') || line.startsWith('d') || line.startsWith('l')) {
                inEntries = true;
            } else {
                continue;
            }
        }

        if (line.trim().length === 0) {
            continue;
        }

        if (/^\d+ files?/.test(line.trim())) {
            break;
        }

        const typeChar = line.trimStart()[0];
        entries.push(typeChar);
    }

    return entries;
}

async function extractZip(zipPath, targetDir) {
    await execFileAsync('unzip', ['-q', zipPath, '-d', targetDir], {
        cwd: PROJECT_DIR,
        maxBuffer: 10 * 1024 * 1024,
    });
}

async function readManifestData(filePath) {
    const buffer = await readFile(filePath);
    return {
        buffer,
        text: buffer.toString('utf8'),
    };
}

async function collectFilesRecursively(dir, baseDir = dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await collectFilesRecursively(fullPath, baseDir)));
            continue;
        }

        if (entry.isFile()) {
            files.push(toPosixPath(path.relative(baseDir, fullPath)));
        }
    }

    return files;
}

async function readFileDigestAndSize(filePath) {
    const buffer = await readFile(filePath);
    const stats = await lstat(filePath);

    return {
        sha256: sha256(buffer),
        bytes: stats.size,
    };
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 1) {
        usage();
        process.exitCode = 1;
        return;
    }

    const zipPath = path.resolve(process.cwd(), args[0]);
    const zipStats = await lstat(zipPath).catch(() => null);
    if (!zipStats || !zipStats.isFile()) {
        fail(`Runtime package ZIP not found: ${zipPath}`);
    }

    await rm(VERIFY_ROOT, { recursive: true, force: true });
    const extractDir = path.join(VERIFY_ROOT, 'extract');
    await mkdir(extractDir, { recursive: true });

    try {
        const archiveEntries = await listArchiveEntries(zipPath);
        if (archiveEntries.length === 0) {
            fail(`Runtime package ZIP is empty: ${zipPath}`);
        }

        for (const entryName of archiveEntries) {
            validateArchiveEntryName(entryName);
        }

        if (!archiveEntries.some((entryName) => entryName === ROOT_DIR_NAME || entryName === ROOT_PATH)) {
            fail(`Runtime package ZIP is missing the expected ${ROOT_PATH} root.`);
        }

        const uniqueEntries = new Set(archiveEntries);
        if (uniqueEntries.size !== archiveEntries.length) {
            fail('Duplicate ZIP entry paths are not supported. Rejecting before extraction.');
        }

        const entryTypes = await listArchiveEntryTypes(zipPath);
        if (entryTypes.some((typeChar) => typeChar === 'l')) {
            fail('ZIP symlink entries are not supported. Rejecting before extraction.');
        }

        await extractZip(zipPath, extractDir);

        const packageRoot = path.join(extractDir, ROOT_DIR_NAME);
        const packageRootStats = await lstat(packageRoot).catch(() => null);
        if (!packageRootStats || !packageRootStats.isDirectory()) {
            fail(`Extracted runtime package is missing the expected ${ROOT_PATH} directory.`);
        }

        const manifestPath = path.join(packageRoot, MANIFEST_NAME);
        const checksumsPath = path.join(packageRoot, CHECKSUM_NAME);
        const manifestStats = await lstat(manifestPath).catch(() => null);
        const checksumsStats = await lstat(checksumsPath).catch(() => null);

        if (!manifestStats || !manifestStats.isFile()) {
            fail(`Missing runtime package manifest: ${ROOT_PATH}${MANIFEST_NAME}`);
        }

        if (!checksumsStats || !checksumsStats.isFile()) {
            fail(`Missing runtime package checksum file: ${ROOT_PATH}${CHECKSUM_NAME}`);
        }

        const { buffer: manifestBuffer, text: manifestText } = await readManifestData(manifestPath);
        const manifestHash = sha256(manifestBuffer);
        const checksumsText = (await readFile(checksumsPath, 'utf8')).trim();
        const checksumLines = checksumsText
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .filter(Boolean);

        if (checksumLines.length !== 1) {
            fail('checksums.sha256 must contain exactly one non-empty line.');
        }

        const expectedChecksumLine = `${manifestHash}  manifest.json`;
        if (checksumLines[0] !== expectedChecksumLine) {
            fail(`Manifest checksum mismatch. Expected "${expectedChecksumLine}" but found "${checksumLines[0]}".`);
        }

        const manifest = JSON.parse(manifestText);
        validateManifest(manifest, null);

        const verifiedEntries = manifest.files.map(validateManifestEntry);
        const manifestEntryPaths = new Set();
        for (const entry of verifiedEntries) {
            if (manifestEntryPaths.has(entry.path)) {
                fail(`Duplicate manifest file entry: ${entry.path}`);
            }
            manifestEntryPaths.add(entry.path);
        }

        const actualFiles = await collectFilesRecursively(packageRoot);

        // Validate entrypoint existence against actual archive members
        validateManifest(manifest, actualFiles);
        const allowedFiles = new Set([
            MANIFEST_NAME,
            CHECKSUM_NAME,
            ...manifestEntryPaths,
        ]);

        const unexpectedFiles = actualFiles.filter((filePath) => !allowedFiles.has(filePath));
        if (unexpectedFiles.length > 0) {
            fail([
                'Runtime package contains unexpected files:',
                ...unexpectedFiles.map((filePath) => `- ${filePath}`),
            ].join('\n'));
        }

        const missingFiles = verifiedEntries
            .map((entry) => entry.path)
            .filter((filePath) => !actualFiles.includes(filePath));
        if (missingFiles.length > 0) {
            fail([
                'Runtime package is missing manifest-listed files:',
                ...missingFiles.map((filePath) => `- ${filePath}`),
            ].join('\n'));
        }

        for (const entry of verifiedEntries) {
            const absolutePath = path.join(packageRoot, entry.path);
            const fileStats = await lstat(absolutePath).catch(() => null);
            if (!fileStats || !fileStats.isFile()) {
                fail(`Missing runtime package file: ${ROOT_PATH}${entry.path}`);
            }

            if (fileStats.size !== entry.bytes) {
                fail(`Byte size mismatch for ${ROOT_PATH}${entry.path}: expected ${entry.bytes}, found ${fileStats.size}.`);
            }

            const { sha256: fileHash } = await readFileDigestAndSize(absolutePath);
            if (fileHash !== entry.sha256) {
                fail(`SHA-256 mismatch for ${ROOT_PATH}${entry.path}: expected ${entry.sha256}, found ${fileHash}.`);
            }
        }

        // --- Semantic validation of runtime-requirements artifact ---
        const rrPath = path.join(packageRoot, RUNTIME_REQUIREMENTS_PATH);
        const rrBuffer = await readFile(rrPath);
        const rrText = rrBuffer.toString('utf8');
        validateRuntimeRequirements(rrText, manifest);

        process.stdout.write(`Verified FortWeb runtime package: ${zipPath}\n`);
        process.stdout.write(`Files verified: ${verifiedEntries.length}\n`);
        process.stdout.write(`Package root: ${ROOT_PATH}\n`);
    } finally {
        await rm(VERIFY_ROOT, { recursive: true, force: true });
    }
}

await main().catch((error) => {
    process.stderr.write(`[verify-runtime-package] ${error.message}\n`);
    process.exitCode = 1;
});
