import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_DIR = path.resolve(__dirname, '..');

function isConcreteTypeScriptPath(includePath) {
    return includePath.endsWith('.ts') && !includePath.endsWith('.d.ts') && !includePath.includes('*');
}

export async function loadRuntimeOutputPaths(projectDir = DEFAULT_PROJECT_DIR) {
    const tsconfigPath = path.join(projectDir, 'tsconfig.build.json');
    const tsconfig = JSON.parse(await readFile(tsconfigPath, 'utf8'));
    const includes = Array.isArray(tsconfig.include) ? tsconfig.include : [];

    return includes
        .filter(isConcreteTypeScriptPath)
        .map((includePath) => includePath.replace(/\.ts$/u, '.js'));
}

async function fileFingerprint(filePath) {
    try {
        const buffer = await readFile(filePath);
        const digest = createHash('sha256').update(buffer).digest('hex');
        const info = await stat(filePath);
        return {
            exists: true,
            digest,
            size: info.size,
        };
    } catch {
        return {
            exists: false,
            digest: null,
            size: null,
        };
    }
}

export async function captureSnapshot(projectDir, relativePaths) {
    const entries = await Promise.all(
        relativePaths.map(async (relativePath) => {
            const absolutePath = path.join(projectDir, relativePath);
            return [relativePath, await fileFingerprint(absolutePath)];
        }),
    );

    return new Map(entries);
}

export function diffSnapshots(beforeSnapshot, afterSnapshot) {
    const changed = [];

    for (const [relativePath, before] of beforeSnapshot.entries()) {
        const after = afterSnapshot.get(relativePath);
        if (!after) {
            changed.push(relativePath);
            continue;
        }

        if (before.exists !== after.exists || before.digest !== after.digest || before.size !== after.size) {
            changed.push(relativePath);
        }
    }

    return changed.sort();
}

function runCommand(command, args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            stdio: 'inherit',
        });

        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code ?? 'unknown'}`));
        });
    });
}

async function readGitStatus(projectDir, relativePaths) {
    return new Promise((resolve, reject) => {
        const child = spawn('git', ['status', '--short', '--', ...relativePaths], {
            cwd: projectDir,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) {
                resolve(stdout.trim().split('\n').filter(Boolean));
                return;
            }

            reject(new Error(stderr.trim() || `git status failed with exit code ${code ?? 'unknown'}`));
        });
    });
}

export function createFailureMessage(changedOutputs, preExistingDirtyOutputs = []) {
    const lines = [
        '[check-runtime-js] stale runtime JavaScript detected.',
        'TypeScript is the source of truth for FortWeb runtime modules.',
        'Adjacent .js runtime artifacts changed when the runtime build was re-run.',
        'Run `npm run build:runtime`, review the emitted .js changes, and include them before staging Fort-ios payloads.',
        'Do not stage Fort-ios payloads from stale JS.',
        '',
        'Changed runtime artifacts:',
        ...changedOutputs.map((outputPath) => `- ${outputPath}`),
    ];

    if (preExistingDirtyOutputs.length > 0) {
        lines.push('', 'Pre-existing dirty runtime artifacts before the check:', ...preExistingDirtyOutputs.map((entry) => `- ${entry}`));
    }

    return lines.join('\n');
}

export async function main(projectDir = DEFAULT_PROJECT_DIR) {
    const runtimeOutputs = await loadRuntimeOutputPaths(projectDir);
    const beforeSnapshot = await captureSnapshot(projectDir, runtimeOutputs);
    const preExistingDirtyOutputs = await readGitStatus(projectDir, runtimeOutputs);

    await runCommand('npm', ['run', 'build:runtime'], projectDir);

    const afterSnapshot = await captureSnapshot(projectDir, runtimeOutputs);
    const changedOutputs = diffSnapshots(beforeSnapshot, afterSnapshot);

    if (changedOutputs.length > 0) {
        throw new Error(createFailureMessage(changedOutputs, preExistingDirtyOutputs));
    }

    process.stdout.write('[check-runtime-js] runtime JavaScript artifacts are in sync with TypeScript.\n');
}

const entrypointPath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (entrypointPath === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}