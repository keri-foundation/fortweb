export function createSessionStore(initialState = {}) {
    let state = {
        vaults: [],
        unlockedVaultId: null,
        mobileNavOpen: false,
        lastCoreRoutes: {},
        ...initialState,
    };
    return {
        snapshot() {
            return state;
        },
        patch(partial) {
            state = {
                ...state,
                ...partial,
            };
            return state;
        },
        rememberCoreRoute(vaultId, href) {
            state = {
                ...state,
                lastCoreRoutes: {
                    ...state.lastCoreRoutes,
                    [vaultId]: href,
                },
            };
            return state;
        },
    };
}
