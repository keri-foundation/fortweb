const NATIVE_BRIDGE_HANDLER_NAME = "bridge";

interface NativeBridgePayload {
    type: string;
    timestamp: string;
    message: string;
}

interface NativeBridgeAdapter {
    postMessage(payload: NativeBridgePayload): void;
}

function createNativeBridgeAdapter(): NativeBridgeAdapter {
    if (typeof window !== "undefined") {
        const webkitBridge = window.webkit?.messageHandlers?.[NATIVE_BRIDGE_HANDLER_NAME];
        if (webkitBridge && typeof webkitBridge.postMessage === "function") {
            return {
                postMessage(payload: NativeBridgePayload): void {
                    webkitBridge.postMessage(payload);
                },
            };
        }

        const androidBridge = window.bridge;
        if (androidBridge && typeof androidBridge.postMessage === "function") {
            return {
                postMessage(payload: NativeBridgePayload): void {
                    androidBridge.postMessage(JSON.stringify(payload));
                },
            };
        }
    }

    return {
        postMessage(): void {},
    };
}

const nativeBridge = createNativeBridgeAdapter();

function isoNow(): string {
    return new Date().toISOString();
}

function formatDiagnosticValue(value: unknown): string {
    if (typeof value === "string") {
        return JSON.stringify(value);
    }
    return String(value);
}

export function formatDiagnosticMessage(
    event: string,
    fields: Record<string, unknown> = {},
): string {
    const parts = Object.entries(fields)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => `${key}=${formatDiagnosticValue(value)}`);

    if (parts.length === 0) {
        return `[fortweb.runtime] event=${event}`;
    }

    return `[fortweb.runtime] event=${event} ${parts.join(" ")}`;
}

export function postToNativeBridge(payload: NativeBridgePayload): void {
    try {
        nativeBridge.postMessage(payload);
    } catch {}
}

export function postLog(event: string, fields: Record<string, unknown> = {}): void {
    postToNativeBridge({
        type: "log",
        timestamp: isoNow(),
        message: formatDiagnosticMessage(event, fields),
    });
}

export function postLifecycle(state: string, fields: Record<string, unknown> = {}): void {
    postToNativeBridge({
        type: "lifecycle",
        timestamp: isoNow(),
        message: formatDiagnosticMessage("worker_lifecycle", { state, ...fields }),
    });
}

export function postError(
    errorType: "js_error" | "unhandled_rejection",
    message: string,
    fields: Record<string, unknown> = {},
): void {
    const fieldSuffix = Object.keys(fields).length > 0
        ? " " + Object.entries(fields)
            .filter(([, value]) => value !== undefined && value !== null && value !== "")
            .map(([key, value]) => `${key}=${formatDiagnosticValue(value)}`)
            .join(" ")
        : "";

    postToNativeBridge({
        type: errorType,
        timestamp: isoNow(),
        message: `${message}${fieldSuffix}`,
    });
}