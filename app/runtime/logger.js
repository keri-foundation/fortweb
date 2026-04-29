/**
 * Shared native bridge logger for the Fortweb payload.
 *
 * Extracts the native bridge adapter and posting functions from bridge.js
 * so that global error handlers, route-level logging, and bridge RPC
 * events can all forward to Xcode (os_log) and Android Studio (logcat)
 * through a single path.
 *
 * Envelope types match the Swift WebBridgeMessageType enum:
 *   js_error, unhandled_rejection, log, lifecycle, crypto_result
 *
 * @module runtime/logger
 */

const NATIVE_BRIDGE_HANDLER_NAME = "bridge";

function createNativeBridgeAdapter() {
    if (typeof window !== "undefined") {
        const webkitBridge = window.webkit?.messageHandlers?.[NATIVE_BRIDGE_HANDLER_NAME];
        if (webkitBridge && typeof webkitBridge.postMessage === "function") {
            return {
                postMessage(payload) {
                    webkitBridge.postMessage(payload);
                },
            };
        }

        const androidBridge = window[NATIVE_BRIDGE_HANDLER_NAME];
        if (androidBridge && typeof androidBridge.postMessage === "function") {
            return {
                postMessage(payload) {
                    androidBridge.postMessage(JSON.stringify(payload));
                },
            };
        }
    }

    return {
        postMessage() {},
    };
}

const nativeBridge = createNativeBridgeAdapter();

function isoNow() {
    return new Date().toISOString();
}

function formatDiagnosticValue(value) {
    if (typeof value === "string") {
        return JSON.stringify(value);
    }
    return String(value);
}

/**
 * Format a structured log message in the [fortweb.runtime] convention.
 *
 * @param {string} event
 * @param {Object} [fields]
 * @returns {string}
 */
export function formatDiagnosticMessage(event, fields = {}) {
    const parts = Object.entries(fields)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => `${key}=${formatDiagnosticValue(value)}`);

    if (parts.length === 0) {
        return `[fortweb.runtime] event=${event}`;
    }

    return `[fortweb.runtime] event=${event} ${parts.join(" ")}`;
}

/**
 * Post a payload to the native bridge (iOS WKWebView or Android WebView).
 * Silently no-ops when no native bridge is available.
 *
 * @param {Object} payload
 */
export function postToNativeBridge(payload) {
    try {
        nativeBridge.postMessage(payload);
    } catch {}
}

/**
 * Send a log-type message to the native bridge.
 * On iOS this arrives as WebBridgeMessageType.log and is routed
 * through AppLogger at info level (with keyword escalation).
 *
 * @param {string} event
 * @param {Object} [fields]
 */
export function postLog(event, fields = {}) {
    postToNativeBridge({
        type: "log",
        timestamp: isoNow(),
        message: formatDiagnosticMessage(event, fields),
    });
}

/**
 * Send a lifecycle-type message to the native bridge.
 * On iOS this arrives as WebBridgeMessageType.lifecycle and is
 * routed through AppLogger at notice/warning level.
 *
 * @param {string} state
 * @param {Object} [fields]
 */
export function postLifecycle(state, fields = {}) {
    postToNativeBridge({
        type: "lifecycle",
        timestamp: isoNow(),
        message: formatDiagnosticMessage("worker_lifecycle", { state, ...fields }),
    });
}

/**
 * Send a js_error or unhandled_rejection message to the native bridge.
 * On iOS these arrive as WebBridgeMessageType.jsError / .unhandledRejection
 * and are routed through AppLogger at error level.
 *
 * @param {"js_error"|"unhandled_rejection"} errorType
 * @param {string} message
 * @param {Object} [fields]
 */
export function postError(errorType, message, fields = {}) {
    const fieldSuffix = Object.keys(fields).length > 0
        ? " " + Object.entries(fields)
            .filter(([, v]) => v !== undefined && v !== null && v !== "")
            .map(([k, v]) => `${k}=${formatDiagnosticValue(v)}`)
            .join(" ")
        : "";

    postToNativeBridge({
        type: errorType,
        timestamp: isoNow(),
        message: `${message}${fieldSuffix}`,
    });
}
