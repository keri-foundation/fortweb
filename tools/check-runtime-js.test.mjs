import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
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

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = path.join(PROJECT_DIR, 'tools/check-runtime-js.mjs');

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
