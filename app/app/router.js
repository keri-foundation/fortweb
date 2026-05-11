function decode(value) {
    return decodeURIComponent(value);
}

function safeDecode(value) {
    try {
        return decode(value);
    } catch {
        return null;
    }
}

function notFoundRoute(path) {
    return {
        name: "not-found",
        path,
        shellMode: "home",
        navMode: "none",
        params: {},
    };
}

export function normalizeHash(hash = window.location.hash) {
    const withoutHash = hash.startsWith("#") ? hash.slice(1) : hash;
    if (!withoutHash) {
        return "/";
    }
    return withoutHash.startsWith("/") ? withoutHash : `/${withoutHash}`;
}

export function parseRoute(hash = window.location.hash) {
    const path = normalizeHash(hash);
    const patterns = [
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
            name: "kf-home",
            regex: /^\/vaults\/([^/]+)\/kf$/,
            shellMode: "vault",
            navMode: "plugin",
            requiresVault: true,
            requiresUnlock: true,
        },
        {
            name: "kf-identifiers",
            regex: /^\/vaults\/([^/]+)\/kf\/identifiers$/,
            shellMode: "vault",
            navMode: "plugin",
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

        const params = {};
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

export function navigate(href) {
    window.location.hash = href.startsWith("#") ? href.slice(1) : href;
}

export function homeHref() {
    return "#/";
}

export function unlockHref(vaultId) {
    return `#/vaults/${encodeURIComponent(vaultId)}/unlock`;
}

export function identifiersHref(vaultId) {
    return `#/vaults/${encodeURIComponent(vaultId)}/identifiers`;
}

export function identifierDetailHref(vaultId, aid) {
    return `#/vaults/${encodeURIComponent(vaultId)}/identifiers/${encodeURIComponent(aid)}`;
}

export function remotesHref(vaultId) {
    return `#/vaults/${encodeURIComponent(vaultId)}/remotes`;
}

export function remoteDetailHref(vaultId, aid) {
    return `#/vaults/${encodeURIComponent(vaultId)}/remotes/${encodeURIComponent(aid)}`;
}

export function settingsHref(vaultId) {
    return `#/vaults/${encodeURIComponent(vaultId)}/settings`;
}

export function kfHomeHref(vaultId) {
    return `#/vaults/${encodeURIComponent(vaultId)}/kf`;
}

export function kfIdentifiersHref(vaultId) {
    return `#/vaults/${encodeURIComponent(vaultId)}/kf/identifiers`;
}

export function kfWitnessesHref(vaultId) {
    return `#/vaults/${encodeURIComponent(vaultId)}/kf/witnesses`;
}

export function kfWatchersHref(vaultId) {
    return `#/vaults/${encodeURIComponent(vaultId)}/kf/watchers`;
}
