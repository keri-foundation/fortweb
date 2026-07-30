/**
 * Runtime package manifest contract — single canonical source of truth.
 *
 * Used by the package producer (package-runtime.mjs) and the package verifier
 * (verify-runtime-package.mjs) so that field names, types, and requiredness
 * never drift between them.
 */

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
];

/**
 * The canonical entrypoint path declared in the manifest.
 * Must correspond to an actual archive member beneath the runtime root.
 * @type {string}
 */
export const CANONICAL_ENTRYPOINT = 'app/index.html';

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
}
