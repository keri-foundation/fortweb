import { postError } from "./logger.js";

const SENSITIVE_PATTERN = /passcode|password|secret|token|key[=:]\s*\S+/gi;

function sanitize(message: unknown): string {
    if (typeof message !== "string") {
        return String(message ?? "");
    }

    return message.replace(SENSITIVE_PATTERN, "[REDACTED]");
}

function reasonMessage(reason: unknown): string {
    if (reason instanceof Error) {
        return sanitize(reason.message || "Unknown error");
    }

    if (typeof reason === "string") {
        return sanitize(reason);
    }

    return "Non-error rejection";
}

let installed = false;

export function installGlobalHandlers(): void {
    if (installed) {
        return;
    }

    installed = true;

    window.onerror = (message, source, lineno, colno) => {
        postError("js_error", sanitize(String(message)), {
            source: source || "",
            lineno: lineno ?? "",
            colno: colno ?? "",
        });
    };

    window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
        postError("unhandled_rejection", reasonMessage(event.reason));
    });
}