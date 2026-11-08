import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import {
    createFailureMessage,
    diffSnapshots,
    loadRuntimeOutputPaths,
} from './check-runtime-js.mjs';
import {
    compareRuntimeFreshness,
    emitCurrentTypeScript,
} from './verify-local-runtime-freshness.mjs';

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = path.join(PROJECT_DIR, 'tools/check-runtime-js.mjs');
const FRESHNESS_OUTPUTS = mkdtempSync(path.join(os.tmpdir(), 'fortweb-runtime-freshness-test.'));

function makeRuntimeFixture(name) {
    const runtimeDir = path.join(FRESHNESS_OUTPUTS, name);
    cpSync(path.join(FRESHNESS_OUTPUTS, 'emitted'), runtimeDir, { recursive: true });
    return runtimeDir;
}

test('local runtime freshness guard checks fresh, missing, stale, and unrelated outputs', async (t) => {
    const emittedDir = path.join(FRESHNESS_OUTPUTS, 'emitted');
    const runtimeOutputs = await loadRuntimeOutputPaths(PROJECT_DIR, 'dist/runtime');
    emitCurrentTypeScript(PROJECT_DIR, emittedDir);

    t.after(() => rmSync(FRESHNESS_OUTPUTS, { recursive: true, force: true }));

    await t.test('fresh emitted browser outputs pass', async () => {
        const runtimeDir = makeRuntimeFixture('fresh-runtime');
        assert.equal(await compareRuntimeFreshness(PROJECT_DIR, runtimeDir, emittedDir), runtimeOutputs.length);
    });

    await t.test('missing emitted output fails closed with its path', async () => {
        const runtimeDir = makeRuntimeFixture('missing-runtime');
        const missing = path.join(runtimeDir, 'app/app/main.js');
        unlinkSync(missing);
        await assert.rejects(
            compareRuntimeFreshness(PROJECT_DIR, runtimeDir, emittedDir),
            /FortWeb browser JavaScript is stale or missing[\s\S]*app\/app\/main\.js/,
        );
    });

    await t.test('stale emitted output fails closed with its path', async () => {
        const runtimeDir = makeRuntimeFixture('stale-runtime');
        writeFileSync(path.join(runtimeDir, 'app/app/main.js'), 'stale generated output');
        await assert.rejects(
            compareRuntimeFreshness(PROJECT_DIR, runtimeDir, emittedDir),
            /TypeScript is the source of truth[\s\S]*app\/app\/main\.js/,
        );
    });

    await t.test('unrelated runtime files do not trigger a freshness error', async () => {
        const runtimeDir = makeRuntimeFixture('unrelated-runtime');
        writeFileSync(path.join(runtimeDir, 'unrelated-runtime-file.txt'), 'not TypeScript-owned');
        assert.equal(await compareRuntimeFreshness(PROJECT_DIR, runtimeDir, emittedDir), runtimeOutputs.length);
        assert(existsSync(path.join(runtimeDir, 'unrelated-runtime-file.txt')));
    });
});

test('loadRuntimeOutputPaths maps emitted runtime JavaScript files', async () => {
    const outputs = await loadRuntimeOutputPaths();

    assert(outputs.includes('dist/runtime/app/app/main.js'));
    assert(outputs.includes('dist/runtime/app/runtime/bridge.js'));
    assert(outputs.includes('dist/runtime/app/runtime/messages.js'));
    assert(!outputs.includes('app/app/main.js'));
    assert(!outputs.some((outputPath) => outputPath.endsWith('.d.js')));
    assert(!outputs.some((outputPath) => outputPath.includes('vendor/')));
});

test('diffSnapshots reports changed runtime outputs', () => {
    const before = new Map([
        ['dist/runtime/app/app/main.js', { exists: true, digest: 'old', size: 10 }],
        ['dist/runtime/app/runtime/bridge.js', { exists: true, digest: 'same', size: 20 }],
    ]);
    const after = new Map([
        ['dist/runtime/app/app/main.js', { exists: true, digest: 'new', size: 11 }],
        ['dist/runtime/app/runtime/bridge.js', { exists: true, digest: 'same', size: 20 }],
    ]);

    assert.deepEqual(diffSnapshots(before, after), ['dist/runtime/app/app/main.js']);
});

test('createFailureMessage explains stale JS guardrail', () => {
    const message = createFailureMessage(['dist/runtime/app/app/main.js'], ['dist/runtime/app/runtime/bridge.js']);

    assert.match(message, /TypeScript is the source of truth/i);
    assert.match(message, /dist\/runtime/i);
    assert.match(message, /non-deterministic or missing runtime JS/i);
    assert.match(message, /dist\/runtime\/app\/app\/main\.js/);
    assert.match(message, /dist\/runtime\/app\/runtime\/bridge\.js/);
});

test('CLI entry point runs through symlinked paths instead of silently exiting 0', () => {
    const scratch = mkdtempSync(path.join(os.tmpdir(), 'fortweb-check-runtime-js.'));
    try {
        // Both a symlink to the file and a symlink to its directory previously made the
        // lexical entry-point comparison fail, so the CLI exited 0 having checked
        // nothing. An intentionally invalid runtime directory makes the real CLI fail
        // closed at its first boundary, proving execution without any runtime build.
        const linkedFile = path.join(scratch, 'check-runtime-js-link.mjs');
        symlinkSync(CHECKER, linkedFile);
        symlinkSync(path.join(PROJECT_DIR, 'tools'), path.join(scratch, 'tools'));
        const linkedDir = path.join(scratch, 'tools', 'check-runtime-js.mjs');

        const env = { ...process.env, FORTWEB_RUNTIME_DIR: '../outside' };
        for (const [name, entry] of [
            ['direct', CHECKER],
            ['file-symlink', linkedFile],
            ['directory-symlink', linkedDir],
        ]) {
            const result = spawnSync(process.execPath, [entry], { cwd: PROJECT_DIR, encoding: 'utf8', env });
            assert.notEqual(result.status, 0, `${name}: the CLI did not execute`);
            assert.match(result.stderr, /FORTWEB_RUNTIME_DIR must remain inside the repository/, name);
            assert.doesNotMatch(result.stdout, /generated runtime JavaScript output exists and is deterministic/, name);
        }
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
});
