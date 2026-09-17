import { canonicalJson, REQUIREMENTS_SCHEMA, sha256 } from './runtime-package-manifest.mjs';

export const RUNTIME_REQUIREMENTS = {
    capabilities: {
        bundled_assets_only: {
            description: 'All runtime assets must be served from the application bundle.',
            required: true,
        },
        deterministic_entrypoint: {
            description: 'The runtime entrypoint must be loaded from a deterministic package-relative path.',
            required: true,
        },
        main_frame_provenance: {
            description: 'Bridge messages and navigation must be restricted to the main document frame.',
            required: true,
        },
        no_fallback_shell_substitution: {
            description: 'The runtime must not substitute a fallback shell when the declared entrypoint is unavailable.',
            required: true,
        },
        origin_provenance: {
            description: 'Bridge messages must be restricted to the configured origin with exact host matching.',
            required: true,
        },
        persistent_storage_partition: {
            description: 'IndexedDB must persist across launches within a stable storage partition.',
            required: true,
        },
        remote_runtime_acquisition_prohibition: {
            description: 'HTML, JavaScript, workers, Python, WASM, wheels, and other runtime assets must load only from the verified bundle. Remote acquisition and CDN fallback are prohibited.',
            required: true,
        },
        secure_context: {
            description: 'The runtime must execute in a secure context.',
            required: true,
        },
        stable_origin_across_launches: {
            description: 'The document origin must be stable across app launches.',
            required: true,
        },
        wallet_service_https: {
            description: 'HTTPS wallet-service data requests must be allowed for KF boot, witnesses, watchers, account operations, and OOBIs. Responses must not be loaded or executed as runtime code.',
            required: true,
        },
        worker_availability: {
            description: 'Web Workers must be available for the Pyodide runtime.',
            required: true,
        },
    },
    forbidden_behaviors: [
        'remote_runtime_acquisition',
        'cleartext_wallet_service_traffic',
        'service_worker_registration',
        'general_purpose_browsing',
        'http_fallback',
    ],
    payload_profile: 'offline-runtime',
    producer: 'fortweb',
    schema: REQUIREMENTS_SCHEMA,
    version: 2,
};

export function serializeRuntimeRequirements() {
    const text = canonicalJson(RUNTIME_REQUIREMENTS);
    if (Buffer.byteLength(text) !== 1930 || sha256(text) !== 'ae31c57077fb24744eda3e01d53350bd9dadf9d0b8b6647d5252f837854ffdcc') {
        throw new Error('Runtime requirements bytes do not match the frozen consumer contract.');
    }
    return text;
}
