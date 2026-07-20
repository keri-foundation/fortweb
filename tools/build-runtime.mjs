import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_DIR, 'dist/runtime');

const STATIC_RUNTIME_ASSETS = [
    {
        source: 'pyscript-ci.toml',
        target: 'pyscript-ci.toml',
    },
    {
        source: 'app/runtime-origin-contract.json',
        target: 'app/runtime-origin-contract.json',
    },
    {
        source: 'app/index.html',
        target: 'app/index.html',
    },
    {
        source: 'app/styles/tokens.css',
        target: 'app/styles/tokens.css',
    },
    {
        source: 'app/styles/base.css',
        target: 'app/styles/base.css',
    },
    {
        source: 'app/styles/layout.css',
        target: 'app/styles/layout.css',
    },
    {
        source: 'app/styles/components.css',
        target: 'app/styles/components.css',
    },
    {
        source: 'app/runtime/wallet-worker.py',
        target: 'app/runtime/wallet-worker.py',
    },
    {
        source: 'app/runtime/vaulting.py',
        target: 'app/runtime/vaulting.py',
    },
    {
        source: 'app/runtime/transporting.py',
        target: 'app/runtime/transporting.py',
    },
    {
        source: 'app/runtime/onboarding.py',
        target: 'app/runtime/onboarding.py',
    },
    {
        source: 'vendor/pyscript/2025.11.2',
        target: 'vendor/pyscript/2025.11.2',
        recursive: true,
    },
    {
        source: 'vendor/pyodide/0.29.3',
        target: 'vendor/pyodide/0.29.3',
        recursive: true,
    },
    {
        source: 'wheels',
        target: 'wheels',
        recursive: true,
    },
    {
        source: 'app/assets',
        target: 'app/assets',
        recursive: true,
    },
];

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

async function copyRuntimeAssets() {
    const runtimeAssets = [
        ...STATIC_RUNTIME_ASSETS,
        ...(await collectJsOnlyRuntimeFiles()).map((filePath) => ({
            source: filePath,
            target: filePath,
        })),
    ];

    for (const asset of runtimeAssets) {
        const sourcePath = path.join(PROJECT_DIR, asset.source);
        const targetPath = path.join(OUTPUT_DIR, asset.target);

        await mkdir(path.dirname(targetPath), { recursive: true });
        await cp(sourcePath, targetPath, { force: true, recursive: Boolean(asset.recursive) });
    }
}

async function collectJsOnlyRuntimeFiles(relativeDir = 'app') {
    const directoryPath = path.join(PROJECT_DIR, relativeDir);
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const siblingNames = new Set(entries.map((entry) => entry.name));
    const jsOnlyFiles = [];

    for (const entry of entries) {
        const relativePath = path.join(relativeDir, entry.name);

        if (entry.isDirectory()) {
            jsOnlyFiles.push(...(await collectJsOnlyRuntimeFiles(relativePath)));
            continue;
        }

        if (!entry.isFile() || !entry.name.endsWith('.js')) {
            continue;
        }

        const stem = entry.name.slice(0, -3);
        if (siblingNames.has(`${stem}.ts`)) {
            continue;
        }

        jsOnlyFiles.push(relativePath);
    }

    return jsOnlyFiles;
}

async function main() {
    await rm(OUTPUT_DIR, { recursive: true, force: true });
    await runCommand('tsc', ['--project', 'tsconfig.build.json'], PROJECT_DIR);
    await copyRuntimeAssets();

    process.stdout.write('[build-runtime] emitted runtime JS to dist/runtime.\n');
}

main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});