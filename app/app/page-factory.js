import { identifiersHref, navigate, unlockHref } from "./router.js";
import { loadRouteData } from "./page-loader.js";
import { renderIdentifierDetailPage } from "../features/identifiers/identifier-detail-page.js";
import { renderIdentifiersPage } from "../features/identifiers/identifiers-page.js";
import { renderRemoteDetailPage } from "../features/remotes/remote-detail-page.js";
import { renderRemotesPage } from "../features/remotes/remotes-page.js";
import { renderSettingsPage } from "../features/settings/settings-page.js";
import { renderUnlockPage } from "../features/vaults/unlock-page.js";
import { renderVaultPickerPage } from "../features/vaults/vault-picker-page.js";
import { renderWatcherOverviewPage } from "../providers/kerifoundation/watcher-overview-page.js";
import { renderWitnessOverviewPage } from "../providers/kerifoundation/witness-overview-page.js";
function assumeType(value) {
    return value;
}
function notFoundPage(path) {
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
            link.href = "#/";
            link.textContent = "Back to Vaults";
            actionsRow.append(link);
            section.append(heading, copy, actionsRow);
            container.append(section);
        },
    };
}
export async function loadPage({ actions, bridge, currentState, findVault, isUnlocked, route, showCreateVaultDialog, }) {
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
                vault: assumeType(findVault(route.params.vaultId)),
                async onOpenVault(passcode) {
                    await actions.openVault(route.params.vaultId ?? "", passcode);
                },
            }),
            vault: null,
        };
    }
    const pageData = await loadRouteData({ route, bridge });
    if (route.name === "identifiers") {
        const vaultId = route.params.vaultId ?? "";
        return {
            page: renderIdentifiersPage({
                vault: assumeType(findVault(vaultId)),
                identifiers: assumeType(pageData.identifiers || []),
                async onCreateIdentifier(alias) {
                    await actions.createIdentifier(alias);
                },
            }),
            vault: findVault(vaultId),
        };
    }
    if (route.name === "identifier-detail") {
        return {
            page: renderIdentifierDetailPage({
                vault: assumeType(findVault(route.params.vaultId)),
                identifier: assumeType(pageData.identifier),
            }),
            vault: findVault(route.params.vaultId),
        };
    }
    if (route.name === "remotes") {
        const vaultId = route.params.vaultId ?? "";
        return {
            page: renderRemotesPage({
                vault: assumeType(findVault(vaultId)),
                remotes: assumeType(pageData.remotes || []),
                filter: currentState().remoteFilter,
                async onResolveRemote(url, alias) {
                    await actions.resolveRemoteOobi(url, alias);
                },
                async onUpdateRemote(aid, patch) {
                    await actions.updateRemote(aid, patch);
                },
                onFilterChange: actions.setRemoteFilter,
            }),
            vault: findVault(vaultId),
        };
    }
    if (route.name === "remote-detail") {
        return {
            page: renderRemoteDetailPage({
                vault: assumeType(findVault(route.params.vaultId)),
                remote: assumeType(pageData.remote),
            }),
            vault: findVault(route.params.vaultId),
        };
    }
    if (route.name === "settings") {
        return {
            page: renderSettingsPage({
                vault: assumeType(findVault(route.params.vaultId)),
                settings: assumeType(pageData.settings),
            }),
            vault: findVault(route.params.vaultId),
        };
    }
    if (route.name === "kf-witnesses") {
        const vaultId = route.params.vaultId ?? "";
        return {
            page: renderWitnessOverviewPage({
                bootstrapState: assumeType(pageData.bootstrapState),
                witnesses: assumeType(pageData.witnesses || []),
                witnessError: pageData.witnessError || "",
                onLoadBootstrap: actions.loadKfBootstrap,
                async onStartOnboarding(request) {
                    await actions.startKfOnboarding(request);
                },
            }),
            vault: findVault(vaultId),
        };
    }
    if (route.name === "kf-watchers") {
        const vaultId = route.params.vaultId ?? "";
        const watchers = assumeType(pageData.watchers || []);
        return {
            page: renderWatcherOverviewPage({
                vault: assumeType(findVault(vaultId)),
                bootstrapState: assumeType(pageData.bootstrapState),
                watchers,
                watcherError: pageData.watcherError || "",
                async onRefreshStatuses() {
                    await actions.refreshKfWatcherStatuses(watchers.map((watcher) => watcher.eid));
                },
            }),
            vault: findVault(vaultId),
        };
    }
    return {
        page: notFoundPage(route.path),
        vault: null,
    };
}
