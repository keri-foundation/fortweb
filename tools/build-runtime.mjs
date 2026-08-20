import { cp, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
        source: 'app/assets',
        target: 'app/assets',
        recursive: true,
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

// Assets whose dev-time `/fortweb/...` URL prefixes are rewritten to
// root-relative paths when the packaged runtime is emitted. The dev
// servers serve `libs/` with `/fortweb/app/`, `/fortweb/vendor/`, and
// `/fortweb/wheels/` prefixes (matching pyscript-ci.toml and
// wallet-worker.py in source); the packaged runtime is self-contained
// and served from its own root, so those prefixes must drop to `/`.
const PACKAGED_URL_REWRITES = [
    {
        file: 'pyscript-ci.toml',
        rewrites: [['/fortweb/vendor/', '/vendor/']],
    },
    {
        file: 'app/runtime/wallet-worker.py',
        rewrites: [
            ['/fortweb/vendor/', '/vendor/'],
            ['/fortweb/wheels/', '/wheels/'],
        ],
    },
];

async function rewritePackagedUrls() {
    for (const { file, rewrites } of PACKAGED_URL_REWRITES) {
        const targetPath = path.join(OUTPUT_DIR, file);
        let content = await readFile(targetPath, 'utf8');

        for (const [from, to] of rewrites) {
            content = content.replaceAll(from, to);
        }

        await writeFile(targetPath, content, 'utf8');
    }
}

async function main() {
    await rm(OUTPUT_DIR, { recursive: true, force: true });
    await runCommand('tsc', ['--project', 'tsconfig.build.json'], PROJECT_DIR);
    await copyRuntimeAssets();
    await rewritePackagedUrls();

    const entrypointPath = path.join(OUTPUT_DIR, 'app/index.html');
    const entrypointStats = await lstat(entrypointPath).catch(() => null);
    if (!entrypointStats || !entrypointStats.isFile()) {
        throw new Error(`[build-runtime] Runtime entrypoint not found after build: ${entrypointPath}`);
    }

    process.stdout.write('[build-runtime] emitted runtime JS to dist/runtime.\n');
}

main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});