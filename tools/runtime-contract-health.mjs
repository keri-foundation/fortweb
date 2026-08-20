/**
 * Runtime contract health check — single reusable entry point.
 *
 * Verifies a generated FortWeb runtime package end-to-end:
 *   1. ZIP exists and is readable.
 *   2. manifest.json parses and contains the typed contracts descriptor.
 *   3. Descriptor uses the conventional path.
 *   4. Contract appears exactly once in the file inventory.
 *   5. Extracted bytes match inventory byte count.
 *   6. Extracted bytes match inventory SHA-256.
 *   7. Bytes are valid strict UTF-8.
 *   8. No U+FFFD replacement character is present.
 *   9. Contract JSON parses.
 *  10. Semantic validation passes (schema, version, producer, profile,
 *      capabilities, forbidden_behaviors).
 *  11. Canonical package verifier accepts the package.
 *
 * Usage:
 *   node tools/runtime-contract-health.mjs <path-to-zip>
 *
 * Exit 0 on success; exit 1 on contract failure; exit 2 on tool error.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, validateRuntimeRequirements, RUNTIME_REQUIREMENTS_PATH, SUPPORTED_RUNTIME_REQUIREMENTS_SCHEMA } from './runtime-package-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const VERIFY_SCRIPT = path.join(PROJECT_DIR, 'tools/verify-runtime-package.mjs');

function fail(message) {
    process.stderr.write(`[contract-health] ${message}\n`);
    process.exit(1);
}

function toolError(message) {
    process.stderr.write(`[contract-health] TOOL ERROR: ${message}\n`);
    process.exit(2);
}

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

function runVerifier(zipPath) {
    try {
        execFileSync('node', [VERIFY_SCRIPT, zipPath], {
            cwd: PROJECT_DIR,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return true;
    } catch {
        return false;
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 1) {
        toolError('Usage: node tools/runtime-contract-health.mjs <runtime-package.zip>');
    }

    const zipPath = path.resolve(args[0]);
    const stats = await lstat(zipPath).catch(() => null);
    if (!stats || !stats.isFile()) {
        toolError(`ZIP not found: ${zipPath}`);
    }

    // 1. Extract manifest
    let manifestText;
    try {
        manifestText = execFileSync('unzip', ['-p', zipPath, 'fortweb-runtime/manifest.json'], {
            cwd: PROJECT_DIR,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch {
        fail('Cannot read manifest.json from package.');
    }

    let manifest;
    try {
        manifest = JSON.parse(manifestText);
    } catch {
        fail('manifest.json is not valid JSON.');
    }

    // 2. Validate manifest structure
    try {
        validateManifest(manifest, null);
    } catch (err) {
        fail(`Manifest validation failed: ${err.message}`);
    }

    // 3. Verify typed descriptor
    const rr = manifest.contracts?.runtime_requirements;
    if (!rr || typeof rr.path !== 'string') {
        fail('Typed runtime-requirements descriptor is missing or invalid.');
    }

    if (rr.path !== RUNTIME_REQUIREMENTS_PATH) {
        fail(`Descriptor path '${rr.path}' is not the conventional path '${RUNTIME_REQUIREMENTS_PATH}'.`);
    }

    // 4. Inventory: exactly one entry
    const inventoryMatches = manifest.files.filter((f) => f.path === RUNTIME_REQUIREMENTS_PATH);
    if (inventoryMatches.length !== 1) {
        fail(`Inventory has ${inventoryMatches.length} entries for '${RUNTIME_REQUIREMENTS_PATH}'; expected exactly 1.`);
    }

    const inventoryEntry = inventoryMatches[0];
    const manifestBytes = inventoryEntry.bytes;
    const manifestSha = inventoryEntry.sha256;

    // 5. Extract actual bytes from ZIP (no shell normalization)
    let actualBuffer;
    try {
        actualBuffer = execFileSync('unzip', ['-p', zipPath, `fortweb-runtime/${RUNTIME_REQUIREMENTS_PATH}`], {
            cwd: PROJECT_DIR,
            encoding: null, // raw Buffer
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 100 * 1024 * 1024,
        });
    } catch {
        fail('Cannot extract contract from package.');
    }

    const actualBytes = actualBuffer.length;
    const actualSha = sha256(actualBuffer);

    // 6. Byte-count match
    if (actualBytes !== manifestBytes) {
        fail(`Byte-count mismatch: actual=${actualBytes} manifest=${manifestBytes}`);
    }

    // 7. Digest match
    if (actualSha !== manifestSha) {
        fail(`SHA-256 mismatch: actual=${actualSha} manifest=${manifestSha}`);
    }

    // 8. Strict UTF-8
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let rrText;
    try {
        rrText = decoder.decode(actualBuffer);
    } catch (err) {
        fail(`Contract is not valid UTF-8: ${err.message}`);
    }

    // 9. No replacement character
    if (rrText.includes('\uFFFD')) {
        fail('Contract contains U+FFFD replacement characters.');
    }

    // 10. JSON parse
    let rrData;
    try {
        rrData = JSON.parse(rrText);
    } catch (err) {
        fail(`Contract is not valid JSON: ${err.message}`);
    }

    // 11. Semantic validation
    try {
        validateRuntimeRequirements(rrText, manifest);
    } catch (err) {
        fail(`Contract semantic validation failed: ${err.message}`);
    }

    // 12. Canonical verifier
    if (!runVerifier(zipPath)) {
        fail('Canonical package verifier rejected the package.');
    }

    // Success — emit structured evidence
    const result = {
        status: 'PASS',
        contract_path: RUNTIME_REQUIREMENTS_PATH,
        schema: rrData.schema,
        version: rrData.version,
        producer: rrData.producer,
        payload_profile: rrData.payload_profile,
        capability_count: Object.keys(rrData.capabilities).length,
        forbidden_behavior_count: rrData.forbidden_behaviors.length,
        inventory_entries: inventoryMatches.length,
        actual_bytes: actualBytes,
        manifest_bytes: manifestBytes,
        actual_sha256: actualSha,
        manifest_sha256: manifestSha,
        canonical_verifier: 'PASS',
    };

    process.stdout.write(JSON.stringify(result, null, 2));
    process.stdout.write('\n');
}

await main().catch((error) => {
    process.stderr.write(`[contract-health] TOOL ERROR: ${error.message}\n`);
    process.exit(2);
});
