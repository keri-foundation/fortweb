import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const PLAYWRIGHT_CLI = path.join(PROJECT_DIR, 'node_modules', '@playwright', 'test', 'cli.js');

export const PREFERRED_PORT = 4173;
export const PORT_ENV = 'FORTWEB_E2E_PORT';

export function parseExplicitPort(value) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${PORT_ENV} must be an integer between 1 and 65535, got: ${value}`);
    }
    return port;
}

export function canBind(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.unref();
        server.once('error', () => resolve(false));
        server.listen(port, host, () => {
            server.close(() => resolve(true));
        });
    });
}

export function findFreePort(host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.once('error', reject);
        server.listen(0, host, () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

export async function resolveE2ePort({ explicitPort, preferredPort = PREFERRED_PORT } = {}) {
    const explicit = parseExplicitPort(explicitPort);

    if (explicit !== undefined) {
        if (await canBind(explicit)) {
            return { port: explicit, source: 'explicit' };
        }
        throw new Error(`${PORT_ENV}=${explicit} is already in use. Choose a free port or unset ${PORT_ENV} to auto-select.`);
    }

    if (await canBind(preferredPort)) {
        return { port: preferredPort, source: 'preferred' };
    }

    const port = await findFreePort();
    return { port, source: 'fallback' };
}

export async function main(argv) {
    const { port, source } = await resolveE2ePort({ explicitPort: process.env[PORT_ENV] });

    if (source === 'fallback') {
        process.stderr.write(`[run-playwright] port ${PREFERRED_PORT} is occupied; using fallback port ${port}.\n`);
    } else if (source === 'explicit') {
        process.stderr.write(`[run-playwright] using explicit ${PORT_ENV}=${port}.\n`);
    } else {
        process.stderr.write(`[run-playwright] using port ${port}.\n`);
    }

    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, 'test', ...argv], {
        cwd: PROJECT_DIR,
        env: { ...process.env, [PORT_ENV]: String(port) },
        stdio: 'inherit',
    });

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => {
            if (!child.killed) {
                child.kill(signal);
            }
        });
    }

    return new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (signal) {
                resolve(1);
                return;
            }
            resolve(code ?? 1);
        });
    });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
    main(process.argv.slice(2)).then(
        (code) => process.exit(code),
        (error) => {
            process.stderr.write(`[run-playwright] ${error.message}\n`);
            process.exit(1);
        },
    );
}
