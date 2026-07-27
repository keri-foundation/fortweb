/**
 * Runtime build idempotency and determinism tests.
 *
 * Every build targets a unique tool-owned temporary directory under
 * dist/.tmp so the canonical dist/runtime artifact is never deleted
 * or rebuilt by this test file.
 *
 * Determinism proofs:
 *  1. Two clean builds produce identical path-and-byte snapshots.
 *  2. Mutating file bytes changes the aggregate digest but not the
 *     path list.
 *  3. Injecting a stale file contaminates the snapshot; rebuilding
 *     removes it and restores the exact baseline.
 *  4. Rebuilding after byte mutation restores the exact clean
 *     snapshot.
 */
import { strict as assert } from 'node:assert';
import { test, describe, after } from 'node:test';
import {
    existsSync,
    readdirSync,
    rmSync,
    readFileSync,
    writeFileSync,
    mkdtempSync,
    mkdirSync,
    lstatSync,
    symlinkSync,
} from 'node:fs';
import { join, resolve, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const CANONICAL_RUNTIME_DIR = join(PROJECT_DIR, 'dist/runtime');
const TEMP_BUILD_ROOT = join(PROJECT_DIR, 'dist/.tmp');

// ── Path safety ────────────────────────────────────────────────────────────

function isStrictDescendant(parent, candidate) {
    const parentPath = resolve(parent);
    const candidatePath = resolve(candidate);
    const relativePath = relative(parentPath, candidatePath);

    return (
        relativePath !== '' &&
        relativePath !== '..' &&
        !relativePath.startsWith(`..${sep}`) &&
        !isAbsolute(relativePath)
    );
}

/**
 * Guard every recursive removal: the path must be a strict descendant
 * of dist/.tmp whose basename begins with the idempotency prefix.
 */
function assertSafeTempRuntimePath(candidate) {
    const resolved = resolve(candidate);
    const parent = resolve(TEMP_BUILD_ROOT);

    assert.ok(
        isStrictDescendant(parent, resolved),
        `unsafe removal: ${candidate} is not inside dist/.tmp`,
    );

    const base = resolved.split(sep).pop();
    assert.ok(
        base && base.startsWith('fortweb-runtime-idempotency-'),
        `unsafe removal: ${candidate} basename must start with fortweb-runtime-idempotency-`,
    );

    assert.notStrictEqual(
        resolved, parent,
        `unsafe removal: ${candidate} is dist/.tmp itself`,
    );

    assert.notStrictEqual(
        resolved, resolve(CANONICAL_RUNTIME_DIR),
        `unsafe removal: ${candidate} is canonical dist/runtime`,
    );

    assert.notStrictEqual(
        resolved, resolve(PROJECT_DIR),
        `unsafe removal: ${candidate} is the repository root`,
    );
}

// ── Deterministic runtime snapshot ─────────────────────────────────────────

/**
 * Walk a runtime directory and return a deterministic path-and-byte
 * snapshot.
 *
 * Every entry in `entries` is sorted by comparing UTF-8 path bytes
 * with Buffer.compare (locale-independent).
 *
 * The aggregate digest frames every entry as:
 *   4-byte BE path length ‖ path bytes ‖ 4-byte BE content length ‖ content bytes
 *
 * @param {string} runtimeRoot  absolute path to the runtime directory
 * @returns {{ aggregateDigest: string, entries: Array<{path:string, size:number, contentDigest:string}> }}
 */
function snapshotRuntime(runtimeRoot) {
    const absRoot = resolve(runtimeRoot);
    const entries = [];

    function walk(dir, prefix) {
        let dirList;
        try {
            dirList = readdirSync(dir, { withFileTypes: true });
        } catch {
            assert.fail(`cannot read directory: ${relative(absRoot, dir)}`);
        }

        // Sort directory entries with Buffer.compare for deterministic,
        // locale-independent ordering.
        dirList.sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));

        for (const entry of dirList) {
            const full = join(dir, entry.name);
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

            if (entry.isSymbolicLink()) {
                assert.fail(`symlink not allowed in runtime snapshot: ${rel}`);
            }

            if (entry.isDirectory()) {
                walk(full, rel);
            } else if (entry.isFile()) {
                const content = readFileSync(full);
                entries.push({
                    path: rel,
                    size: content.length,
                    contentDigest: createHash('sha256').update(content).digest('hex'),
                });
            } else {
                assert.fail(`unsupported file type in runtime snapshot: ${rel}`);
            }
        }
    }

    walk(absRoot, '');

    // Sort entries by comparing UTF-8 path bytes.
    entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));

    // Build framed aggregate digest.
    const hash = createHash('sha256');
    for (const e of entries) {
        const pathBytes = Buffer.from(e.path, 'utf8');
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(pathBytes.length, 0);
        hash.update(lenBuf);
        hash.update(pathBytes);

        // Read content bytes fresh for the aggregate (byte mutation
        // detection depends on content bytes in the framing, not just
        // the per-file digest text).
        const content = readFileSync(join(absRoot, e.path));
        const contentLenBuf = Buffer.alloc(4);
        contentLenBuf.writeUInt32BE(content.length, 0);
        hash.update(contentLenBuf);
        hash.update(content);
    }

    return {
        aggregateDigest: hash.digest('hex'),
        entries,
    };
}

// ── Builder invocation ─────────────────────────────────────────────────────

function buildRuntime(tempDir) {
    // Guard: the builder never receives canonical dist/runtime.
    const resolved = resolve(tempDir);
    assert.notStrictEqual(
        resolved,
        resolve(CANONICAL_RUNTIME_DIR),
        'builder must not target canonical dist/runtime',
    );

    execFileSync(
        process.execPath,
        ['tools/build-runtime.mjs', '--out-dir', tempDir],
        { cwd: PROJECT_DIR, stdio: 'pipe' },
    );
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('runtime build idempotency and determinism (isolated)', { concurrency: 1 }, () => {
    // Create the shared temp root so mkdtempSync has a parent.
    mkdirSync(TEMP_BUILD_ROOT, { recursive: true });

    const DIST_DIR = join(PROJECT_DIR, 'dist');
    const TEMP_RUNTIME_DIR = mkdtempSync(
        join(TEMP_BUILD_ROOT, 'fortweb-runtime-idempotency-'),
    );

    // ── Structural guards ──

    assert.ok(
        isStrictDescendant(DIST_DIR, TEMP_BUILD_ROOT),
        'dist/.tmp must be a strict descendant of dist',
    );

    assert.ok(
        isStrictDescendant(TEMP_BUILD_ROOT, TEMP_RUNTIME_DIR),
        'idempotency temp dir must be a strict descendant of dist/.tmp',
    );

    assert.notStrictEqual(
        resolve(TEMP_RUNTIME_DIR),
        resolve(CANONICAL_RUNTIME_DIR),
        'idempotency temp dir must not be the canonical dist/runtime',
    );

    assert.ok(
        !isStrictDescendant(TEMP_RUNTIME_DIR, CANONICAL_RUNTIME_DIR),
        'canonical dist/runtime must not be inside the temp dir',
    );

    after(() => {
        assertSafeTempRuntimePath(TEMP_RUNTIME_DIR);
        rmSync(TEMP_RUNTIME_DIR, { recursive: true, force: true });
    });

    // ── Runtime build correctness ───────────────────────────────────

    describe('runtime build correctness', () => {
        test('clean build succeeds', () => {
            if (existsSync(TEMP_RUNTIME_DIR)) {
                assertSafeTempRuntimePath(TEMP_RUNTIME_DIR);
                rmSync(TEMP_RUNTIME_DIR, { recursive: true, force: true });
            }
            buildRuntime(TEMP_RUNTIME_DIR);
            assert.ok(existsSync(TEMP_RUNTIME_DIR), 'temp runtime dir must exist after build');
        });

        test('custom output directory is populated', () => {
            const contents = readdirSync(TEMP_RUNTIME_DIR);
            assert.ok(contents.length > 0, 'custom --out-dir must be populated');
        });

        test('required root directories exist', () => {
            const required = ['app', 'vendor', 'wheels', 'pyscript-ci.toml'];
            for (const name of required) {
                assert.ok(
                    existsSync(join(TEMP_RUNTIME_DIR, name)),
                    `required root must exist: ${name}`,
                );
            }
        });

        test('nested app/assets are copied', () => {
            assert.ok(existsSync(join(TEMP_RUNTIME_DIR, 'app/assets/brand/SymbolLogo.svg')));
            assert.ok(existsSync(join(TEMP_RUNTIME_DIR, 'app/assets/icons/vault-drawer.svg')));
        });

        test('nested Pyodide files are copied', () => {
            assert.ok(existsSync(join(TEMP_RUNTIME_DIR, 'vendor/pyodide/0.29.3/pyodide.mjs')));
            assert.ok(existsSync(join(TEMP_RUNTIME_DIR, 'vendor/pyodide/0.29.3/wheels/cbor2-5.8.0-py3-none-any.whl')));
        });

        test('stylesheets are copied', () => {
            assert.ok(existsSync(join(TEMP_RUNTIME_DIR, 'app/styles/tokens.css')));
            assert.ok(existsSync(join(TEMP_RUNTIME_DIR, 'app/styles/components.css')));
        });

        test('entry HTML is copied', () => {
            assert.ok(existsSync(join(TEMP_RUNTIME_DIR, 'app/index.html')));
        });

        test('compiled JavaScript is present', () => {
            const jsContent = readFileSync(join(TEMP_RUNTIME_DIR, 'app/app/main.js'), 'utf-8');
            assert.ok(!jsContent.includes(': string'), 'compiled JS should not contain TS type annotations');
        });

        test('raw TypeScript is not used as runtime entry', () => {
            const tsFiles = readdirSync(join(TEMP_RUNTIME_DIR, 'app/app'), { recursive: true })
                .filter((f) => String(f).endsWith('.ts'));
            assert.strictEqual(tsFiles.length, 0, 'no .ts files should be in runtime output');
        });
    });

    // ── Determinism proofs ──────────────────────────────────────────

    describe('runtime build determinism', () => {
        test('two clean builds produce identical path-and-byte snapshots', () => {
            buildRuntime(TEMP_RUNTIME_DIR);
            const snapshot1 = snapshotRuntime(TEMP_RUNTIME_DIR);

            assert.ok(snapshot1.entries.length > 0, 'snapshot must contain files');
            assert.ok(snapshot1.aggregateDigest.length === 64, 'aggregate digest must be sha256 hex');

            // Verify ordering is deterministic and not locale-dependent.
            for (let i = 1; i < snapshot1.entries.length; i++) {
                const cmp = Buffer.compare(
                    Buffer.from(snapshot1.entries[i - 1].path),
                    Buffer.from(snapshot1.entries[i].path),
                );
                assert.ok(cmp < 0, `snapshot entries must be sorted: ${snapshot1.entries[i - 1].path} before ${snapshot1.entries[i].path}`);
            }

            buildRuntime(TEMP_RUNTIME_DIR);
            const snapshot2 = snapshotRuntime(TEMP_RUNTIME_DIR);

            assert.strictEqual(
                snapshot2.aggregateDigest,
                snapshot1.aggregateDigest,
                'two clean builds must produce identical aggregate digests',
            );

            assert.strictEqual(
                snapshot2.entries.length,
                snapshot1.entries.length,
                'two clean builds must produce the same file count',
            );

            for (let i = 0; i < snapshot1.entries.length; i++) {
                assert.strictEqual(
                    snapshot2.entries[i].path,
                    snapshot1.entries[i].path,
                    `path at index ${i} must match`,
                );
                assert.strictEqual(
                    snapshot2.entries[i].size,
                    snapshot1.entries[i].size,
                    `size of ${snapshot1.entries[i].path} must match`,
                );
                assert.strictEqual(
                    snapshot2.entries[i].contentDigest,
                    snapshot1.entries[i].contentDigest,
                    `content digest of ${snapshot1.entries[i].path} must match`,
                );
            }

            // Report diagnostics.
            const totalBytes = snapshot1.entries.reduce((sum, e) => sum + e.size, 0);
            console.log(JSON.stringify({
                determinismBaseline: {
                    fileCount: snapshot1.entries.length,
                    totalBytes,
                    aggregateDigest: snapshot1.aggregateDigest,
                },
            }, null, 2));
        });

        test('byte mutation changes digest but not path list', () => {
            // Establish clean baseline.
            buildRuntime(TEMP_RUNTIME_DIR);
            const baseline = snapshotRuntime(TEMP_RUNTIME_DIR);

            // Choose a known deterministic text file.
            const targetPath = 'app/index.html';
            const absTarget = join(TEMP_RUNTIME_DIR, targetPath);
            assert.ok(existsSync(absTarget), `mutation target must exist: ${targetPath}`);

            const originalContent = readFileSync(absTarget, 'utf8');
            assert.ok(originalContent.length > 0, 'target file must have content');

            // Mutate bytes inside the isolated output only.
            // Preserve length to prove the digest depends on bytes, not size.
            const mutated = originalContent.slice(0, -10) + 'XXXXXXXXXX';
            assert.strictEqual(
                mutated.length,
                originalContent.length,
                'mutation must preserve byte length',
            );
            assert.notStrictEqual(mutated, originalContent, 'mutation must actually change content');
            writeFileSync(absTarget, mutated, 'utf8');

            const mutatedSnapshot = snapshotRuntime(TEMP_RUNTIME_DIR);

            // Path list must be unchanged.
            assert.strictEqual(
                mutatedSnapshot.entries.length,
                baseline.entries.length,
                'path count must not change after byte mutation',
            );
            for (let i = 0; i < baseline.entries.length; i++) {
                assert.strictEqual(
                    mutatedSnapshot.entries[i].path,
                    baseline.entries[i].path,
                    `path at index ${i} must be unchanged after mutation`,
                );
            }

            // Aggregate digest must differ.
            assert.notStrictEqual(
                mutatedSnapshot.aggregateDigest,
                baseline.aggregateDigest,
                'aggregate digest must change when bytes differ',
            );

            // The mutated file's content digest must differ.
            const mutatedEntry = mutatedSnapshot.entries.find(e => e.path === targetPath);
            const baselineEntry = baseline.entries.find(e => e.path === targetPath);
            assert.ok(mutatedEntry, 'mutated entry must exist');
            assert.ok(baselineEntry, 'baseline entry must exist');
            assert.notStrictEqual(
                mutatedEntry.contentDigest,
                baselineEntry.contentDigest,
                `content digest of ${targetPath} must differ after mutation`,
            );

            // Rebuild and verify restoration.
            buildRuntime(TEMP_RUNTIME_DIR);
            const restored = snapshotRuntime(TEMP_RUNTIME_DIR);

            assert.strictEqual(
                restored.aggregateDigest,
                baseline.aggregateDigest,
                'rebuilding after mutation must restore the exact baseline digest',
            );
            assert.strictEqual(
                restored.entries.length,
                baseline.entries.length,
                'rebuilding after mutation must restore the exact file count',
            );
            for (let i = 0; i < baseline.entries.length; i++) {
                assert.strictEqual(
                    restored.entries[i].contentDigest,
                    baseline.entries[i].contentDigest,
                    `content digest of ${baseline.entries[i].path} must be restored`,
                );
            }
        });

        test('stale file is removed by rebuild', () => {
            // Establish clean baseline.
            buildRuntime(TEMP_RUNTIME_DIR);
            const baseline = snapshotRuntime(TEMP_RUNTIME_DIR);

            // Inject a stale file in a new subdirectory.
            const staleDir = join(TEMP_RUNTIME_DIR, '__stale__');
            mkdirSync(staleDir, { recursive: true });
            const staleFile = join(staleDir, 'unexpected-output.txt');
            writeFileSync(staleFile, 'this file should not survive a rebuild', 'utf8');
            assert.ok(existsSync(staleFile), 'stale file must exist after injection');

            // Contaminated snapshot must differ.
            const contaminated = snapshotRuntime(TEMP_RUNTIME_DIR);
            assert.ok(
                contaminated.entries.length > baseline.entries.length,
                'contaminated snapshot must have more files than baseline',
            );
            assert.notStrictEqual(
                contaminated.aggregateDigest,
                baseline.aggregateDigest,
                'contaminated aggregate digest must differ from baseline',
            );
            assert.ok(
                contaminated.entries.some(e => e.path.startsWith('__stale__/')),
                'contaminated snapshot must include the stale path',
            );

            // Rebuild must remove the stale file and restore baseline.
            buildRuntime(TEMP_RUNTIME_DIR);
            assert.ok(
                !existsSync(staleFile),
                'stale file must not exist after rebuild',
            );

            const restored = snapshotRuntime(TEMP_RUNTIME_DIR);
            assert.strictEqual(
                restored.entries.length,
                baseline.entries.length,
                'restored snapshot must have the same file count as baseline',
            );
            assert.strictEqual(
                restored.aggregateDigest,
                baseline.aggregateDigest,
                'restored aggregate digest must equal baseline',
            );
            assert.ok(
                !restored.entries.some(e => e.path.startsWith('__stale__/')),
                'restored snapshot must not contain stale paths',
            );
        });

        test('snapshot rejects unsupported file types', () => {
            buildRuntime(TEMP_RUNTIME_DIR);
            // symlinkSync can fail on some platforms; only test when supported.
            try {
                symlinkSync(
                    join(TEMP_RUNTIME_DIR, 'app/index.html'),
                    join(TEMP_RUNTIME_DIR, 'app/link.html'),
                );
            } catch {
                // symlinks not supported on this platform — test passes vacuously.
                return;
            }
            assert.throws(
                () => snapshotRuntime(TEMP_RUNTIME_DIR),
                { message: /symlink not allowed/ },
            );
            // Clean up symlink so it doesn't affect later tests.
            assertSafeTempRuntimePath(TEMP_RUNTIME_DIR);
            rmSync(join(TEMP_RUNTIME_DIR, 'app/link.html'), { force: true });
        });
    });
});
