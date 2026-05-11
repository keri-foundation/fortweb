import { createRuntimeBridge } from "../runtime/bridge.js";
import {
    homeHref,
    identifiersHref,
    kfHomeHref,
    kfWitnessesHref,
    navigate,
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
import { resolveKfSurfaceConfig } from "../providers/kerifoundation/config.js";
import { renderKfIdentifiersPage } from "../providers/kerifoundation/identifiers-page.js";
import { renderWatcherOverviewPage } from "../providers/kerifoundation/watcher-overview-page.js";
import {
    renderKfSetupPage,
    renderKfWitnessesPage,
} from "../providers/kerifoundation/witness-overview-page.js";

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

function kfSurfaceConfig() {
    return resolveKfSurfaceConfig(window.location.origin);
}

function isKfOnboarded(bootstrapState) {
    return bootstrapState.account?.status === "onboarded";
}

async function loadKfBootstrapState(vaultId, surfaceConfig) {
    return bridge.request(METHODS.kfBootstrapGet, {
        vaultId,
        surfaceConfig,
    });
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
        content: `
            <form data-create-vault-form style="display:flex;flex-direction:column;gap:16px;padding:16px 0;">
                ${floatingInputHtml({ label: "Name", name: "name" })}
                ${floatingInputHtml({ label: "Passcode", name: "passcode", password: true })}
                <p class="status-line" data-create-vault-status></p>
            </form>
        `,
        buttons: `
            <button class="button button--secondary" type="button" data-dialog-cancel>Cancel</button>
            <button class="button button--primary" type="button" data-dialog-submit>Create</button>
        `,
        showOverlay: false,
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
        statusLine.textContent = "";

        try {
            await actions.createVault(
                String(formData.get("name") || ""),
                String(formData.get("passcode") || ""),
            );
            dialog.close();
            drawer?.close();
        } catch (error) {
            submitBtn.disabled = false;
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
            await bridge.request(METHODS.vaultsClose, { vaultId });
        }

        session.patch({
            unlockedVaultId: null,
            vaultSummary: null,
            mobileNavOpen: false,
        });
        await actions.refreshVaults(null, null);
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

    async loadKfBootstrap() {
        const vaultId = requireUnlockedVaultId();
        return bridge.request(METHODS.kfBootstrapGet, {
            vaultId,
            surfaceConfig: kfSurfaceConfig(),
        });
    },

    async startKfOnboarding({ alias, witnessProfileCode, accountAid = "" }) {
        const vaultId = requireUnlockedVaultId();
        return bridge.request(METHODS.kfOnboardingStart, {
            vaultId,
            surfaceConfig: kfSurfaceConfig(),
            alias,
            witnessProfileCode,
            accountAid,
        }, 120_000);
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

    if (route.name === "kf-home") {
        const vaultId = route.params.vaultId;
        const surfaceConfig = kfSurfaceConfig();
        const { identifiers } = await bridge.request(METHODS.identifiersList, { vaultId });
        const bootstrapState = await loadKfBootstrapState(vaultId, surfaceConfig);
        if (isKfOnboarded(bootstrapState)) {
            return {
                redirectHref: kfWitnessesHref(vaultId),
                vault: findVault(vaultId),
            };
        }
        return {
            page: renderKfSetupPage({
                vault: findVault(vaultId),
                bootstrapState,
                identifiers,
                onLoadBootstrap: actions.loadKfBootstrap,
                onStartOnboarding: actions.startKfOnboarding,
                onCompleteOnboarding() {
                    navigate(kfWitnessesHref(vaultId));
                },
            }),
            vault: findVault(vaultId),
        };
    }

    if (route.name === "kf-identifiers") {
        const vaultId = route.params.vaultId;
        const { identifiers } = await bridge.request(METHODS.identifiersList, { vaultId });
        const bootstrapState = await loadKfBootstrapState(vaultId, kfSurfaceConfig());
        if (!isKfOnboarded(bootstrapState)) {
            return {
                redirectHref: kfHomeHref(vaultId),
                vault: findVault(vaultId),
            };
        }
        return {
            page: renderKfIdentifiersPage({
                bootstrapState,
                identifiers,
            }),
            vault: findVault(vaultId),
        };
    }

    if (route.name === "kf-witnesses") {
        const vaultId = route.params.vaultId;
        const surfaceConfig = kfSurfaceConfig();
        const bootstrapState = await loadKfBootstrapState(vaultId, surfaceConfig);
        if (!isKfOnboarded(bootstrapState)) {
            return {
                redirectHref: kfHomeHref(vaultId),
                vault: findVault(vaultId),
            };
        }
        let witnesses = [];
        let witnessError = "";
        try {
            ({ witnesses } = await bridge.request(METHODS.kfAccountWitnessesList, {
                vaultId,
                surfaceConfig,
            }));
        } catch (error) {
            witnessError = error.message || "Failed to load hosted witness rows.";
        }
        return {
            page: renderKfWitnessesPage({
                vault: findVault(vaultId),
                bootstrapState,
                witnesses,
                witnessError,
            }),
            vault: findVault(vaultId),
        };
    }

    if (route.name === "kf-watchers") {
        const vaultId = route.params.vaultId;
        const surfaceConfig = kfSurfaceConfig();
        const bootstrapState = await loadKfBootstrapState(vaultId, surfaceConfig);
        if (!isKfOnboarded(bootstrapState)) {
            return {
                redirectHref: kfHomeHref(vaultId),
                vault: findVault(vaultId),
            };
        }
        let watchers = [];
        let watcherError = "";
        try {
            ({ watchers } = await bridge.request(METHODS.kfAccountWatchersList, {
                vaultId,
                surfaceConfig,
            }));
        } catch (error) {
            watcherError = error.message || "Failed to load hosted watcher rows.";
        }
        return {
            page: renderWatcherOverviewPage({
                vault: findVault(vaultId),
                bootstrapState,
                watchers,
                watcherError,
            }),
            vault: findVault(vaultId),
        };
    }

    return {
        page: renderNotFoundPage(route.path),
        vault: null,
    };
}

async function render() {
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
        const { page, vault: loadedVault, redirectHref } = await loadPage(route);
        if (redirectHref) {
            navigate(redirectHref);
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
        if (error?.code === "NOT_FOUND") {
            renderNotFoundRoute(route, currentState(), vault);
            return;
        }
        if (error?.code === "LOCKED" && route.params?.vaultId) {
            session.patch({
                unlockedVaultId: null,
                vaultSummary: null,
                mobileNavOpen: false,
            });
            await actions.refreshVaults(null, null).catch(() => null);
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
