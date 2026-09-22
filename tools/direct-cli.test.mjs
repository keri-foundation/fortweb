import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isDirectCliInvocation } from './direct-cli.mjs';

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELPER_PATH = path.join(PROJECT_DIR, 'tools/direct-cli.mjs');
const HELPER_URL = pathToFileURL(HELPER_PATH).href;

// These cover the helper's own semantics. The per-tool suites keep their heavier
// process-level setups that spawn each CLI through a real symlink.
test('a direct invocation is detected', () => {
    assert.equal(isDirectCliInvocation(HELPER_URL, HELPER_PATH), true);
});

test('a symlinked direct invocation is detected', () => {
    const scratch = mkdtempSync(path.join(os.tmpdir(), 'fortweb-direct-cli.'));
    try {
        // Both a symlink to the file and a symlink to its directory previously made the
        // lexical comparison fail, so the CLI exited 0 having done nothing.
        const linkedFile = path.join(scratch, 'linked-cli.mjs');
        symlinkSync(HELPER_PATH, linkedFile);
        assert.equal(isDirectCliInvocation(HELPER_URL, linkedFile), true, 'file symlink must still run the CLI');

        const linkedTools = path.join(scratch, 'tools');
        symlinkSync(path.join(PROJECT_DIR, 'tools'), linkedTools);
        assert.equal(
            isDirectCliInvocation(HELPER_URL, path.join(linkedTools, 'direct-cli.mjs')),
            true,
            'directory symlink must still run the CLI',
        );
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
});

test('an imported module is not treated as the entry point', () => {
    assert.equal(isDirectCliInvocation(HELPER_URL, path.join(PROJECT_DIR, 'tools/package-runtime.mjs')), false);
    assert.equal(isDirectCliInvocation(HELPER_URL, path.join(PROJECT_DIR, 'package.json')), false);
});

test('a missing or unresolvable entry path is not treated as the entry point', () => {
    assert.equal(isDirectCliInvocation(HELPER_URL, null), false, 'no invoked path means no direct invocation');
    assert.equal(isDirectCliInvocation(HELPER_URL, ''), false, 'an empty invoked path is not this module');

    const scratch = mkdtempSync(path.join(os.tmpdir(), 'fortweb-direct-cli-missing.'));
    try {
        const dangling = path.join(scratch, 'dangling-cli.mjs');
        symlinkSync(path.join(scratch, 'does-not-exist.mjs'), dangling);
        assert.equal(isDirectCliInvocation(HELPER_URL, dangling), false, 'an unresolvable symlink is not this module');
        assert.equal(
            isDirectCliInvocation(HELPER_URL, path.join(scratch, 'missing-cli.mjs')),
            false,
            'a missing path is not this module',
        );
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
});
