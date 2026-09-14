import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    canBind,
    findFreePort,
    parseExplicitPort,
    PORT_ENV,
    resolveE2ePort,
} from './run-playwright.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');

function occupyPort(port) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}

test('preferred port is used when available', async () => {
    const preferredPort = await findFreePort();
    const { port, source } = await resolveE2ePort({ preferredPort });
    assert.equal(port, preferredPort);
    assert.equal(source, 'preferred');
});

test('occupied preferred port falls back to another free port quickly', async () => {
    const preferredPort = await findFreePort();
    const blocker = await occupyPort(preferredPort);
    try {
        const started = Date.now();
        const { port, source } = await resolveE2ePort({ preferredPort });
        const elapsed = Date.now() - started;
        assert.equal(source, 'fallback');
        assert.notEqual(port, preferredPort);
        assert.ok(await canBind(port), 'fallback port should be bindable');
        assert.ok(elapsed < 3000, `fallback resolution should complete quickly (took ${elapsed}ms)`);
    } finally {
        blocker.close();
    }
});

test('explicit override is honored when available', async () => {
    const explicitPort = await findFreePort();
    const { port, source } = await resolveE2ePort({ explicitPort });
    assert.equal(port, explicitPort);
    assert.equal(source, 'explicit');
});

test('occupied explicit override fails fast', async () => {
    const explicitPort = await findFreePort();
    const blocker = await occupyPort(explicitPort);
    try {
        const started = Date.now();
        await assert.rejects(() => resolveE2ePort({ explicitPort }), /already in use/);
        const elapsed = Date.now() - started;
        assert.ok(elapsed < 3000, `occupied explicit override should fail fast (took ${elapsed}ms)`);
    } finally {
        blocker.close();
    }
});

test('explicit port is validated', () => {
    assert.throws(() => parseExplicitPort('not-a-number'), /between 1 and 65535/);
    assert.throws(() => parseExplicitPort('70000'), /between 1 and 65535/);
    assert.equal(parseExplicitPort(''), undefined);
    assert.equal(parseExplicitPort(undefined), undefined);
});

test('playwright config derives command, url, and baseURL from one port variable', () => {
    const config = readFileSync(path.join(PROJECT_DIR, 'playwright.config.ts'), 'utf8');
    assert.ok(config.includes(PORT_ENV), 'playwright.config.ts reads FORTWEB_E2E_PORT');
    const interpolations = (config.match(/\$\{PORT\}/g) ?? []).length;
    assert.ok(interpolations >= 3, `command/url/baseURL should all interpolate PORT (found ${interpolations})`);
});
