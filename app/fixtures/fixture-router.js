/**
 * Fixture route handler for deterministic screenshot states.
 *
 * Fixture routes use the pattern: #/_fixtures/<page>/<variant>
 * They bypass the wallet runtime and render pages with mock data,
 * making every screen state reachable by URL alone.
 *
 * @module fixtures/fixture-router
 */

import { renderVaultPickerPage } from "../features/vaults/vault-picker-page.js";
import { renderUnlockPage } from "../features/vaults/unlock-page.js";
import { renderIdentifiersPage } from "../features/identifiers/identifiers-page.js";
import { renderIdentifierDetailPage } from "../features/identifiers/identifier-detail-page.js";
import { renderRemotesPage } from "../features/remotes/remotes-page.js";
import { renderRemoteDetailPage } from "../features/remotes/remote-detail-page.js";
import { renderSettingsPage } from "../features/settings/settings-page.js";
import { renderWitnessOverviewPage } from "../providers/kerifoundation/witness-overview-page.js";
import { renderWatcherOverviewPage } from "../providers/kerifoundation/watcher-overview-page.js";

import {
    fixtureVault,
    fixtureVaultLocked,
    fixtureVaults,
    fixtureIdentifiers,
    fixtureRemotes,
    fixtureSettings,
    fixtureBootstrapDisconnected,
    fixtureBootstrapConnected,
    fixtureBootstrapOnboarded,
    fixtureWitnesses,
    fixtureWatchers,
    FIXTURE_VAULT_ID_CONST,
} from "./data.js";

const noop = () => {};
const asyncNoop = async () => {};

/** @type {Object<string, function(): {page: Object, vault: Object|null, route: Object}>} */
const FIXTURES = {
    "vaults/empty": () => ({
        page: renderVaultPickerPage({ vaults: [], onCreateVault: noop, onSelectVault: noop }),
        vault: null,
        route: { name: "home", shellMode: "home", navMode: "none", path: "/_fixtures/vaults/empty", params: {} },
    }),

    "vaults/populated": () => ({
        page: renderVaultPickerPage({ vaults: fixtureVaults, onCreateVault: noop, onSelectVault: noop }),
        vault: null,
        route: { name: "home", shellMode: "home", navMode: "none", path: "/_fixtures/vaults/populated", params: {} },
    }),

    "unlock": () => ({
        page: renderUnlockPage({ vault: fixtureVaultLocked, onOpenVault: asyncNoop }),
        vault: null,
        route: { name: "unlock", shellMode: "home", navMode: "none", path: "/_fixtures/unlock", params: { vaultId: FIXTURE_VAULT_ID_CONST } },
    }),

    "identifiers/empty": () => ({
        page: renderIdentifiersPage({ vault: fixtureVault, identifiers: [], onCreateIdentifier: asyncNoop }),
        vault: fixtureVault,
        route: { name: "identifiers", shellMode: "vault", navMode: "core", path: "/_fixtures/identifiers/empty", params: { vaultId: FIXTURE_VAULT_ID_CONST } },
    }),

    "identifiers/populated": () => ({
        page: renderIdentifiersPage({ vault: fixtureVault, identifiers: fixtureIdentifiers, onCreateIdentifier: asyncNoop }),
        vault: fixtureVault,
        route: { name: "identifiers", shellMode: "vault", navMode: "core", path: "/_fixtures/identifiers/populated", params: { vaultId: FIXTURE_VAULT_ID_CONST } },
    }),

    "identifier-detail": () => ({
        page: renderIdentifierDetailPage({ vault: fixtureVault, identifier: fixtureIdentifiers[0] }),
        vault: fixtureVault,
        route: { name: "identifier-detail", shellMode: "vault", navMode: "core", path: "/_fixtures/identifier-detail", params: { vaultId: FIXTURE_VAULT_ID_CONST, aid: fixtureIdentifiers[0].aid } },
    }),

    "remotes/empty": () => ({
        page: renderRemotesPage({ vault: fixtureVault, remotes: [], filter: "all", onResolveRemote: asyncNoop, onUpdateRemote: asyncNoop, onFilterChange: noop }),
        vault: fixtureVault,
        route: { name: "remotes", shellMode: "vault", navMode: "core", path: "/_fixtures/remotes/empty", params: { vaultId: FIXTURE_VAULT_ID_CONST } },
    }),

    "remotes/populated": () => ({
        page: renderRemotesPage({ vault: fixtureVault, remotes: fixtureRemotes, filter: "all", onResolveRemote: asyncNoop, onUpdateRemote: asyncNoop, onFilterChange: noop }),
        vault: fixtureVault,
        route: { name: "remotes", shellMode: "vault", navMode: "core", path: "/_fixtures/remotes/populated", params: { vaultId: FIXTURE_VAULT_ID_CONST } },
    }),

    "remote-detail": () => ({
        page: renderRemoteDetailPage({ vault: fixtureVault, remote: fixtureRemotes[0] }),
        vault: fixtureVault,
        route: { name: "remote-detail", shellMode: "vault", navMode: "core", path: "/_fixtures/remote-detail", params: { vaultId: FIXTURE_VAULT_ID_CONST, aid: fixtureRemotes[0].aid } },
    }),

    "witnesses/disconnected": () => ({
        page: renderWitnessOverviewPage({ vault: fixtureVault, bootstrapState: fixtureBootstrapDisconnected, witnesses: [], witnessError: "", onLoadBootstrap: asyncNoop, onStartOnboarding: asyncNoop }),
        vault: fixtureVault,
        route: { name: "kf-witnesses", shellMode: "vault", navMode: "plugin", path: "/_fixtures/witnesses/disconnected", params: { vaultId: FIXTURE_VAULT_ID_CONST } },
    }),

    "witnesses/connected": () => ({
        page: renderWitnessOverviewPage({ vault: fixtureVault, bootstrapState: fixtureBootstrapConnected, witnesses: [], witnessError: "", onLoadBootstrap: asyncNoop, onStartOnboarding: asyncNoop }),
        vault: fixtureVault,
        route: { name: "kf-witnesses", shellMode: "vault", navMode: "plugin", path: "/_fixtures/witnesses/connected", params: { vaultId: FIXTURE_VAULT_ID_CONST } },
    }),

    "witnesses/account": () => ({
        page: renderWitnessOverviewPage({ vault: fixtureVault, bootstrapState: fixtureBootstrapOnboarded, witnesses: fixtureWitnesses, witnessError: "", onLoadBootstrap: asyncNoop, onStartOnboarding: asyncNoop }),
        vault: fixtureVault,
        route: { name: "kf-witnesses", shellMode: "vault", navMode: "plugin", path: "/_fixtures/witnesses/account", params: { vaultId: FIXTURE_VAULT_ID_CONST } },
    }),

    "witnesses/error": () => ({
        page: renderWitnessOverviewPage({ vault: fixtureVault, bootstrapState: fixtureBootstrapOnboarded, witnesses: [], witnessError: "Failed to load hosted witness rows. The boot service returned HTTP 503.", onLoadBootstrap: asyncNoop, onStartOnboarding: asyncNoop }),
        vault: fixtureVault,
        route: { name: "kf-witnesses", shellMode: "vault", navMode: "plugin", path: "/_fixtures/witnesses/error", params: { vaultId: FIXTURE_VAULT_ID_CONST } },
    }),

    "watchers/placeholder": () => ({
        page: renderWatcherOverviewPage({ vault: fixtureVault, bootstrapState: fixtureBootstrapDisconnected, watchers: [], watcherError: "", onRefreshStatuses: asyncNoop }),
        vault: fixtureVault,
        route: { name: "kf-watchers", shellMode: "vault", navMode: "plugin", path: "/_fixtures/watchers/placeholder", params: { vaultId: FIXTURE_VAULT_ID_CONST } },
    }),

    "watchers/populated": () => ({
        page: renderWatcherOverviewPage({ vault: fixtureVault, bootstrapState: fixtureBootstrapOnboarded, watchers: fixtureWatchers, watcherError: "", onRefreshStatuses: asyncNoop }),
        vault: fixtureVault,
        route: { name: "kf-watchers", shellMode: "vault", navMode: "plugin", path: "/_fixtures/watchers/populated", params: { vaultId: FIXTURE_VAULT_ID_CONST } },
    }),

    "settings": () => ({
        page: renderSettingsPage({ vault: fixtureVault, settings: fixtureSettings }),
        vault: fixtureVault,
        route: { name: "settings", shellMode: "vault", navMode: "core", path: "/_fixtures/settings", params: { vaultId: FIXTURE_VAULT_ID_CONST } },
    }),
};

/**
 * Check whether the current hash is a fixture route.
 *
 * @param {string} path - normalized hash path
 * @returns {boolean}
 */
export function isFixtureRoute(path) {
    return path.startsWith("/_fixtures/");
}

/**
 * Load a fixture page by path.
 *
 * @param {string} path - normalized hash path (e.g. "/_fixtures/vaults/empty")
 * @returns {{ page: Object, vault: Object|null, route: Object } | null}
 */
export function loadFixture(path) {
    const key = path.replace(/^\/_fixtures\//, "");
    const factory = FIXTURES[key];
    return factory ? factory() : null;
}

/**
 * Get the list of all registered fixture keys for index/listing purposes.
 *
 * @returns {string[]}
 */
export function listFixtureKeys() {
    return Object.keys(FIXTURES);
}
