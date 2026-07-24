type FortRuntimeOriginPlatform = "ios-wkwebview" | "android-webview" | "browser-dev";
type FortRuntimeOriginMode = "bundled-offline" | "browser-dev";
type FortRuntimeOriginBoolean = boolean | "unknown";

export type FortRuntimeOriginContractV1 = {
    schema: "fortweb.runtime-origin.v1";
    version: 1;
    platform: FortRuntimeOriginPlatform;
    mode: FortRuntimeOriginMode;
    documentOrigin: string;
    appBaseUrl: string;
    entryUrl: string;
    workerUrl: string;
    configUrl: string;
    pyodide?: {
        interpreterUrl?: string;
        indexURL?: string;
        packageBaseUrl?: string;
    };
    wheels?: {
        pyodideWheelBaseUrl?: string;
        appWheelBaseUrl?: string;
    };
    storage: {
        storageNamespace: string;
        indexedDbRequired: boolean | "unknown";
        originPartition: string;
    };
    capabilities: {
        customScheme: boolean;
        httpsLikeAssetOrigin: boolean;
        implicitBlobOriginSafe: FortRuntimeOriginBoolean;
        networkAllowed: false;
        bundledAssetsOnly: true;
    };
};

const RUNTIME_ORIGIN_SCHEMA = "fortweb.runtime-origin.v1";
const RUNTIME_ORIGIN_VERSION = 1 as const;
const IOS_APP_LOCAL_ORIGIN = "app://local";
const IOS_LOOPBACK_HOST = "127.0.0.1";
const IOS_LOOPBACK_PROTOCOL = "http:";
const IOS_LOOPBACK_PATH_PREFIX = "_fortios";
const IOS_LOOPBACK_NONCE_PATTERN = /^[A-Za-z0-9_-]{16,}$/;
const SECRET_FIELD_PATTERN = /(pass(code|word)?|secret|seed|mnemonic|private[_-]?key|token|api[_-]?key|authorization|cookie|credential)/i;

export class RuntimeOriginContractError extends Error {
    readonly code = "INVALID_RUNTIME_ORIGIN_CONTRACT";

    constructor(message: string) {
        super(message);
        this.name = "RuntimeOriginContractError";
    }
}

declare global {
    interface Window {
        __FORT_RUNTIME_ORIGIN__?: unknown;
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertRuntimeContract(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new RuntimeOriginContractError(message);
    }
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
    assertRuntimeContract(isPlainObject(value), `${field} must be an object.`);
    return value;
}

function requireString(value: unknown, field: string): string {
    assertRuntimeContract(typeof value === "string" && value.trim().length > 0, `${field} must be a non-empty string.`);
    return value.trim();
}

function requireBoolean(value: unknown, field: string): boolean {
    assertRuntimeContract(typeof value === "boolean", `${field} must be a boolean.`);
    return value;
}

function requireBooleanOrUnknown(value: unknown, field: string): FortRuntimeOriginBoolean {
    assertRuntimeContract(
        typeof value === "boolean" || value === "unknown",
        `${field} must be a boolean or "unknown".`,
    );
    return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    assertRuntimeContract(typeof value === "string" && allowed.includes(value as T), `${field} was invalid.`);
    return value as T;
}

function requireAbsoluteUrl(value: unknown, field: string): string {
    const text = requireString(value, field);
    try {
        new URL(text);
    } catch {
        throw new RuntimeOriginContractError(`${field} must be an absolute URL.`);
    }
    return text;
}

function normalizeBaseUrl(url: string): string {
    if (url.endsWith("/")) {
        return url.slice(0, -1);
    }
    return url;
}

function urlScheme(url: string): string {
    return new URL(url).protocol.replace(/:$/, "").toLowerCase();
}

function parseContractUrl(value: string, field: string): URL {
    try {
        const url = new URL(value);
        assertRuntimeContract(!url.username && !url.password, `${field} must not include credentials.`);
        assertRuntimeContract(!url.search && !url.hash, `${field} must not include query or fragment components.`);
        return url;
    } catch (error) {
        if (error instanceof RuntimeOriginContractError) {
            throw error;
        }
        throw new RuntimeOriginContractError(`${field} must be an absolute URL.`);
    }
}

function sameOrigin(left: URL, right: URL): boolean {
    return left.protocol === right.protocol && left.hostname === right.hostname && left.port === right.port;
}

function validateIosCommonCapabilities(contract: FortRuntimeOriginContractV1): void {
    assertRuntimeContract(
        contract.capabilities.httpsLikeAssetOrigin === false,
        "Bundled iOS runtime origin contract must set httpsLikeAssetOrigin=false.",
    );
    assertRuntimeContract(
        contract.capabilities.implicitBlobOriginSafe === false,
        "Bundled iOS runtime origin contract must set implicitBlobOriginSafe=false.",
    );
    assertRuntimeContract(
        contract.capabilities.networkAllowed === false,
        "Bundled iOS runtime origin contract must set networkAllowed=false.",
    );
    assertRuntimeContract(
        contract.capabilities.bundledAssetsOnly === true,
        "Bundled iOS runtime origin contract must set bundledAssetsOnly=true.",
    );
}

function validateIosAppLocalContract(contract: FortRuntimeOriginContractV1): void {
    assertRuntimeContract(
        normalizeBaseUrl(contract.documentOrigin) === IOS_APP_LOCAL_ORIGIN,
        "Bundled iOS app-local runtime origin contract must use document origin app://local.",
    );
    assertRuntimeContract(
        normalizeBaseUrl(contract.appBaseUrl) === IOS_APP_LOCAL_ORIGIN,
        "Bundled iOS app-local runtime origin contract must use app base URL app://local.",
    );
    assertRuntimeContract(
        normalizeBaseUrl(contract.storage.originPartition) === IOS_APP_LOCAL_ORIGIN,
        "Bundled iOS app-local runtime origin contract must use origin partition app://local.",
    );

    for (const [field, value] of [
        ["entryUrl", contract.entryUrl],
        ["workerUrl", contract.workerUrl],
        ["configUrl", contract.configUrl],
    ] as const) {
        assertRuntimeContract(
            value.startsWith(`${IOS_APP_LOCAL_ORIGIN}/`),
            `Bundled iOS app-local runtime origin contract must use app://local URLs for ${field}.`,
        );
        assertRuntimeContract(
            !value.startsWith("http://") && !value.startsWith("https://"),
            `Bundled iOS app-local runtime origin contract must not use network URLs for ${field}.`,
        );
        assertRuntimeContract(
            !value.includes("localhost") && !value.includes(IOS_LOOPBACK_HOST),
            `Bundled iOS app-local runtime origin contract must not use loopback URLs for ${field}.`,
        );
    }

    assertRuntimeContract(contract.capabilities.customScheme, "Bundled iOS app-local runtime origin contract must set customScheme=true.");
    validateIosCommonCapabilities(contract);
}

function validateIosLoopbackContract(contract: FortRuntimeOriginContractV1): void {
    const documentOrigin = parseContractUrl(contract.documentOrigin, "Runtime origin contract.documentOrigin");
    assertRuntimeContract(
        contract.documentOrigin.startsWith(`http://${IOS_LOOPBACK_HOST}:`),
        "Bundled iOS loopback runtime origin contract must use canonical 127.0.0.1 HTTP origin.",
    );
    assertRuntimeContract(
        documentOrigin.protocol === IOS_LOOPBACK_PROTOCOL && documentOrigin.hostname === IOS_LOOPBACK_HOST,
        "Bundled iOS loopback runtime origin contract must use 127.0.0.1 over HTTP.",
    );
    assertRuntimeContract(
        documentOrigin.port.length > 0 && documentOrigin.port !== "0",
        "Bundled iOS loopback runtime origin contract must use an explicit non-zero port.",
    );
    assertRuntimeContract(
        documentOrigin.pathname === "/",
        "Bundled iOS loopback runtime origin contract must not include a document path.",
    );

    const appBaseUrl = parseContractUrl(contract.appBaseUrl, "Runtime origin contract.appBaseUrl");
    const originPartition = parseContractUrl(contract.storage.originPartition, "Runtime origin contract.storage.originPartition");
    assertRuntimeContract(sameOrigin(appBaseUrl, documentOrigin), "Bundled iOS loopback runtime origin contract must use one origin.");
    assertRuntimeContract(sameOrigin(originPartition, documentOrigin), "Bundled iOS loopback runtime origin contract must use document origin as origin partition.");
    assertRuntimeContract(originPartition.pathname === "/", "Bundled iOS loopback runtime origin partition must not include a path.");

    const appBaseSegments = appBaseUrl.pathname.split("/").filter(Boolean);
    assertRuntimeContract(
        appBaseSegments.length === 2 && appBaseSegments[0] === IOS_LOOPBACK_PATH_PREFIX,
        "Bundled iOS loopback runtime origin contract must use the hardened path prefix.",
    );
    const nonce = appBaseSegments[1];
    assertRuntimeContract(
        IOS_LOOPBACK_NONCE_PATTERN.test(nonce),
        "Bundled iOS loopback runtime origin contract must include a non-trivial nonce path segment.",
    );
    const noncePathPrefix = `/${IOS_LOOPBACK_PATH_PREFIX}/${nonce}/`;

    for (const [field, value] of [
        ["entryUrl", contract.entryUrl],
        ["workerUrl", contract.workerUrl],
        ["configUrl", contract.configUrl],
    ] as const) {
        const url = parseContractUrl(value, `Runtime origin contract.${field}`);
        assertRuntimeContract(sameOrigin(url, documentOrigin), `Bundled iOS loopback runtime origin contract must use one origin for ${field}.`);
        assertRuntimeContract(
            url.pathname.startsWith(noncePathPrefix),
            `Bundled iOS loopback runtime origin contract must keep ${field} under the nonce path prefix.`,
        );
    }

    assertRuntimeContract(contract.capabilities.customScheme === false, "Bundled iOS loopback runtime origin contract must set customScheme=false.");
    validateIosCommonCapabilities(contract);
}

function rejectSecretBearingFields(value: unknown, path = "contract"): void {
    if (Array.isArray(value)) {
        value.forEach((item, index) => rejectSecretBearingFields(item, `${path}[${index}]`));
        return;
    }

    if (!isPlainObject(value)) {
        return;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
        if (SECRET_FIELD_PATTERN.test(key)) {
            throw new RuntimeOriginContractError(`Runtime origin contract contains a forbidden field at ${path}.${key}.`);
        }
        rejectSecretBearingFields(nestedValue, `${path}.${key}`);
    }
}

function validateOptionalUrlObject(
    value: unknown,
    field: string,
): Record<string, string> | undefined {
    if (typeof value === "undefined") {
        return undefined;
    }

    const objectValue = requireObject(value, field);
    const validated: Record<string, string> = {};
    for (const [key, nestedValue] of Object.entries(objectValue)) {
        validated[key] = requireAbsoluteUrl(nestedValue, `${field}.${key}`);
    }
    return validated;
}

function validateIosBundledOfflineContract(contract: FortRuntimeOriginContractV1): void {
    assertRuntimeContract(
        contract.platform === "ios-wkwebview",
        "Bundled iOS runtime origin contract must declare platform ios-wkwebview.",
    );
    assertRuntimeContract(
        contract.mode === "bundled-offline",
        "Bundled iOS runtime origin contract must declare mode bundled-offline.",
    );

    if (normalizeBaseUrl(contract.documentOrigin) === IOS_APP_LOCAL_ORIGIN) {
        validateIosAppLocalContract(contract);
        return;
    }

    validateIosLoopbackContract(contract);
}

function validateRuntimeOriginContract(rawValue: unknown): FortRuntimeOriginContractV1 {
    const root = requireObject(rawValue, "Runtime origin contract");
    rejectSecretBearingFields(root);

    const platform = requireEnum(
        root.platform,
        ["ios-wkwebview", "android-webview", "browser-dev"] as const,
        "Runtime origin contract.platform",
    );
    const mode = requireEnum(
        root.mode,
        ["bundled-offline", "browser-dev"] as const,
        "Runtime origin contract.mode",
    );

    const storage = requireObject(root.storage, "Runtime origin contract.storage");
    const capabilities = requireObject(root.capabilities, "Runtime origin contract.capabilities");
    assertRuntimeContract(root.version === RUNTIME_ORIGIN_VERSION, "Runtime origin contract version was invalid.");
    const networkAllowed = requireBoolean(capabilities.networkAllowed, "Runtime origin contract.capabilities.networkAllowed");
    assertRuntimeContract(networkAllowed === false, "Runtime origin contract.capabilities.networkAllowed must be false.");
    const bundledAssetsOnly = requireBoolean(capabilities.bundledAssetsOnly, "Runtime origin contract.capabilities.bundledAssetsOnly");
    assertRuntimeContract(bundledAssetsOnly === true, "Runtime origin contract.capabilities.bundledAssetsOnly must be true.");

    const contract: FortRuntimeOriginContractV1 = {
        schema: requireEnum(root.schema, [RUNTIME_ORIGIN_SCHEMA] as const, "Runtime origin contract.schema"),
        version: 1,
        platform,
        mode,
        documentOrigin: normalizeBaseUrl(requireAbsoluteUrl(root.documentOrigin, "Runtime origin contract.documentOrigin")),
        appBaseUrl: normalizeBaseUrl(requireAbsoluteUrl(root.appBaseUrl, "Runtime origin contract.appBaseUrl")),
        entryUrl: requireAbsoluteUrl(root.entryUrl, "Runtime origin contract.entryUrl"),
        workerUrl: requireAbsoluteUrl(root.workerUrl, "Runtime origin contract.workerUrl"),
        configUrl: requireAbsoluteUrl(root.configUrl, "Runtime origin contract.configUrl"),
        storage: {
            storageNamespace: requireString(storage.storageNamespace, "Runtime origin contract.storage.storageNamespace"),
            indexedDbRequired: requireBooleanOrUnknown(
                storage.indexedDbRequired,
                "Runtime origin contract.storage.indexedDbRequired",
            ),
            originPartition: normalizeBaseUrl(
                requireAbsoluteUrl(storage.originPartition, "Runtime origin contract.storage.originPartition"),
            ),
        },
        capabilities: {
            customScheme: requireBoolean(capabilities.customScheme, "Runtime origin contract.capabilities.customScheme"),
            httpsLikeAssetOrigin: requireBoolean(
                capabilities.httpsLikeAssetOrigin,
                "Runtime origin contract.capabilities.httpsLikeAssetOrigin",
            ),
            implicitBlobOriginSafe: requireBooleanOrUnknown(
                capabilities.implicitBlobOriginSafe,
                "Runtime origin contract.capabilities.implicitBlobOriginSafe",
            ),
            networkAllowed: false,
            bundledAssetsOnly: true,
        },
        pyodide: validateOptionalUrlObject(root.pyodide, "Runtime origin contract.pyodide") as FortRuntimeOriginContractV1["pyodide"],
        wheels: validateOptionalUrlObject(root.wheels, "Runtime origin contract.wheels") as FortRuntimeOriginContractV1["wheels"],
    };

    if (contract.platform === "ios-wkwebview" && contract.mode === "bundled-offline") {
        validateIosBundledOfflineContract(contract);
    }

    return contract;
}

export function readWindowRuntimeOriginContract(targetWindow: Window & typeof globalThis = window): FortRuntimeOriginContractV1 | null {
    if (typeof targetWindow.__FORT_RUNTIME_ORIGIN__ === "undefined") {
        return null;
    }

    return validateRuntimeOriginContract(targetWindow.__FORT_RUNTIME_ORIGIN__);
}

export function describeRuntimeOriginContract(
    contract: FortRuntimeOriginContractV1,
): Record<string, string | number | boolean> {
    return {
        schema: contract.schema,
        version: contract.version,
        platform: contract.platform,
        mode: contract.mode,
        document_origin_scheme: urlScheme(contract.documentOrigin),
        app_base_scheme: urlScheme(contract.appBaseUrl),
        entry_scheme: urlScheme(contract.entryUrl),
        worker_scheme: urlScheme(contract.workerUrl),
        config_scheme: urlScheme(contract.configUrl),
        storage_namespace: contract.storage.storageNamespace,
    };
}

export interface RuntimeOriginLocationLike {
    protocol: string;
    hostname: string;
}

function isPlainLocalBrowserDevLocation(location: RuntimeOriginLocationLike): boolean {
    const protocol = location.protocol;
    const hostname = location.hostname;
    return (
        (protocol === "http:" || protocol === "https:") &&
        (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]")
    );
}

export function isRuntimeOriginContractRequired(location: RuntimeOriginLocationLike): boolean {
    return !isPlainLocalBrowserDevLocation(location);
}
