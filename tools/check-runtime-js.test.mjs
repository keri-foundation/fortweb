import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createFailureMessage,
    diffSnapshots,
    loadRuntimeOutputPaths,
} from './check-runtime-js.mjs';

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
