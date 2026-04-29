type ShellMode = "home" | "vault";
type NavMode = "none" | "core" | "plugin";
type RouteName =
    | "home"
    | "unlock"
    | "identifiers"
    | "identifier-detail"
    | "remotes"
    | "remote-detail"
    | "settings"
    | "kf-witnesses"
    | "kf-watchers"
    | "not-found";

interface RouteParams {
    vaultId?: string;
    aid?: string;
}

interface RouteDefinition {
    name: RouteName;
    shellMode: ShellMode;
    navMode: NavMode;
    requiresVault?: boolean;
    requiresUnlock?: boolean;
}

interface MatchRouteDefinition extends RouteDefinition {
    regex: RegExp;
}

export interface Route extends RouteDefinition {
    path: string;
    params: RouteParams;
    regex?: RegExp;
}

function decode(value: string): string {
    return decodeURIComponent(value);
}

function safeDecode(value: string): string | null {
    try {
        return decode(value);
    } catch {
        return null;
    }
}

function notFoundRoute(path: string): Route {
    return {
        name: "not-found",
        path,
        shellMode: "home",
        navMode: "none",
        params: {},
    };
}

export function normalizeHash(hash = window.location.hash): string {
    const withoutHash = hash.startsWith("#") ? hash.slice(1) : hash;
    if (!withoutHash) {
        return "/";
    }
    return withoutHash.startsWith("/") ? withoutHash : `/${withoutHash}`;
}

export function parseRoute(hash = window.location.hash): Route {
    const path = normalizeHash(hash);
    const patterns: MatchRouteDefinition[] = [
        {
            name: "home",
            regex: /^\/$/,
            shellMode: "home",
            navMode: "none",
        },
        {
            name: "unlock",
            regex: /^\/vaults\/([^/]+)\/unlock$/,
            shellMode: "home",
            navMode: "none",
            requiresVault: true,
        },
        {
            name: "identifiers",
            regex: /^\/vaults\/([^/]+)\/identifiers$/,
            shellMode: "vault",
            navMode: "core",
            requiresVault: true,
            requiresUnlock: true,
        },
        {
            name: "identifier-detail",
            regex: /^\/vaults\/([^/]+)\/identifiers\/([^/]+)$/,
            shellMode: "vault",
            navMode: "core",
            requiresVault: true,
            requiresUnlock: true,
        },
        {
            name: "remotes",
            regex: /^\/vaults\/([^/]+)\/remotes$/,
            shellMode: "vault",
            navMode: "core",
            requiresVault: true,
            requiresUnlock: true,
        },
        {
            name: "remote-detail",
            regex: /^\/vaults\/([^/]+)\/remotes\/([^/]+)$/,
            shellMode: "vault",
            navMode: "core",
            requiresVault: true,
            requiresUnlock: true,
        },
        {
            name: "settings",
            regex: /^\/vaults\/([^/]+)\/settings$/,
            shellMode: "vault",
            navMode: "core",
            requiresVault: true,
            requiresUnlock: true,
        },
        {
            name: "kf-witnesses",
            regex: /^\/vaults\/([^/]+)\/kf\/witnesses$/,
            shellMode: "vault",
            navMode: "plugin",
            requiresVault: true,
            requiresUnlock: true,
        },
        {
            name: "kf-watchers",
            regex: /^\/vaults\/([^/]+)\/kf\/watchers$/,
            shellMode: "vault",
            navMode: "plugin",
            requiresVault: true,
            requiresUnlock: true,
        },
    ];

    for (const pattern of patterns) {
        const match = path.match(pattern.regex);
        if (!match) {
            continue;
        }

        const params: RouteParams = {};
        if (match[1]) {
            const vaultId = safeDecode(match[1]);
            if (vaultId == null) {
                return notFoundRoute(path);
            }
            params.vaultId = vaultId;
        }
        if (match[2]) {
            const aid = safeDecode(match[2]);
            if (aid == null) {
                return notFoundRoute(path);
            }
            params.aid = aid;
        }

        return {
            ...pattern,
            path,
            params,
        };
    }

    return notFoundRoute(path);
}

export function navigate(href: string): void {
    window.location.hash = href.startsWith("#") ? href.slice(1) : href;
}

export function homeHref(): string {
    return "#/";
}

export function unlockHref(vaultId: string): string {
    return `#/vaults/${encodeURIComponent(vaultId)}/unlock`;
}

export function identifiersHref(vaultId: string): string {
    return `#/vaults/${encodeURIComponent(vaultId)}/identifiers`;
}

export function identifierDetailHref(vaultId: string, aid: string): string {
    return `#/vaults/${encodeURIComponent(vaultId)}/identifiers/${encodeURIComponent(aid)}`;
}

export function remotesHref(vaultId: string): string {
    return `#/vaults/${encodeURIComponent(vaultId)}/remotes`;
}

export function remoteDetailHref(vaultId: string, aid: string): string {
    return `#/vaults/${encodeURIComponent(vaultId)}/remotes/${encodeURIComponent(aid)}`;
}

export function settingsHref(vaultId: string): string {
    return `#/vaults/${encodeURIComponent(vaultId)}/settings`;
}

export function kfWitnessesHref(vaultId: string): string {
    return `#/vaults/${encodeURIComponent(vaultId)}/kf/witnesses`;
}

export function kfWatchersHref(vaultId: string): string {
    return `#/vaults/${encodeURIComponent(vaultId)}/kf/watchers`;
}