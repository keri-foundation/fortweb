/**
 * Runtime package manifest contract — single canonical source of truth.
 *
 * Used by the package producer (package-runtime.mjs) and the package verifier
 * (verify-runtime-package.mjs) so that field names, types, and requiredness
 * never drift between them.
 */

import path from 'node:path';

/**
 * Required top-level manifest fields.
 * Each must be a non-empty string unless noted otherwise.
 * @type {string[]}
 */
export const REQUIRED_MANIFEST_STRING_FIELDS = [
    'schema_version',
    'package_version',
    'package_name',
    'producer',
    'payload_profile',
    'fortweb_commit_sha',
    'runtime_origin',
    'entrypoint',
];

/**
 * Additional required fields with non-string types.
 * @type {{ name: string; type: string }[]}
 */
export const REQUIRED_MANIFEST_NON_STRING_FIELDS = [
    { name: 'files', type: 'array' },
];

/**
 * Optional fields the producer writes and the verifier tolerates.
 * @type {string[]}
 */
export const OPTIONAL_MANIFEST_FIELDS = [
    'git_ref',
    'base_path',
    'runtime_root',
    'vendor_root',
    'wheels_root',
    'origin_contract',
    'contracts',
];

/**
 * The canonical entrypoint path declared in the manifest.
 * Must correspond to an actual archive member beneath the runtime root.
 * @type {string}
 */
export const CANONICAL_ENTRYPOINT = 'app/index.html';

/**
 * The normative conventional path for the runtime-requirements artifact.
 * @type {string}
 */
export const RUNTIME_REQUIREMENTS_PATH = 'contracts/runtime-requirements.json';

/**
 * Supported runtime-requirements schema identifier.
 * @type {string}
 */
export const SUPPORTED_RUNTIME_REQUIREMENTS_SCHEMA = 'fort.runtime-requirements.v1';

/**
 * Validate that a parsed manifest object satisfies the required schema.
 * Throws on the first violation with a stable, descriptive message.
 *
 * @param {object} manifest - parsed manifest.json content
 * @param {string[]} archiveMembers - array of POSIX paths inside the extracted runtime root
 */
export function validateManifest(manifest, archiveMembers) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error('manifest.json must contain a JSON object.');
    }

    for (const key of REQUIRED_MANIFEST_STRING_FIELDS) {
        if (!(key in manifest)) {
            throw new Error(`Manifest is missing required field: ${key}`);
        }
        if (typeof manifest[key] !== 'string' || manifest[key].trim().length === 0) {
            throw new Error(`Manifest field ${key} must be a non-empty string.`);
        }
    }

    for (const { name, type } of REQUIRED_MANIFEST_NON_STRING_FIELDS) {
        if (!(name in manifest)) {
            throw new Error(`Manifest is missing required field: ${name}`);
        }
        if (type === 'array' && !Array.isArray(manifest[name])) {
            throw new Error(`Manifest field ${name} must be an array.`);
        }
    }

    if (archiveMembers) {
        const entrypoint = manifest.entrypoint;
        const memberSet = new Set(archiveMembers);
        if (!memberSet.has(entrypoint)) {
            throw new Error(
                `Manifest entrypoint '${entrypoint}' is not present in the archive.`,
            );
        }
    }

    // --- contracts validation ---
    if (manifest.contracts) {
        if (typeof manifest.contracts !== 'object' || Array.isArray(manifest.contracts)) {
            throw new Error('Manifest contracts field must be an object.');
        }

        const rr = manifest.contracts.runtime_requirements;
        if (rr) {
            // Typed descriptor must have a path
            if (typeof rr.path !== 'string' || rr.path.trim().length === 0) {
                throw new Error(
                    'contracts.runtime_requirements.path must be a non-empty string.',
                );
            }

            const p = rr.path;

            // Path must equal the normative conventional path
            if (p !== RUNTIME_REQUIREMENTS_PATH) {
                throw new Error(
                    `contracts.runtime_requirements.path must be '${RUNTIME_REQUIREMENTS_PATH}', got '${p}'.`,
                );
            }

            // Path must be safe: no absolute, no backslash, no traversal
            if (path.isAbsolute(p)) {
                throw new Error(
                    `contracts.runtime_requirements.path must be relative: ${p}`,
                );
            }
            if (p.includes('\\')) {
                throw new Error(
                    `contracts.runtime_requirements.path must not contain backslashes: ${p}`,
                );
            }
            const norm = path.posix.normalize(p);
            if (norm !== p || norm.startsWith('..') || norm.split('/').includes('..')) {
                throw new Error(
                    `contracts.runtime_requirements.path must not contain traversal: ${p}`,
                );
            }

            // Must appear in the file inventory exactly once
            if (Array.isArray(manifest.files)) {
                const matches = manifest.files.filter((f) => f.path === p);
                if (matches.length === 0) {
                    throw new Error(
                        `contracts.runtime_requirements.path '${p}' is not present in the file inventory.`,
                    );
                }
                if (matches.length > 1) {
                    throw new Error(
                        `contracts.runtime_requirements.path '${p}' appears ${matches.length} times in the file inventory; must appear exactly once.`,
                    );
                }
                // Validate the inventory entry has sha256 and bytes
                const entry = matches[0];
                if (typeof entry.sha256 !== 'string' || entry.sha256.length !== 64) {
                    throw new Error(
                        `File inventory entry for '${p}' must have a valid sha256.`,
                    );
                }
                if (!Number.isInteger(entry.bytes) || entry.bytes < 0) {
                    throw new Error(
                        `File inventory entry for '${p}' must have a non-negative bytes field.`,
                    );
                }
            }
        }
    }
}
