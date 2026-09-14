/**
 * Runtime requirements contract generator.
 *
 * Generates `contracts/runtime-requirements.json` — a platform-neutral
 * declaration of semantic capabilities every wrapper must satisfy.
 *
 * Governance: mobile-workflow-governance.instructions.md §10.1
 * Manifest discovery: §10.7 (TYPED_REFERENCE_WITH_CONVENTIONAL_PATH)
 *
 * Deferred decisions:
 * - Formal JSON Schema draft
 * - Detailed version-evolution mechanics
 */

/**
 * Generate the runtime-requirements JSON content.
 *
 * @returns {object} requirements object
 */
export function generateRuntimeRequirements() {
    return {
        schema: 'fort.runtime-requirements.v1',
        version: 1,
        producer: 'fortweb',
        payload_profile: 'offline-runtime',
        capabilities: {
            stable_origin_across_launches: {
                required: true,
                description:
                    'The document origin must be stable across app launches.',
            },
            persistent_storage_partition: {
                required: true,
                description:
                    'IndexedDB must persist across launches within a stable storage partition.',
            },
            secure_context: {
                required: true,
                description:
                    'The runtime must execute in a secure context.',
            },
            remote_network_prohibition: {
                required: true,
                description:
                    'General network access must be prohibited. Only bundled assets may be loaded.',
            },
            bundled_assets_only: {
                required: true,
                description:
                    'All runtime assets must be served from the application bundle.',
            },
            worker_availability: {
                required: true,
                description:
                    'Web Workers must be available for the Pyodide runtime.',
            },
            main_frame_provenance: {
                required: true,
                description:
                    'Bridge messages and navigation must be restricted to the main document frame.',
            },
            origin_provenance: {
                required: true,
                description:
                    'Bridge messages must be restricted to the configured origin with exact host matching.',
            },
            deterministic_entrypoint: {
                required: true,
                description:
                    'The runtime entrypoint must be loaded from a deterministic package-relative path.',
            },
            no_fallback_shell_substitution: {
                required: true,
                description:
                    'The runtime must not substitute a fallback shell when the declared entrypoint is unavailable.',
            },
        },
        forbidden_behaviors: [
            'network_fetch',
            'service_worker_registration',
            'general_purpose_browsing',
            'localhost_or_loopback_origin',
            'http_fallback',
        ],
    };
}

/**
 * Serialize the requirements object to deterministic UTF-8 JSON.
 * Line endings are LF (\\n). Trailing newline is present.
 *
 * @param {object} requirements
 * @returns {string}
 */
export function serializeRuntimeRequirements(requirements) {
    return JSON.stringify(requirements, null, 2) + '\n';
}
