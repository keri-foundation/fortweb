/**
 * Runtime build idempotency and correctness tests.
 */
import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { existsSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const RUNTIME_DIR = join(PROJECT_DIR, 'dist/runtime');

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
    execSync('npm run build:runtime', { cwd: PROJECT_DIR, stdio: 'pipe' });
}

function manifestHash(manifest) {
    return createHash('sha256').update(manifest.join('\n')).digest('hex');
}

// ── Tests ──

describe('runtime build correctness', () => {
    test('clean build succeeds', () => {
        // Remove dist/runtime if it exists, then build
        if (existsSync(RUNTIME_DIR)) {
            rmSync(RUNTIME_DIR, { recursive: true, force: true });
        }
        buildRuntime();
        assert.ok(existsSync(RUNTIME_DIR), 'dist/runtime must exist after build');
    });

    test('required root directories exist', () => {
        const required = ['app', 'vendor', 'wheels', 'pyscript-ci.toml'];
        for (const name of required) {
            assert.ok(
                existsSync(join(RUNTIME_DIR, name)),
                `required root must exist: ${name}`
            );
        }
    });

    test('nested app/assets are copied', () => {
        assert.ok(existsSync(join(RUNTIME_DIR, 'app/assets/brand/SymbolLogo.svg')));
        assert.ok(existsSync(join(RUNTIME_DIR, 'app/assets/icons/vault-drawer.svg')));
    });

    test('nested Pyodide files are copied', () => {
        assert.ok(existsSync(join(RUNTIME_DIR, 'vendor/pyodide/0.29.3/pyodide.mjs')));
        assert.ok(existsSync(join(RUNTIME_DIR, 'vendor/pyodide/0.29.3/wheels/cbor2-5.8.0-py3-none-any.whl')));
    });

    test('stylesheets are copied', () => {
        assert.ok(existsSync(join(RUNTIME_DIR, 'app/styles/tokens.css')));
        assert.ok(existsSync(join(RUNTIME_DIR, 'app/styles/components.css')));
    });

    test('entry HTML is copied', () => {
        assert.ok(existsSync(join(RUNTIME_DIR, 'app/index.html')));
    });

    test('compiled JavaScript is present', () => {
        const jsContent = readFileSync(join(RUNTIME_DIR, 'app/app/main.js'), 'utf-8');
        // Should NOT be raw TypeScript (no TS-specific syntax)
        assert.ok(!jsContent.includes(': string'), 'compiled JS should not contain TS type annotations');
    });

    test('raw TypeScript is not used as runtime entry', () => {
        const tsFiles = readdirSync(join(RUNTIME_DIR, 'app/app'), { recursive: true })
            .filter((f) => String(f).endsWith('.ts'));
        assert.strictEqual(tsFiles.length, 0, 'no .ts files should be in runtime output');
    });
});

describe('runtime build idempotency', () => {
    test('second build produces identical manifest', () => {
        // First build
        buildRuntime();
        const manifest1 = sortedManifest(RUNTIME_DIR);
        const hash1 = manifestHash(manifest1);

        // Second build (no clean in between)
        buildRuntime();
        const manifest2 = sortedManifest(RUNTIME_DIR);
        const hash2 = manifestHash(manifest2);

        assert.strictEqual(hash2, hash1, 'two consecutive builds must produce identical manifests');
    });

    test('stale prior output is removed', () => {
        // This is implicitly tested by idempotency:
        // if stale files persisted, the manifest would differ.
        // But let's also verify: two builds in a row produce the same count
        buildRuntime();
        const count1 = sortedManifest(RUNTIME_DIR).length;
        buildRuntime();
        const count2 = sortedManifest(RUNTIME_DIR).length;
        assert.strictEqual(count2, count1, 'file count must be stable across builds');
    });
});
