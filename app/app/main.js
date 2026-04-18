import { createRuntimeBridge } from "../runtime/bridge.js";
import {
    homeHref,
    identifiersHref,
    navigate,
    normalizeHash,
    parseRoute,
    unlockHref,
} from "./router.js";
import { createSessionStore } from "./session.js";
import { renderShell } from "./shell.js";
import {
    createVaultDrawer,
    createDialog,
    floatingInputHtml,
    setupFloatingInputs,
} from "../shared/components.js";
import { renderIdentifierDetailPage } from "../features/identifiers/identifier-detail-page.js";
import { renderIdentifiersPage } from "../features/identifiers/identifiers-page.js";
import { renderRemoteDetailPage } from "../features/remotes/remote-detail-page.js";
import { renderRemotesPage } from "../features/remotes/remotes-page.js";
import { renderSettingsPage } from "../features/settings/settings-page.js";
import { renderUnlockPage } from "../features/vaults/unlock-page.js";
import { renderVaultPickerPage } from "../features/vaults/vault-picker-page.js";
import { renderWatcherOverviewPage } from "../providers/kerifoundation/watcher-overview-page.js";
import { renderWitnessOverviewPage } from "../providers/kerifoundation/witness-overview-page.js";
import { isFixtureRoute, loadFixture } from "../fixtures/fixture-router.js";
import { renderFixtureIndexPage } from "../fixtures/fixture-index-page.js";

const METHODS = {
    vaultsList: "vaults.list",
    vaultsCreate: "vaults.create",
    vaultsOpen: "vaults.open",
    vaultsClose: "vaults.close",
    vaultsSummary: "vaults.summary",
    identifiersList: "identifiers.list",
    identifiersGet: "identifiers.get",
    identifiersCreate: "identifiers.create",
    remotesList: "remotes.list",
    remotesGet: "remotes.get",
    remotesResolveOobi: "remotes.resolveOobi",
    remotesUpdate: "remotes.update",
    settingsGet: "settings.get",
    kfBootstrapGet: "kf.bootstrap.get",
    kfOnboardingStart: "kf.onboarding.start",
    kfAccountWitnessesList: "kf.account.witnesses.list",
    kfAccountWatchersList: "kf.account.watchers.list",
    kfAccountWatchersStatus: "kf.account.watchers.status",
};

const root = document.querySelector("#app-root");
const bridge = createRuntimeBridge({
    workerUrl: new URL("../runtime/wallet-worker.py", import.meta.url),
    configUrl: new URL("../../pyscript-ci.toml", import.meta.url),
});
const session = createSessionStore({
    vaultSummary: null,
    vaults: [],
    remoteFilter: "all",
});

let drawer = null;

function currentState() {
    return session.snapshot();
}

function requireUnlockedVaultId() {
    const vaultId = currentState().unlockedVaultId;
    if (!vaultId) {
        throw new Error("Open a vault before continuing.");
    }
    return vaultId;
}

function findVault(vaultId) {
    return currentState().vaults.find((vault) => vault.id === vaultId) || null;
}

function isUnlocked(vaultId) {
    return currentState().unlockedVaultId === vaultId;
}

function decorateVaults(
    vaults,
    unlockedVaultId = currentState().unlockedVaultId,
    vaultSummary = currentState().vaultSummary,
) {
    return vaults.map((vault) => {
        const isCurrent = unlockedVaultId === vault.id;
        return {
            ...vault,
            locked: !isCurrent,
            identifierCount: isCurrent ? vaultSummary?.identifierCount ?? 0 : vault.identifierCount ?? 0,
            remoteCount: isCurrent ? vaultSummary?.remoteCount ?? 0 : vault.remoteCount ?? 0,
        };
    });
}

function rememberCoreRoute(route) {
    if (!route.params.vaultId) return;
    if (
        route.name === "identifiers" ||
        route.name === "identifier-detail" ||
        route.name === "remotes" ||
        route.name === "remote-detail" ||
        route.name === "settings"
    ) {
        session.rememberCoreRoute(route.params.vaultId, window.location.hash || identifiersHref(route.params.vaultId));
    }
}

function showCreateVaultDialog() {
    const dialog = createDialog({
        title: "Vault Initialization",
        showClose: true,
        showDivider: true,
        rootClassName: "lk-dialog-root--sheet",
        surfaceClassName: "lk-dialog--sheet",
        content: `
            <form data-create-vault-form style="display:flex;flex-direction:column;gap:16px;padding:16px 0;">
                ${floatingInputHtml({ label: "Name", name: "name" })}
                ${floatingInputHtml({ label: "Passcode", name: "passcode", password: true })}
                <p class="muted">
                    Passcode support is limited to vault reopen in this slice. Browser 2-factor authentication remains deferred.
                </p>
                <p class="status-line" data-create-vault-status></p>
            </form>
        `,
        buttons: `
            <button class="button button--secondary" type="button" data-dialog-cancel>Cancel</button>
            <button class="button button--primary" type="button" data-dialog-submit>Create</button>
        `,
        showOverlay: true,
    });

    dialog.show();
    setupFloatingInputs(dialog.el);

    const form = dialog.el.querySelector("[data-create-vault-form]");
    const statusLine = dialog.el.querySelector("[data-create-vault-status]");
    const submitBtn = dialog.el.querySelector("[data-dialog-submit]");
    const cancelBtn = dialog.el.querySelector("[data-dialog-cancel]");

    cancelBtn.addEventListener("click", () => dialog.close());

    async function submit() {
        const formData = new FormData(form);
        submitBtn.disabled = true;
        cancelBtn.disabled = true;
        statusLine.textContent = "";
        submitBtn.textContent = "Creating...";
        statusLine.textContent = "Creating vault...";

        try {
            await actions.createVault(
                String(formData.get("name") || ""),
                String(formData.get("passcode") || ""),
            );
            dialog.close();
        } catch (error) {
            submitBtn.disabled = false;
            cancelBtn.disabled = false;
            submitBtn.textContent = "Create";
            statusLine.textContent = error.message || "Vault creation failed.";
        }
    }

    submitBtn.addEventListener("click", submit);
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        submit();
    });
}

function initDrawer(vaults) {
    drawer = createVaultDrawer({
        vaults,
        onVaultClick(vault) {
            if (isUnlocked(vault.id)) {
                drawer.close();
                navigate(currentState().lastCoreRoutes[vault.id] || identifiersHref(vault.id));
                return;
            }
            navigate(unlockHref(vault.id));
        },
        onNewVault() {
            showCreateVaultDialog();
        },
    });
}

function renderNotFoundPage(path) {
    return {
        title: "Route Not Found",
        render(container) {
            container.replaceChildren();

            const section = document.createElement("section");
            section.className = "placeholder-card";

            const heading = document.createElement("h2");
            heading.textContent = "Route Not Found";

            const copy = document.createElement("p");
            copy.className = "muted";
            copy.append("No route matches ");
            const code = document.createElement("code");
            code.textContent = path;
            copy.append(code);
            copy.append(".");

            const actionsRow = document.createElement("div");
            actionsRow.className = "panel__actions";

            const link = document.createElement("a");
            link.className = "button button--primary";
            link.href = homeHref();
            link.textContent = "Back to Vaults";

            actionsRow.append(link);
            section.append(heading, copy, actionsRow);
            container.append(section);
        },
    };
}

function renderErrorPage(error) {
    return {
        title: "Runtime Error",
        render(container) {
            container.replaceChildren();

            const section = document.createElement("section");
            section.className = "placeholder-card";

            const heading = document.createElement("h2");
            heading.textContent = "Runtime Error";

            const copy = document.createElement("p");
            copy.className = "muted";
            copy.textContent = error.message || "An unexpected runtime error occurred.";

            const actionsRow = document.createElement("div");
            actionsRow.className = "panel__actions";

            const link = document.createElement("a");
            link.className = "button button--primary";
            link.href = homeHref();
            link.textContent = "Back to Vaults";

            actionsRow.append(link);
            section.append(heading, copy, actionsRow);
            container.append(section);
        },
    };
}

function renderNotFoundRoute(route, state, vault) {
    renderShell(root, {
        route: vault ? route : { ...route, shellMode: "home", navMode: "none" },
        page: renderNotFoundPage(route.path),
        state,
        vault,
        actions,
    });
}

const actions = {
    async refreshVaults(
        unlockedVaultId = currentState().unlockedVaultId,
        vaultSummary = currentState().vaultSummary,
    ) {
        const { vaults } = await bridge.request(METHODS.vaultsList);
        const decorated = decorateVaults(vaults, unlockedVaultId, vaultSummary);
        session.patch({ vaults: decorated });
        drawer?.refresh(decorated);
        return decorated;
    },

    async openVault(vaultId, passcode = "") {
        const { vault } = await bridge.request(METHODS.vaultsOpen, { vaultId, passcode });
        session.patch({
            unlockedVaultId: vaultId,
            vaultSummary: vault,
            mobileNavOpen: false,
        });
        await actions.refreshVaults(vaultId, vault);
        drawer?.close();
        navigate(currentState().lastCoreRoutes[vaultId] || identifiersHref(vaultId));
    },

    async createVault(name, passcode = "") {
        const currentVaultId = currentState().unlockedVaultId;
        const { vault } = await bridge.request(METHODS.vaultsCreate, { name, passcode });

        if (currentVaultId) {
            await bridge.request(METHODS.vaultsClose, { vaultId: currentVaultId }).catch(() => {});
        }

        session.patch({
            unlockedVaultId: null,
            vaultSummary: null,
            mobileNavOpen: false,
        });
        await actions.refreshVaults(null, null);
        navigate(unlockHref(vault.id));
        return vault;
    },

    async lockVault(vaultId) {
        if (isUnlocked(vaultId)) {
            await bridge.request(METHODS.vaultsClose, { vaultId }).catch(() => {});
        }

        session.patch({
            unlockedVaultId: null,
            vaultSummary: null,
            mobileNavOpen: false,
        });
        await actions.refreshVaults(null, null).catch(() => null);
        navigate(unlockHref(vaultId));
    },

    async createIdentifier(alias) {
        const vaultId = requireUnlockedVaultId();
        const response = await bridge.request(METHODS.identifiersCreate, { vaultId, alias });
        const { vault } = await bridge.request(METHODS.vaultsSummary, { vaultId });
        session.patch({ vaultSummary: vault });
        await actions.refreshVaults(vaultId, vault);
        await render();
        return response.identifier;
    },

    async resolveRemoteOobi(url, alias) {
        const vaultId = requireUnlockedVaultId();
        const response = await bridge.request(METHODS.remotesResolveOobi, { vaultId, url, alias });
        const { vault } = await bridge.request(METHODS.vaultsSummary, { vaultId });
        session.patch({ vaultSummary: vault });
        await actions.refreshVaults(vaultId, vault);
        await render();
        return response.remote;
    },

    async updateRemote(aid, patch) {
        const vaultId = requireUnlockedVaultId();
        const response = await bridge.request(METHODS.remotesUpdate, { vaultId, aid, patch });
        await render();
        return response.remote;
    },

    async loadKfBootstrap(bootUrl = "") {
        const vaultId = requireUnlockedVaultId();
        return bridge.request(METHODS.kfBootstrapGet, { vaultId, bootUrl });
    },

    async startKfOnboarding({ bootUrl, alias, witnessProfileCode, accountAid = "" }) {
        const vaultId = requireUnlockedVaultId();
        const response = await bridge.request(METHODS.kfOnboardingStart, {
            vaultId,
            bootUrl,
            alias,
            witnessProfileCode,
            accountAid,
        });
        await render();
        return response;
    },

    async refreshKfWatcherStatuses(watcherEids = []) {
        const vaultId = requireUnlockedVaultId();
        const refreshed = [];
        for (const watcherEid of watcherEids) {
            const { watcher } = await bridge.request(METHODS.kfAccountWatchersStatus, {
                vaultId,
                watcherEid,
            });
            refreshed.push(watcher);
        }
        await render();
        return refreshed;
    },

    setRemoteFilter(filter) {
        session.patch({ remoteFilter: filter });
        void render();
    },

    toggleNav() {
        session.patch({
            mobileNavOpen: !currentState().mobileNavOpen,
        });
        void render();
    },

    closeNav() {
        if (!currentState().mobileNavOpen) return;
        session.patch({ mobileNavOpen: false });
        void render();
    },

    async toggleDrawer() {
        if (!drawer) return;
        if (document.body.contains(drawer.el)) {
            drawer.close();
        } else {
            await actions.refreshVaults(currentState().unlockedVaultId, currentState().vaultSummary);
            drawer.open();
        }
    },
};

async function loadPage(route) {
    if (route.name === "home") {
        return {
            page: renderVaultPickerPage({
                vaults: currentState().vaults,
                onCreateVault: showCreateVaultDialog,
                onSelectVault(vault) {
                    if (isUnlocked(vault.id)) {
                        navigate(currentState().lastCoreRoutes[vault.id] || identifiersHref(vault.id));
                        return;
                    }
                    navigate(unlockHref(vault.id));
                },
            }),
            vault: null,
        };
    }

    if (route.name === "unlock") {
        return {
            page: renderUnlockPage({
                vault: findVault(route.params.vaultId),
                onOpenVault(passcode) {
                    return actions.openVault(route.params.vaultId, passcode);
                },
            }),
            vault: null,
        };
    }

    if (route.name === "identifiers") {
        const vaultId = route.params.vaultId;
        const { identifiers } = await bridge.request(METHODS.identifiersList, { vaultId });
        return {
            page: renderIdentifiersPage({
                vault: findVault(vaultId),
                identifiers,
                onCreateIdentifier: actions.createIdentifier,
            }),
            vault: findVault(vaultId),
        };
    }

    if (route.name === "identifier-detail") {
        const { identifier } = await bridge.request(METHODS.identifiersGet, {
            vaultId: route.params.vaultId,
            aid: route.params.aid,
        });
        return {
            page: renderIdentifierDetailPage({
                vault: findVault(route.params.vaultId),
                identifier,
            }),
            vault: findVault(route.params.vaultId),
        };
    }

    if (route.name === "remotes") {
        const vaultId = route.params.vaultId;
        const { remotes } = await bridge.request(METHODS.remotesList, { vaultId });
        return {
            page: renderRemotesPage({
                vault: findVault(vaultId),
                remotes,
                filter: currentState().remoteFilter,
                onResolveRemote: actions.resolveRemoteOobi,
                onUpdateRemote: actions.updateRemote,
                onFilterChange: actions.setRemoteFilter,
            }),
            vault: findVault(vaultId),
        };
    }

    if (route.name === "remote-detail") {
        const { remote } = await bridge.request(METHODS.remotesGet, {
            vaultId: route.params.vaultId,
            aid: route.params.aid,
        });
        return {
            page: renderRemoteDetailPage({
                vault: findVault(route.params.vaultId),
                remote,
            }),
            vault: findVault(route.params.vaultId),
        };
    }

    if (route.name === "settings") {
        const { settings } = await bridge.request(METHODS.settingsGet, {
            vaultId: route.params.vaultId,
        });
        return {
            page: renderSettingsPage({
                vault: findVault(route.params.vaultId),
                settings,
            }),
            vault: findVault(route.params.vaultId),
        };
    }

    if (route.name === "kf-witnesses") {
        const vaultId = route.params.vaultId;
        const bootstrapState = await bridge.request(METHODS.kfBootstrapGet, { vaultId });
        let witnesses = [];
        let witnessError = "";
        if (bootstrapState.account?.status === "onboarded") {
            try {
                ({ witnesses } = await bridge.request(METHODS.kfAccountWitnessesList, { vaultId }));
            } catch (error) {
                witnessError = error.message || "Failed to load hosted witness rows.";
            }
        }
        return {
            page: renderWitnessOverviewPage({
                vault: findVault(vaultId),
                bootstrapState,
                witnesses,
                witnessError,
                onLoadBootstrap: actions.loadKfBootstrap,
                onStartOnboarding: actions.startKfOnboarding,
            }),
            vault: findVault(vaultId),
        };
    }

    if (route.name === "kf-watchers") {
        const vaultId = route.params.vaultId;
        const bootstrapState = await bridge.request(METHODS.kfBootstrapGet, { vaultId });
        let watchers = [];
        let watcherError = "";
        if (bootstrapState.account?.status === "onboarded") {
            try {
                ({ watchers } = await bridge.request(METHODS.kfAccountWatchersList, { vaultId }));
            } catch (error) {
                watcherError = error.message || "Failed to load hosted watcher rows.";
            }
        }
        return {
            page: renderWatcherOverviewPage({
                vault: findVault(vaultId),
                bootstrapState,
                watchers,
                watcherError,
                onRefreshStatuses() {
                    return actions.refreshKfWatcherStatuses(watchers.map((watcher) => watcher.eid));
                },
            }),
            vault: findVault(vaultId),
        };
    }

    return {
        page: renderNotFoundPage(route.path),
        vault: null,
    };
}

/** Incremented on every render(); stale renders bail so tab taps do not stack concurrent bridge calls. */
let renderGeneration = 0;

async function render() {
    const thisGeneration = ++renderGeneration;
    const path = normalizeHash();

    if (path === "/_fixtures" || path === "/_fixtures/") {
        const indexRoute = { name: "fixture-index", shellMode: "home", navMode: "none", path, params: {} };
        renderShell(root, { route: indexRoute, page: renderFixtureIndexPage(), state: currentState(), vault: null, actions });
        return;
    }

    if (isFixtureRoute(path)) {
        const fixture = loadFixture(path);
        if (fixture) {
            renderShell(root, { route: fixture.route, page: fixture.page, state: currentState(), vault: fixture.vault, actions });
        } else {
            const fallbackRoute = { name: "not-found", shellMode: "home", navMode: "none", path, params: {} };
            renderNotFoundRoute(fallbackRoute, currentState(), null);
        }
        return;
    }

    const route = parseRoute();
    const state = currentState();
    const vault = route.requiresVault ? findVault(route.params.vaultId) : null;

    if (route.name !== "home" && route.requiresVault && !vault) {
        renderNotFoundRoute(route, state, null);
        return;
    }

    if (route.name === "unlock" && isUnlocked(route.params.vaultId)) {
        navigate(currentState().lastCoreRoutes[route.params.vaultId] || identifiersHref(route.params.vaultId));
        return;
    }

    if (route.requiresUnlock && !isUnlocked(route.params.vaultId)) {
        navigate(unlockHref(route.params.vaultId));
        return;
    }

    rememberCoreRoute(route);

    try {
        if (thisGeneration !== renderGeneration) {
            return;
        }
        const { page, vault: loadedVault } = await loadPage(route);
        if (thisGeneration !== renderGeneration) {
            return;
        }
        renderShell(root, {
            route,
            page,
            state: currentState(),
            vault: loadedVault,
            actions,
        });
    } catch (error) {
        if (thisGeneration !== renderGeneration) {
            return;
        }
        if (error?.code === "NOT_FOUND") {
            renderNotFoundRoute(route, currentState(), vault);
            return;
        }
        if ((error?.code === "LOCKED" || error?.code === "TIMEOUT") && route.params?.vaultId) {
            session.patch({
                unlockedVaultId: null,
                vaultSummary: null,
                mobileNavOpen: false,
            });
            await actions.refreshVaults(null, null).catch(() => null);
            if (thisGeneration !== renderGeneration) {
                return;
            }
            navigate(unlockHref(route.params.vaultId));
            return;
        }

        renderShell(root, {
            route: route.shellMode ? route : { ...route, shellMode: "home", navMode: "none" },
            page: renderErrorPage(error),
            state: currentState(),
            vault,
            actions,
        });
    }
}

window.addEventListener("hashchange", () => {
    session.patch({ mobileNavOpen: false });
    void render();
});

window.addEventListener("beforeunload", () => {
    bridge.destroy();
});

async function bootstrap() {
    await actions.refreshVaults();
    initDrawer(currentState().vaults);
    await render();
}

void bootstrap();
