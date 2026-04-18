/**
 * Global error handlers that forward uncaught JS errors and
 * unhandled promise rejections to the native bridge.
 *
 * On iOS these arrive as WebBridgeMessageType.jsError and
 * WebBridgeMessageType.unhandledRejection, routed through
 * AppLogger at error level into os_log (visible in Xcode).
 *
 * Call installGlobalHandlers() once during bootstrap.
 *
 * @module runtime/global-handlers
 */

import { postError } from "./logger.js";

const SENSITIVE_PATTERN = /passcode|password|secret|token|key[=:]\s*\S+/gi;

/**
 * Strip values that look like secrets from an error message.
 *
 * @param {string} message
 * @returns {string}
 */
function sanitize(message) {
    if (typeof message !== "string") return String(message ?? "");
    return message.replace(SENSITIVE_PATTERN, "[REDACTED]");
}

/**
 * Extract a safe message string from an Error or unknown rejection reason.
 *
 * @param {unknown} reason
 * @returns {string}
 */
function reasonMessage(reason) {
    if (reason instanceof Error) {
        return sanitize(reason.message || "Unknown error");
    }
    if (typeof reason === "string") {
        return sanitize(reason);
    }
    return "Non-error rejection";
}

let installed = false;

/**
 * Install global error and unhandled rejection handlers.
 * Safe to call multiple times; only installs once.
 */
export function installGlobalHandlers() {
    if (installed) return;
    installed = true;

    window.onerror = (message, source, lineno, colno) => {
        postError("js_error", sanitize(String(message)), {
            source: source || "",
            lineno: lineno ?? "",
            colno: colno ?? "",
        });
    };

    window.addEventListener("unhandledrejection", (event) => {
        postError("unhandled_rejection", reasonMessage(event.reason));
    });
}
