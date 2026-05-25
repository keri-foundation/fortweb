import { createRuntimeBridge } from "../runtime/bridge.js";
import { identifiersHref, navigate, normalizeHash, parseRoute, unlockHref, } from "./router.js";
import { renderErrorPage, renderNotFoundRoute } from "./page-feedback.js";
import { loadPage } from "./page-factory.js";
import { createSessionStore } from "./session.js";
import { renderShell } from "./shell.js";
import { createVaultDrawer, createDialog, floatingInputHtml, setupFloatingInputs, } from "../shared/components.js";
import { isFixtureRoute, loadFixture } from "../fixtures/fixture-router.js";
import { renderFixtureIndexPage } from "../fixtures/fixture-index-page.js";
import { installGlobalHandlers } from "../runtime/global-handlers.js";
import { METHODS } from "../runtime/method-catalog.js";
import { postLog } from "../runtime/logger.js";
import { describeRuntimeOriginContract, readWindowRuntimeOriginContract, RuntimeOriginContractError, } from "../runtime/origin-contract.js";
function assumeType(value) {
    return value;
}
function errorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
        return error.message;
    }
    return String(error);
}
function errorCode(error) {
    if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
        return error.code;
    }
    return "";
}
const rootNode = document.querySelector("#app-root");
if (!(rootNode instanceof HTMLElement)) {
    throw new Error("Expected #app-root host element.");
}
const root = rootNode;
function readRuntimeOriginContractOrRenderStartupError() {
    try {
        return readWindowRuntimeOriginContract();
    }
    catch (error) {
        const message = error instanceof RuntimeOriginContractError
            ? error.message
            : "Runtime origin contract was invalid.";
        postLog("runtime_origin_contract_invalid", {
            level: "error",
            message,
        });
        renderErrorPage({ message }).render?.(root);
        throw error;
    }
}
const runtimeOriginContract = readRuntimeOriginContractOrRenderStartupError();
if (runtimeOriginContract) {
    postLog("runtime_origin_contract_present", describeRuntimeOriginContract(runtimeOriginContract));
}
else {
    postLog("runtime_origin_contract_missing", {
        level: "info",
        fallback: "browser_defaults",
    });
}
const bridge = createRuntimeBridge({
    workerUrl: runtimeOriginContract?.workerUrl ?? new URL("../runtime/wallet-worker.py", import.meta.url),
    configUrl: runtimeOriginContract?.configUrl ?? new URL("../../pyscript-ci.toml", import.meta.url),
    runtimeOriginContract,
});
const session = createSessionStore({
    vaultSummary: null,
    vaults: [],
    remoteFilter: "all",
});
let drawer = null;
let actions;
function currentState() {
    return assumeType(session.snapshot());
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
function decorateVaults(vaults, unlockedVaultId = currentState().unlockedVaultId, vaultSummary = currentState().vaultSummary) {
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
    const vaultId = route.params.vaultId;
    if (!vaultId) {
        return;
    }
    if (route.name === "identifiers" ||
        route.name === "identifier-detail" ||
        route.name === "remotes" ||
        route.name === "remote-detail" ||
        route.name === "settings") {
        session.rememberCoreRoute(vaultId, window.location.hash || identifiersHref(vaultId));
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
    const formNode = dialog.el.querySelector("[data-create-vault-form]");
    const statusLineNode = dialog.el.querySelector("[data-create-vault-status]");
    const submitBtnNode = dialog.el.querySelector("[data-dialog-submit]");
    const cancelBtnNode = dialog.el.querySelector("[data-dialog-cancel]");
    if (!(formNode instanceof HTMLFormElement)) {
        throw new Error("Create vault form is missing.");
    }
    if (!(statusLineNode instanceof HTMLElement)) {
        throw new Error("Create vault status line is missing.");
    }
    if (!(submitBtnNode instanceof HTMLButtonElement) || !(cancelBtnNode instanceof HTMLButtonElement)) {
        throw new Error("Create vault buttons are missing.");
    }
    const form = formNode;
    const statusLine = statusLineNode;
    const submitBtn = submitBtnNode;
    const cancelBtn = cancelBtnNode;
    cancelBtn.addEventListener("click", () => dialog.close());
    async function submit() {
        const formData = new FormData(form);
        submitBtn.disabled = true;
        cancelBtn.disabled = true;
        statusLine.textContent = "";
        submitBtn.textContent = "Creating...";
        statusLine.textContent = "Creating vault...";
        try {
            await actions.createVault(String(formData.get("name") || ""), String(formData.get("passcode") || ""));
            dialog.close();
        }
        catch (error) {
            submitBtn.disabled = false;
            cancelBtn.disabled = false;
            submitBtn.textContent = "Create";
            statusLine.textContent = errorMessage(error) || "Vault creation failed.";
        }
    }
    submitBtn.addEventListener("click", () => {
        void submit();
    });
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        void submit();
    });
}
function initDrawer(vaults) {
    drawer = createVaultDrawer({
        vaults,
        onVaultClick(vault) {
            if (isUnlocked(vault.id)) {
                drawer?.close();
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
actions = {
    async refreshVaults(unlockedVaultId = currentState().unlockedVaultId, vaultSummary = currentState().vaultSummary) {
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
            vaultSummary: assumeType(vault),
            mobileNavOpen: false,
        });
        await actions.refreshVaults(vaultId, assumeType(vault));
        drawer?.close();
        navigate(currentState().lastCoreRoutes[vaultId] || identifiersHref(vaultId));
        return vault;
    },
    async createVault(name, passcode = "") {
        const currentVaultId = currentState().unlockedVaultId;
        const { vault } = await bridge.request(METHODS.vaultsCreate, { name, passcode });
        if (currentVaultId) {
            await bridge.request(METHODS.vaultsClose, { vaultId: currentVaultId }).catch(() => { });
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
            await bridge.request(METHODS.vaultsClose, { vaultId }).catch(() => { });
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
        await bridge.request(METHODS.identifiersCreate, { vaultId, alias });
        const { vault } = await bridge.request(METHODS.vaultsSummary, { vaultId });
        session.patch({ vaultSummary: vault });
        await actions.refreshVaults(vaultId, vault);
        await render();
    },
    async resolveRemoteOobi(url, alias) {
        const vaultId = requireUnlockedVaultId();
        await bridge.request(METHODS.remotesResolveOobi, { vaultId, url, alias });
        const { vault } = await bridge.request(METHODS.vaultsSummary, { vaultId });
        session.patch({ vaultSummary: vault });
        await actions.refreshVaults(vaultId, vault);
        await render();
    },
    async updateRemote(aid, patch) {
        const vaultId = requireUnlockedVaultId();
        await bridge.request(METHODS.remotesUpdate, { vaultId, aid, patch });
        await render();
    },
    async loadKfBootstrap(bootUrl = "") {
        const vaultId = requireUnlockedVaultId();
        return assumeType(await bridge.request(METHODS.kfBootstrapGet, { vaultId, bootUrl }));
    },
    async startKfOnboarding({ bootUrl, alias, witnessProfileCode, accountAid = "" }) {
        const vaultId = requireUnlockedVaultId();
        await bridge.request(METHODS.kfOnboardingStart, {
            vaultId,
            bootUrl,
            alias,
            witnessProfileCode,
            accountAid,
        });
        await render();
    },
    async refreshKfWatcherStatuses(watcherEids = []) {
        const vaultId = requireUnlockedVaultId();
        for (const watcherEid of watcherEids) {
            await bridge.request(METHODS.kfAccountWatchersStatus, {
                vaultId,
                watcherEid,
            });
        }
        await render();
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
        if (!currentState().mobileNavOpen) {
            return;
        }
        session.patch({ mobileNavOpen: false });
        void render();
    },
    async toggleDrawer() {
        if (!drawer) {
            return;
        }
        if (document.body.contains(drawer.el)) {
            drawer.close();
        }
        else {
            await actions.refreshVaults(currentState().unlockedVaultId, currentState().vaultSummary);
            drawer.open();
        }
    },
};
/** Incremented on every render(); stale renders bail so tab taps do not stack concurrent bridge calls. */
let renderGeneration = 0;
async function render() {
    const thisGeneration = ++renderGeneration;
    const path = normalizeHash();
    if (path === "/_fixtures" || path === "/_fixtures/") {
        const indexRoute = { name: "fixture-index", shellMode: "home", navMode: "none", path, params: {} };
        renderShell(root, {
            route: indexRoute,
            page: renderFixtureIndexPage(),
            state: currentState(),
            vault: null,
            actions,
        });
        return;
    }
    if (isFixtureRoute(path)) {
        const fixture = loadFixture(path);
        if (fixture) {
            renderShell(root, {
                route: fixture.route,
                page: fixture.page,
                state: currentState(),
                vault: assumeType(fixture.vault),
                actions,
            });
        }
        else {
            const fallbackRoute = { name: "not-found", shellMode: "home", navMode: "none", path, params: {} };
            renderNotFoundRoute({ root, route: fallbackRoute, state: currentState(), vault: null, actions });
        }
        return;
    }
    const route = parseRoute();
    const state = currentState();
    const vault = route.requiresVault ? findVault(route.params.vaultId) : null;
    if (route.name !== "home" && route.requiresVault && !vault) {
        renderNotFoundRoute({ root, route, state, vault: null, actions });
        return;
    }
    const vaultId = route.params.vaultId;
    if (route.name === "unlock" && vaultId && isUnlocked(vaultId)) {
        navigate(currentState().lastCoreRoutes[vaultId] || identifiersHref(vaultId));
        return;
    }
    if (route.requiresUnlock && vaultId && !isUnlocked(vaultId)) {
        navigate(unlockHref(vaultId));
        return;
    }
    rememberCoreRoute(route);
    try {
        if (thisGeneration !== renderGeneration) {
            return;
        }
        const { page, vault: loadedVault } = await loadPage({
            route,
            bridge,
            currentState,
            findVault(vaultId) {
                return assumeType(findVault(vaultId));
            },
            isUnlocked,
            showCreateVaultDialog,
            actions,
        });
        if (thisGeneration !== renderGeneration) {
            return;
        }
        renderShell(root, {
            route,
            page,
            state: currentState(),
            vault: assumeType(loadedVault),
            actions,
        });
    }
    catch (error) {
        if (thisGeneration !== renderGeneration) {
            return;
        }
        postLog("render_error", {
            level: "error",
            code: errorCode(error),
            message: errorMessage(error),
            route: route.name,
            path: route.path,
        });
        const code = errorCode(error);
        if (code === "NOT_FOUND") {
            renderNotFoundRoute({ root, route, state: currentState(), vault: assumeType(vault), actions });
            return;
        }
        if ((code === "LOCKED" || code === "TIMEOUT") && route.params.vaultId) {
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
            route: route.shellMode ? route : { ...route, shellMode: "home" },
            page: renderErrorPage(assumeType(error)),
            state: currentState(),
            vault: assumeType(vault),
            actions,
        });
    }
}
window.addEventListener("hashchange", () => {
    postLog("route_change", { path: normalizeHash() });
    session.patch({ mobileNavOpen: false });
    void render();
});
window.addEventListener("beforeunload", () => {
    bridge.destroy();
});
async function bootstrap() {
    installGlobalHandlers();
    await actions.refreshVaults();
    initDrawer(currentState().vaults);
    await render();
}
void bootstrap();
