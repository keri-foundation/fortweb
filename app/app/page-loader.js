import { METHODS } from "../runtime/method-catalog.js";
export async function loadRouteData({ bridge, route }) {
    if (route.name === "identifiers") {
        const vaultId = route.params.vaultId ?? "";
        return bridge.request(METHODS.identifiersList, { vaultId });
    }
    if (route.name === "identifier-detail") {
        return bridge.request(METHODS.identifiersGet, {
            vaultId: route.params.vaultId,
            aid: route.params.aid,
        });
    }
    if (route.name === "remotes") {
        const vaultId = route.params.vaultId ?? "";
        return bridge.request(METHODS.remotesList, {
            vaultId,
        });
    }
    if (route.name === "remote-detail") {
        return bridge.request(METHODS.remotesGet, {
            vaultId: route.params.vaultId,
            aid: route.params.aid,
        });
    }
    if (route.name === "settings") {
        return bridge.request(METHODS.settingsGet, {
            vaultId: route.params.vaultId,
        });
    }
    if (route.name === "kf-witnesses") {
        const vaultId = route.params.vaultId ?? "";
        const bootstrapState = await bridge.request(METHODS.kfBootstrapGet, { vaultId });
        let witnesses = [];
        let witnessError = "";
        if (bootstrapState.account?.status === "onboarded") {
            try {
                ({ witnesses } = await bridge.request(METHODS.kfAccountWitnessesList, { vaultId }));
            }
            catch (error) {
                witnessError = error instanceof Error ? error.message : "Failed to load hosted witness rows.";
            }
        }
        return {
            bootstrapState,
            witnesses,
            witnessError,
        };
    }
    if (route.name === "kf-watchers") {
        const vaultId = route.params.vaultId ?? "";
        const bootstrapState = await bridge.request(METHODS.kfBootstrapGet, { vaultId });
        let watchers = [];
        let watcherError = "";
        if (bootstrapState.account?.status === "onboarded") {
            try {
                ({ watchers } = await bridge.request(METHODS.kfAccountWatchersList, { vaultId }));
            }
            catch (error) {
                watcherError = error instanceof Error ? error.message : "Failed to load hosted watcher rows.";
            }
        }
        return {
            bootstrapState,
            watchers,
            watcherError,
        };
    }
    return {};
}
