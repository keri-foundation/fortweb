import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadRuntimeOutputPaths } from './check-runtime-js.mjs';
import { isDirectCliInvocation } from './direct-cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_DIR = path.resolve(__dirname, '..');

export function emitCurrentTypeScript(projectDir, outputDir) {
    const compiler = path.join(projectDir, 'node_modules/typescript/bin/tsc');
    const result = spawnSync(
        process.execPath,
        [compiler, '--project', path.join(projectDir, 'tsconfig.build.json'), '--outDir', outputDir],
        { cwd: projectDir, encoding: 'utf8' },
    );
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error((result.stderr || result.stdout || 'TypeScript runtime emission failed.').trim());
    }
}

function relativeRuntimePath(runtimeOutputPath) {
    const runtimePrefix = 'dist/runtime/';
    if (!runtimeOutputPath.startsWith(runtimePrefix)) {
        throw new Error(`Expected a TypeScript output under ${runtimePrefix}: ${runtimeOutputPath}`);
    }
    return runtimeOutputPath.slice(runtimePrefix.length);
}

function displayPath(projectDir, absolutePath) {
    const relative = path.relative(projectDir, absolutePath);
    return relative.startsWith('..') || path.isAbsolute(relative)
        ? absolutePath
        : relative.split(path.sep).join('/');
}

export async function compareRuntimeFreshness(projectDir, runtimeDir, emittedDir) {
    const configuredOutputs = await loadRuntimeOutputPaths(projectDir, 'dist/runtime');
    const stale = [];
    const missing = [];

    for (const configuredOutput of configuredOutputs) {
        const relativeOutput = relativeRuntimePath(configuredOutput);
        const currentOutput = path.join(emittedDir, relativeOutput);
        const runtimeOutput = path.join(runtimeDir, relativeOutput);
        let currentBytes;
        let runtimeBytes;

        try {
            currentBytes = await readFile(currentOutput);
        } catch (error) {
            throw new Error(`Fresh TypeScript emission is missing ${relativeOutput}: ${error.message}`);
        }
        try {
            runtimeBytes = await readFile(runtimeOutput);
        } catch {
            missing.push(displayPath(projectDir, runtimeOutput));
            continue;
        }

        if (!currentBytes.equals(runtimeBytes)) {
            stale.push(displayPath(projectDir, runtimeOutput));
        }
    }

    if (missing.length > 0 || stale.length > 0) {
        const lines = [
            'FortWeb browser JavaScript is stale or missing.',
            'TypeScript is the source of truth; the local server will not serve mismatched generated output.',
            'Run `npm run build:runtime` and restart the server, or use `--runtime-dir dist/runtime` after building.',
        ];
        if (missing.length > 0) {
            lines.push('', 'Missing generated outputs:', ...missing.map((output) => `- ${output}`));
        }
        if (stale.length > 0) {
            lines.push('', 'Outputs that differ from current TypeScript:', ...stale.map((output) => `- ${output}`));
        }
        throw new Error(lines.join('\n'));
    }

    return configuredOutputs.length;
}

export async function verifyRuntimeFreshness(projectDir = DEFAULT_PROJECT_DIR, runtimeDir = path.join(projectDir, 'dist/runtime')) {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'fortweb-runtime-freshness-'));
    try {
        emitCurrentTypeScript(projectDir, temporaryRoot);
        return await compareRuntimeFreshness(projectDir, runtimeDir, temporaryRoot);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
}

export async function main(projectDir = DEFAULT_PROJECT_DIR, runtimeArgument = '') {
    const runtimeDir = path.resolve(projectDir, runtimeArgument || 'dist/runtime');
    const count = await verifyRuntimeFreshness(projectDir, runtimeDir);
    process.stdout.write(`[local-runtime-freshness] verified ${count} TypeScript outputs against ${displayPath(projectDir, runtimeDir)}.\n`);
}

if (isDirectCliInvocation(import.meta.url)) {
    main(DEFAULT_PROJECT_DIR, process.argv[2] ?? '').catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
