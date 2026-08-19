import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');

function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(() => resolve(address.port));
        });
    });
}

async function waitForServer(url, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await fetch(url);
            return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

function startServer(command, args, extraEnv = {}) {
    const child = spawn(command, args, {
        cwd: PROJECT_DIR,
        env: { ...process.env, ...extraEnv },
        stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });
    return { child, stderr: () => stderr };
}

function readInterpreterPath() {
    const toml = readFileSync(path.join(PROJECT_DIR, 'pyscript-ci.toml'), 'utf8');
    const match = toml.match(/interpreter\s*=\s*"([^"]+)"/);
    assert.ok(match, 'pyscript-ci.toml must declare an interpreter path');
    return match[1];
}

function readAppWheelPath() {
    const worker = readFileSync(path.join(PROJECT_DIR, 'app', 'runtime', 'wallet-worker.py'), 'utf8');
    const match = worker.match(/"(\/fortweb\/wheels\/[^"]+\.whl)"/);
    assert.ok(match, 'wallet-worker.py must declare a /fortweb/wheels/ wheel');
    return match[1];
}

test('development servers honor the shared FortWeb static contract', async (t) => {
    const generatedMainJs = path.join(PROJECT_DIR, 'dist', 'runtime', 'app', 'app', 'main.js');
    if (!existsSync(generatedMainJs)) {
        await new Promise((resolve, reject) => {
            const build = spawn('node', ['tools/build-runtime.mjs'], { cwd: PROJECT_DIR, stdio: 'inherit' });
            build.on('error', reject);
            build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build-runtime exited ${code}`))));
        });
    }
    const generatedMainJsText = readFileSync(generatedMainJs, 'utf8');

    const serveLocalPort = await findFreePort();
    const servePyPort = await findFreePort();

    const servers = [];
    t.after(async () => {
        for (const { child } of servers) {
            if (!child.killed) {
                child.kill('SIGTERM');
            }
        }
    });

    const serveLocal = startServer('python3', ['scripts/serve_local.py', '--no-open', '--port', String(serveLocalPort)]);
    const servePy = startServer('python3', ['serve.py'], { PORT: String(servePyPort) });
    servers.push(serveLocal, servePy);

    try {
        await waitForServer(`http://127.0.0.1:${serveLocalPort}/fortweb/app/`);
        await waitForServer(`http://127.0.0.1:${servePyPort}/fortweb/app/`);
    } catch (error) {
        throw new Error(
            `${error.message}\nserve_local stderr:\n${serveLocal.stderr()}\nserve.py stderr:\n${servePy.stderr()}`,
        );
    }

    const interpreter = readInterpreterPath();
    const wheelPath = readAppWheelPath();

    const cases = [
        { name: 'serve_local.py', base: `http://127.0.0.1:${serveLocalPort}` },
        { name: 'serve.py', base: `http://127.0.0.1:${servePyPort}` },
    ];

    for (const { name, base } of cases) {
        const index = await fetch(`${base}/fortweb/app/`);
        assert.equal(index.status, 200, `${name}: /fortweb/app/ status`);
        assert.match(index.headers.get('content-type') ?? '', /text\/html/, `${name}: index MIME`);
        assert.match(index.headers.get('cache-control') ?? '', /no-store/, `${name}: no-store cache header`);

        const main = await fetch(`${base}/fortweb/app/app/main.js`);
        assert.equal(main.status, 200, `${name}: main.js status`);
        assert.equal(main.headers.get('content-type'), 'application/javascript', `${name}: main.js MIME`);
        assert.equal(await main.text(), generatedMainJsText, `${name}: main.js is the generated artifact`);

        const worker = await fetch(`${base}/fortweb/app/runtime/wallet-worker.py`);
        assert.equal(worker.status, 200, `${name}: wallet-worker.py status`);
        const workerText = await worker.text();
        assert.ok(workerText.includes('"/fortweb/vendor/'), `${name}: worker keeps dev /fortweb/ prefix`);
        assert.ok(!workerText.includes('"/vendor/pyodide/'), `${name}: worker is not the packaged copy`);

        const interpreterRes = await fetch(`${base}${interpreter}`);
        assert.equal(interpreterRes.status, 200, `${name}: interpreter ${interpreter} status`);
        assert.equal(interpreterRes.headers.get('content-type'), 'application/javascript', `${name}: interpreter MIME`);

        const wheel = await fetch(`${base}${wheelPath}`);
        assert.equal(wheel.status, 200, `${name}: wheel ${wheelPath} status`);
        assert.equal(wheel.headers.get('content-type'), 'application/octet-stream', `${name}: wheel MIME`);
    }

    const disallowedProxy = await fetch(`http://127.0.0.1:${servePyPort}/_fortweb_proxy/http/evil.example.com/foo`);
    assert.equal(disallowedProxy.status, 400, 'serve.py rejects a disallowed proxy host');
});
