/**
 * Runtime build idempotency and correctness tests.
 *
 * All builds in this file target a tool-owned temporary directory so
 * the canonical dist/runtime artifact is never deleted or rebuilt.
 */
import { strict as assert } from 'node:assert';
import { test, describe, after } from 'node:test';
import { existsSync, readdirSync, rmSync, readFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const CANONICAL_RUNTIME_DIR = join(PROJECT_DIR, 'dist/runtime');

describe('runtime build idempotency and correctness (isolated)', { concurrency: 1 }, () => {
    const TEMP_RUNTIME_DIR = mkdtempSync(
        join(tmpdir(), 'fortweb-runtime-idempotency-'),
    );

    // Guard: the temp directory must not be the canonical output.
    assert.notStrictEqual(
        resolve(TEMP_RUNTIME_DIR),
        resolve(CANONICAL_RUNTIME_DIR),
        'idempotency temp dir must not be the canonical dist/runtime',
    );

    after(() => {
        rmSync(TEMP_RUNTIME_DIR, { recursive: true, force: true });
    });

    function sortedManifest(dir, prefix = '') {
        const entries = [];
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                entries.push(...sortedManifest(join(dir, entry.name), rel));
            } else {
                entries.push(rel);
            }
        }
        return entries;
    }

    function buildRuntime() {
        execSync(
            `node tools/build-runtime.mjs --out-dir "${TEMP_RUNTIME_DIR}"`,
            { cwd: PROJECT_DIR, stdio: 'pipe' },
        );
    }

    function manifestHash(manifest) {
        return createHash('sha256').update(manifest.join('\n')).digest('hex');
    }

    // ── Tests ──

    describe('runtime build correctness', () => {
        test('clean build succeeds', () => {
            if (existsSync(TEMP_RUNTIME_DIR)) {
                rmSync(TEMP_RUNTIME_DIR, { recursive: true, force: true });
            }
            buildRuntime();
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

    describe('runtime build idempotency', () => {
        test('second build produces identical manifest', () => {
            buildRuntime();
            const manifest1 = sortedManifest(TEMP_RUNTIME_DIR);
            const hash1 = manifestHash(manifest1);

            buildRuntime();
            const manifest2 = sortedManifest(TEMP_RUNTIME_DIR);
            const hash2 = manifestHash(manifest2);

            assert.strictEqual(hash2, hash1, 'two consecutive builds must produce identical manifests');
        });

        test('stale prior output is removed', () => {
            buildRuntime();
            const count1 = sortedManifest(TEMP_RUNTIME_DIR).length;
            buildRuntime();
            const count2 = sortedManifest(TEMP_RUNTIME_DIR).length;
            assert.strictEqual(count2, count1, 'file count must be stable across builds');
        });
    });
});
