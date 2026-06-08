import { cp, mkdir, readdir, rm, readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_DIR, '.tmp/runtime-packages');
const STAGING_DIR = path.join(PROJECT_DIR, '.tmp/runtime-package-work');
const RUNTIME_DIR = path.join(PROJECT_DIR, 'dist/runtime');

/**
 * Parse command line arguments
 * @returns {{ noBuild: boolean; outDir?: string }}
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const result = { noBuild: false, outDir: undefined };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--no-build') {
            result.noBuild = true;
        } else if (args[i] === '--out-dir' && args[i + 1]) {
            result.outDir = args[++i];
        }
    }

    return result;
}

/**
 * Get project metadata from package.json and git
 * @returns {{ version: string; gitSha: string; gitShortSha: string; gitRef: string }}
 */
async function getProjectInfo() {
    const packageJsonPath = path.join(PROJECT_DIR, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

    const gitSha = await runGitCommand(['rev-parse', 'HEAD']);
    const gitShortSha = await runGitCommand(['rev-parse', '--short', 'HEAD']);
    const gitRef = await runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD']);

    return {
        version: packageJson.version || '0.0.0',
        gitSha,
        gitShortSha,
        gitRef,
    };
}

/**
 * Run a git command and return the output
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function runGitCommand(args) {
    return new Promise((resolve, reject) => {
        const child = spawn('git', args, {
            cwd: PROJECT_DIR,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let output = '';
        child.stdout.on('data', (data) => {
            output += data.toString();
        });

        child.on('error', reject);

        child.on('exit', (code) => {
            if (code === 0) {
                resolve(output.trim());
            } else {
                reject(new Error(`git ${args.join(' ')} failed with exit code ${code ?? 'unknown'}`));
            }
        });
    });
}

/**
 * Collect all files recursively from a directory
 * @param {string} dir
 * @param {string} baseDir
 * @returns {Promise<string[]>}
 */
async function collectFilesRecursively(dir, baseDir = dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            files.push(...(await collectFilesRecursively(fullPath, baseDir)));
        } else if (entry.isFile()) {
            const relativePath = path.relative(baseDir, fullPath);
            files.push(relativePath);
        }
    }

    return files;
}

/**
 * Calculate SHA-256 hash of a file
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function fileFingerprint(filePath) {
    const buffer = await readFile(filePath);
    const hash = createHash('sha256');
    hash.update(buffer);
    return hash.digest('hex');
}

/**
 * Get file size in bytes
 * @param {string} filePath
 * @returns {Promise<number>}
 */
async function getFileSize(filePath) {
    const stats = await readFile(filePath);
    return stats.length;
}

/**
 * Generate manifest.json content
 * @param {{ version: string; gitSha: string; gitShortSha: string; gitRef: string }} projectInfo
 * @param {Array<{ path: string; sha256: string; bytes: number }>} files
 * @returns {string}
 */
function generateManifest(projectInfo, files) {
    const manifest = {
        schemaVersion: 1,
        packageName: 'fortweb-runtime',
        version: projectInfo.version,
        gitSha: projectInfo.gitSha,
        gitRef: projectInfo.gitRef,
        createdAt: new Date().toISOString(),
        basePath: '/fortweb/app/',
        entrypoint: 'app/index.html',
        runtimeRoot: '.',
        vendorRoot: 'vendor',
        wheelsRoot: 'wheels',
        originContract: {
            schema: 'fortweb.runtime-origin.v1',
            version: 1,
        },
        files,
    };

    return JSON.stringify(manifest, null, 2);
}

/**
 * Generate checksums.sha256 content
 * @param {string} manifestContent
 * @returns {string}
 */
function generateChecksums(manifestContent) {
    const hash = createHash('sha256');
    hash.update(manifestContent);
    return `${hash.digest('hex')}  manifest.json`;
}

/**
 * Create ZIP archive using system zip command
 * @param {string} sourceDir
 * @param {string} zipPath
 * @returns {Promise<void>}
 */
async function createZip(sourceDir, zipPath) {
    return new Promise((resolve, reject) => {
        const child = spawn('zip', ['-X', '-r', path.basename(zipPath), '.'], {
            cwd: sourceDir,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        child.on('error', reject);

        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`zip failed with exit code ${code ?? 'unknown'}`));
            }
        });
    });
}

/**
 * Main entry point
 */
async function main() {
    const args = parseArgs();

    // Build runtime if not skipped
    if (!args.noBuild) {
        console.log('[package-runtime] Building runtime...');
        await new Promise((resolve, reject) => {
            const child = spawn('npm', ['run', 'build:runtime'], {
                cwd: PROJECT_DIR,
                stdio: 'inherit',
            });

            child.on('error', reject);

            child.on('exit', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`npm run build:runtime failed with exit code ${code ?? 'unknown'}`));
                }
            });
        });
        console.log('[package-runtime] Build complete.');
    }

    // Validate runtime directory exists
    if (!(await pathExists(RUNTIME_DIR))) {
        throw new Error(`Runtime directory not found: ${RUNTIME_DIR}. Run 'npm run build:runtime' first.`);
    }

    // Get project info
    console.log('[package-runtime] Collecting project metadata...');
    const projectInfo = await getProjectInfo();
    console.log(`[package-runtime] Version: ${projectInfo.version}`);
    console.log(`[package-runtime] Git SHA: ${projectInfo.gitSha}`);
    console.log(`[package-runtime] Git Ref: ${projectInfo.gitRef}`);

    // Collect files from dist/runtime
    console.log('[package-runtime] Collecting files from dist/runtime...');
    const files = await collectFilesRecursively(RUNTIME_DIR);
    console.log(`[package-runtime] Found ${files.length} files.`);

    // Filter out directories (we only want files)
    const fileEntries = [];
    for (const relativePath of files) {
        const fullPath = path.join(RUNTIME_DIR, relativePath);
        if (await pathExists(fullPath) && (await getStats(fullPath)).isFile()) {
            const sha256 = await fileFingerprint(fullPath);
            const size = await getFileSize(fullPath);
            fileEntries.push({ path: relativePath, sha256, bytes: size });
        }
    }

    // Sort files lexicographically by path for deterministic ordering
    fileEntries.sort((a, b) => a.path.localeCompare(b.path));

    // Generate manifest
    console.log('[package-runtime] Generating manifest.json...');
    const manifestContent = generateManifest(projectInfo, fileEntries);

    // Generate checksums
    console.log('[package-runtime] Generating checksums.sha256...');
    const checksumsContent = generateChecksums(manifestContent);

    // Create output directories
    await mkdir(OUTPUT_DIR, { recursive: true });
    await mkdir(STAGING_DIR, { recursive: true });

    // Clean staging directory
    if (await pathExists(STAGING_DIR)) {
        await rm(STAGING_DIR, { recursive: true, force: true });
    }
    await mkdir(STAGING_DIR, { recursive: true });

    // Create staging structure
    const stagingRuntimeDir = path.join(STAGING_DIR, 'fortweb-runtime');
    await mkdir(stagingRuntimeDir, { recursive: true });

    // Copy runtime files to staging
    console.log('[package-runtime] Copying runtime files to staging...');
    for (const entry of fileEntries) {
        const sourcePath = path.join(RUNTIME_DIR, entry.path);
        const targetPath = path.join(stagingRuntimeDir, entry.path);
        await mkdir(path.dirname(targetPath), { recursive: true });
        await cp(sourcePath, targetPath);
    }

    // Write manifest and checksums to staging
    await writeFile(path.join(stagingRuntimeDir, 'manifest.json'), manifestContent);
    await writeFile(path.join(stagingRuntimeDir, 'checksums.sha256'), checksumsContent);

    // Create ZIP archive
    const artifactName = `fortweb-runtime-${projectInfo.version}-${projectInfo.gitShortSha}.zip`;
    const zipPath = path.join(OUTPUT_DIR, artifactName);

    console.log('[package-runtime] Creating ZIP archive...');
    await createZip(STAGING_DIR, zipPath);

    // Move ZIP from staging parent to output directory
    const stagingZipPath = path.join(STAGING_DIR, artifactName);
    if (await pathExists(stagingZipPath)) {
        await cp(stagingZipPath, zipPath);
    }

    // Clean staging directory
    await rm(STAGING_DIR, { recursive: true, force: true });

    // Report results
    const artifactSize = (await getStats(zipPath)).size;
    console.log(`[package-runtime] Created artifact: ${zipPath}`);
    console.log(`[package-runtime] Artifact size: ${artifactSize} bytes`);
    console.log(`[package-runtime] Files in package: ${fileEntries.length}`);
    console.log(`[package-runtime] Manifest SHA-256: ${checksumsContent.split(' ')[0]}`);
}

/**
 * Check if a path exists
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function pathExists(filePath) {
    try {
        await lstat(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get file stats
 * @param {string} filePath
 * @returns {Promise<{ isFile: () => boolean; size: number }>}
 */
async function getStats(filePath) {
    const stats = await lstat(filePath);
    return {
        isFile: () => stats.isFile(),
        size: stats.size,
    };
}

// Run main
await main().catch((error) => {
    console.error('[package-runtime] Error:', error.message);
    process.exit(1);
});
