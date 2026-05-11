const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

const KF_SURFACE_CONFIGS = {
    development: {
        onboardingUrl: "http://127.0.0.1:9723/onboarding",
        accountUrl: "http://127.0.0.1:9723/account",
        onboardingDestination: "",
        accountDestination: "",
    },
    production: {
        onboardingUrl: "/onboarding",
        accountUrl: "/account",
        onboardingDestination: "",
        accountDestination: "",
    },
};

function surfaceRoot(url) {
    if (!url) {
        return "";
    }

    try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.host}`;
    } catch (_error) {
        return "";
    }
}

function resolveSurfaceUrl(url, origin) {
    if (!url) {
        return "";
    }

    try {
        return new URL(url).toString();
    } catch (_error) {
        try {
            return new URL(url, origin).toString();
        } catch (_nestedError) {
            return "";
        }
    }
}

export function resolveKfSurfaceConfig(origin = window.location.origin) {
    let environment = "development";
    try {
        const { hostname, protocol } = new URL(origin);
        if (HTTP_PROTOCOLS.has(protocol) && !LOCAL_HOSTS.has(hostname)) {
            environment = "production";
        }
    } catch (_error) {
        environment = "development";
    }

    const configured = KF_SURFACE_CONFIGS[environment] || KF_SURFACE_CONFIGS.production;
    const onboardingUrl = resolveSurfaceUrl(configured.onboardingUrl, origin);
    const accountUrl = resolveSurfaceUrl(configured.accountUrl, origin);
    return {
        environment,
        bootUrl: surfaceRoot(onboardingUrl || accountUrl),
        onboardingUrl,
        accountUrl,
        onboardingDestination: configured.onboardingDestination,
        accountDestination: configured.accountDestination,
    };
}
