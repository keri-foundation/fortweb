export interface SessionState {
    vaults: unknown[];
    unlockedVaultId: string | null;
    mobileNavOpen: boolean;
    lastCoreRoutes: Record<string, string>;
    [key: string]: unknown;
}

export interface SessionStore {
    snapshot(): SessionState;
    patch(partial: Partial<SessionState>): SessionState;
    rememberCoreRoute(vaultId: string, href: string): SessionState;
}

export function createSessionStore(initialState: Partial<SessionState> = {}): SessionStore {
    let state: SessionState = {
        vaults: [],
        unlockedVaultId: null,
        mobileNavOpen: false,
        lastCoreRoutes: {},
        ...initialState,
    };

    return {
        snapshot(): SessionState {
            return state;
        },

        patch(partial: Partial<SessionState>): SessionState {
            state = {
                ...state,
                ...partial,
            };
            return state;
        },

        rememberCoreRoute(vaultId: string, href: string): SessionState {
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