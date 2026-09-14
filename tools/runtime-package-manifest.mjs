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
const REQUIRED_MANIFEST_STRING_FIELDS = [
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
const REQUIRED_MANIFEST_NON_STRING_FIELDS = [
    { name: 'files', type: 'array' },
    { name: 'contracts', type: 'object' },
];

/**
 * Optional fields the producer writes and the verifier tolerates.
 * @type {string[]}
 */
const OPTIONAL_MANIFEST_FIELDS = [
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
        if (type === 'object' && (typeof manifest[name] !== 'object' || manifest[name] === null || Array.isArray(manifest[name]))) {
            throw new Error(`Manifest field ${name} must be an object.`);
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
    // contracts is now a required field (moved from OPTIONAL in a5d9eb7+).
    // contracts.runtime_requirements must exist.
    if (typeof manifest.contracts !== 'object' || Array.isArray(manifest.contracts)) {
        throw new Error('Manifest contracts field must be an object.');
    }

    const rr = manifest.contracts.runtime_requirements;
    if (!rr || typeof rr !== 'object' || Array.isArray(rr)) {
        throw new Error(
            'contracts.runtime_requirements descriptor is required and must be an object.',
        );
    }

    // Typed descriptor must have a path
    if (typeof rr.path !== 'string' || rr.path.trim().length === 0) {
        throw new Error(
            'contracts.runtime_requirements.path must be a non-empty string.',
        );
    }

    const p = rr.path;

    // 1. Path safety checks (before conventional-path enforcement,
    //    so each safety rule can be independently exercised by tests)
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

    // 2. Normative conventional path enforcement
    if (p !== RUNTIME_REQUIREMENTS_PATH) {
        throw new Error(
            `contracts.runtime_requirements.path must be '${RUNTIME_REQUIREMENTS_PATH}', got '${p}'.`,
        );
    }

    // 3. Inventory checks
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

// ---------------------------------------------------------------------------
// Runtime requirements content validation
// ---------------------------------------------------------------------------

/**
 * Required top-level string fields in runtime-requirements.json.
 * @type {string[]}
 */
const REQUIRED_RR_STRING_FIELDS = [
    'schema',
    'producer',
    'payload_profile',
];

/**
 * Required numeric fields in runtime-requirements.json.
 * @type {string[]}
 */
const REQUIRED_RR_NUMERIC_FIELDS = ['version'];

/**
 * Required object fields in runtime-requirements.json.
 * @type {string[]}
 */
const REQUIRED_RR_OBJECT_FIELDS = ['capabilities'];

/**
 * Required array fields in runtime-requirements.json.
 * @type {string[]}
 */
const REQUIRED_RR_ARRAY_FIELDS = ['forbidden_behaviors'];

/**
 * Validate the content of a runtime-requirements.json artifact.
 * Assumes the caller has already verified the manifest inventory entry
 * (SHA-256 and bytes match the actual file). This function validates
 * the JSON structure and semantics.
 *
 * @param {string} jsonText - raw UTF-8 content of runtime-requirements.json
 * @param {object} manifest - parsed manifest.json (for cross-referencing producer/profile)
 * @throws {Error} on the first violation
 */
export function validateRuntimeRequirements(jsonText, manifest) {
    let rr;
    try {
        rr = JSON.parse(jsonText);
    } catch (err) {
        throw new Error(
            `Runtime requirements artifact is not valid JSON: ${err.message}`,
        );
    }

    if (!rr || typeof rr !== 'object' || Array.isArray(rr)) {
        throw new Error('Runtime requirements artifact must be a JSON object.');
    }

    // Required string fields
    for (const key of REQUIRED_RR_STRING_FIELDS) {
        if (!(key in rr)) {
            throw new Error(`Runtime requirements is missing required field: ${key}`);
        }
        if (typeof rr[key] !== 'string' || rr[key].trim().length === 0) {
            throw new Error(`Runtime requirements field ${key} must be a non-empty string.`);
        }
    }

    // Required numeric fields
    for (const key of REQUIRED_RR_NUMERIC_FIELDS) {
        if (!(key in rr)) {
            throw new Error(`Runtime requirements is missing required field: ${key}`);
        }
        if (!Number.isInteger(rr[key])) {
            throw new Error(`Runtime requirements field ${key} must be an integer.`);
        }
    }

    // Required object fields
    for (const key of REQUIRED_RR_OBJECT_FIELDS) {
        if (!(key in rr)) {
            throw new Error(`Runtime requirements is missing required field: ${key}`);
        }
        if (typeof rr[key] !== 'object' || rr[key] === null || Array.isArray(rr[key])) {
            throw new Error(`Runtime requirements field ${key} must be an object.`);
        }
    }

    // Required array fields
    for (const key of REQUIRED_RR_ARRAY_FIELDS) {
        if (!(key in rr)) {
            throw new Error(`Runtime requirements is missing required field: ${key}`);
        }
        if (!Array.isArray(rr[key])) {
            throw new Error(`Runtime requirements field ${key} must be an array.`);
        }
    }

    // Schema identifier
    if (rr.schema !== SUPPORTED_RUNTIME_REQUIREMENTS_SCHEMA) {
        throw new Error(
            `Runtime requirements schema must be '${SUPPORTED_RUNTIME_REQUIREMENTS_SCHEMA}', got '${rr.schema}'.`,
        );
    }

    // Version must be 1 (only v1 supported)
    if (rr.version !== 1) {
        throw new Error(
            `Runtime requirements version must be 1, got ${rr.version}.`,
        );
    }

    // Cross-reference with manifest
    if (rr.producer !== manifest.producer) {
        throw new Error(
            `Runtime requirements producer '${rr.producer}' does not match manifest producer '${manifest.producer}'.`,
        );
    }

    if (rr.payload_profile !== manifest.payload_profile) {
        throw new Error(
            `Runtime requirements payload_profile '${rr.payload_profile}' does not match manifest payload_profile '${manifest.payload_profile}'.`,
        );
    }

    // Capabilities must be a non-empty object
    const caps = rr.capabilities;
    if (Object.keys(caps).length === 0) {
        throw new Error('Runtime requirements capabilities must not be empty.');
    }

    // Each capability must be an object with required (boolean) and description (string)
    for (const [name, value] of Object.entries(caps)) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            throw new Error(
                `Runtime requirements capability '${name}' must be an object, got ${typeof value}.`,
            );
        }
        if (typeof value.required !== 'boolean') {
            throw new Error(
                `Runtime requirements capability '${name}' must have a boolean 'required' field.`,
            );
        }
        if (typeof value.description !== 'string' || value.description.trim().length === 0) {
            throw new Error(
                `Runtime requirements capability '${name}' must have a non-empty 'description' string.`,
            );
        }
    }

    // Forbidden behaviors must be an array of non-empty strings
    const fb = rr.forbidden_behaviors;
    if (fb.length === 0) {
        throw new Error('Runtime requirements forbidden_behaviors must not be empty.');
    }
    for (let i = 0; i < fb.length; i++) {
        if (typeof fb[i] !== 'string' || fb[i].trim().length === 0) {
            throw new Error(
                `Runtime requirements forbidden_behaviors[${i}] must be a non-empty string.`,
            );
        }
    }
}
