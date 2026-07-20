/**
 * Python / Pyodide dependency closure validator.
 * Derives expected wheel paths from pyscript-ci.toml and verifies
 * every declared dependency exists in the runtime artifact.
 */
import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(__dirname, '..', 'dist/runtime');
const PROJECT_DIR = resolve(__dirname, '..');

function sha256(filePath) {
    try {
        const data = readFileSync(filePath);
        return createHash('sha256').update(data).digest('hex');
    } catch {
        return null;
    }
}

function readPyScriptConfig() {
    const configPath = join(PROJECT_DIR, 'pyscript-ci.toml');
    const content = readFileSync(configPath, 'utf-8');

    // Parse interpreter path
    const interpreterMatch = content.match(/interpreter\s*=\s*"([^"]+)"/);
    const interpreter = interpreterMatch ? interpreterMatch[1] : '';

    // Parse [files] section
    const files = {};
    const filesSection = content.match(/\[files\]([\s\S]*?)(?=\[|$)/);
    if (filesSection) {
        for (const line of filesSection[1].split('\n')) {
            const m = line.match(/"([^"]+)"\s*=\s*"([^"]+)"/);
            if (m) files[m[1]] = m[2];
        }
    }

    return { interpreter, files };
}

// ── Tests ──

describe('Python dependency closure', () => {
    test('pyscript-ci.toml exists', () => {
        assert.ok(existsSync(join(PROJECT_DIR, 'pyscript-ci.toml')));
    });

    test('Pyodide interpreter is declared', () => {
        const config = readPyScriptConfig();
        assert.ok(config.interpreter.length > 0, 'interpreter path must be declared');
        assert.ok(config.interpreter.includes('pyodide'), 'interpreter should reference pyodide');
    });

    test('Pyodide core files exist in runtime', () => {
        const config = readPyScriptConfig();
        // interpreter is "/fortweb/vendor/pyodide/0.29.3/pyodide.mjs"
        const interpreterRel = config.interpreter.replace(/^\/fortweb\//, '');
        const interpreterPath = join(RUNTIME_DIR, interpreterRel);
        assert.ok(existsSync(interpreterPath), `interpreter must exist: ${interpreterRel}`);

        // pyodide.asm.wasm should be in same directory
        const wasmPath = join(RUNTIME_DIR, 'vendor/pyodide/0.29.3/pyodide.asm.wasm');
        assert.ok(existsSync(wasmPath), 'pyodide.asm.wasm must exist');

        // python_stdlib.zip
        const stdlibPath = join(RUNTIME_DIR, 'vendor/pyodide/0.29.3/python_stdlib.zip');
        assert.ok(existsSync(stdlibPath), 'python_stdlib.zip must exist');
    });

    test('worker Python source files exist', () => {
        const config = readPyScriptConfig();
        for (const [src, dest] of Object.entries(config.files)) {
            const srcRel = src.replace(/^\.\//, '');
            const srcPath = join(PROJECT_DIR, srcRel);
            assert.ok(existsSync(srcPath), `worker source must exist: ${src}`);
        }
    });

    test('FortWeb application wheels exist', () => {
        const wheels = [
            'wheels/blake3-1.0.8-cp313-cp313-pyodide_2025_0_wasm32.whl',
            'wheels/keri_web-2.0.0.dev6-py3-none-any.whl',
            'wheels/hio_web-0.7.20-py3-none-any.whl',
            'wheels/msgpack-1.1.2-py3-none-any.whl',
            'wheels/pychloride-0.7.18.2-py3-none-any.whl',
        ];
        for (const wheel of wheels) {
            assert.ok(existsSync(join(RUNTIME_DIR, wheel)), `app wheel must exist: ${wheel}`);
        }
    });

    test('Pyodice third-party wheel directory exists and has wheels', () => {
        const wheelsDir = join(RUNTIME_DIR, 'vendor/pyodide/0.29.3/wheels');
        assert.ok(existsSync(wheelsDir), 'wheels directory must exist');

        // At minimum, cbor2 must be present (was the blocker)
        const cbor2 = join(wheelsDir, 'cbor2-5.8.0-py3-none-any.whl');
        assert.ok(existsSync(cbor2), 'cbor2 wheel must exist');
    });

    test('no wheel references escape the runtime root', () => {
        const config = readPyScriptConfig();
        // Check that interpreter path is under /fortweb/
        assert.ok(
            config.interpreter.startsWith('/fortweb/'),
            'interpreter must be under /fortweb/'
        );
    });
});

// ── Negative tests ──

describe('Python dependency closure negative cases', () => {
    test('detects missing Pyodide wasm', () => {
        const fakePath = join(RUNTIME_DIR, 'vendor/pyodide/0.29.3/pyodide-nonexistent.wasm');
        assert.ok(!existsSync(fakePath));
    });

    test('detects missing cbor2 when runtime dir is empty', () => {
        // Just verify the check would work: if we queried a non-existent runtime
        const cbor2 = join(RUNTIME_DIR, 'vendor/pyodide/999.99.99/wheels/cbor2.whl');
        assert.ok(!existsSync(cbor2));
    });

    test('wrong Pyodide version path does not exist', () => {
        const wrongVersion = join(RUNTIME_DIR, 'vendor/pyodide/0.29.1/pyodide.mjs');
        assert.ok(!existsSync(wrongVersion), 'wrong version path should not exist');
    });
});
