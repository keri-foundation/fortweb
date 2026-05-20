import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createFailureMessage,
    diffSnapshots,
    loadRuntimeOutputPaths,
} from './check-runtime-js.mjs';

test('loadRuntimeOutputPaths maps emitted runtime JavaScript files', async () => {
    const outputs = await loadRuntimeOutputPaths();

    assert(outputs.includes('app/app/main.js'));
    assert(outputs.includes('app/runtime/bridge.js'));
    assert(outputs.includes('app/runtime/messages.js'));
    assert(!outputs.some((outputPath) => outputPath.endsWith('.d.js')));
    assert(!outputs.some((outputPath) => outputPath.includes('vendor/')));
});

test('diffSnapshots reports changed runtime outputs', () => {
    const before = new Map([
        ['app/app/main.js', { exists: true, digest: 'old', size: 10 }],
        ['app/runtime/bridge.js', { exists: true, digest: 'same', size: 20 }],
    ]);
    const after = new Map([
        ['app/app/main.js', { exists: true, digest: 'new', size: 11 }],
        ['app/runtime/bridge.js', { exists: true, digest: 'same', size: 20 }],
    ]);

    assert.deepEqual(diffSnapshots(before, after), ['app/app/main.js']);
});

test('createFailureMessage explains stale JS guardrail', () => {
    const message = createFailureMessage(['app/app/main.js'], ['M  app/app/main.js']);

    assert.match(message, /TypeScript is the source of truth/i);
    assert.match(message, /Run `npm run build:runtime`/);
    assert.match(message, /Do not stage Fort-ios payloads from stale JS/i);
    assert.match(message, /app\/app\/main\.js/);
});