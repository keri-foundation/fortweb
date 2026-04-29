export const REQUEST_KIND = "fortweb.runtime.request";
export const RESPONSE_KIND = "fortweb.runtime.response";

export interface RuntimeRequest {
    id: string;
    kind: typeof REQUEST_KIND;
    method: string;
    params: Record<string, unknown>;
}

export interface RuntimeErrorPayload {
    code: string;
    message: string;
}

export interface RuntimeSuccessResponse {
    id: string;
    kind: typeof RESPONSE_KIND;
    ok: true;
    result: Record<string, unknown>;
}

export interface RuntimeErrorResponse {
    id: string;
    kind: typeof RESPONSE_KIND;
    ok: false;
    error: RuntimeErrorPayload;
}

export type RuntimeResponse = RuntimeSuccessResponse | RuntimeErrorResponse;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createRuntimeRequest(
    id: string,
    method: string,
    params: Record<string, unknown> = {},
): RuntimeRequest {
    if (typeof id !== "string" || !id) {
        throw new Error("Runtime request id must be a non-empty string.");
    }
    if (typeof method !== "string" || !method) {
        throw new Error("Runtime request method must be a non-empty string.");
    }
    if (!isPlainObject(params)) {
        throw new Error("Runtime request params must be a plain object.");
    }
    return {
        id,
        kind: REQUEST_KIND,
        method,
        params,
    };
}

export function isRuntimeResponse(message: unknown): message is RuntimeResponse {
    if (!isPlainObject(message)) {
        return false;
    }
    if (message.kind !== RESPONSE_KIND || typeof message.id !== "string" || typeof message.ok !== "boolean") {
        return false;
    }
    if (message.ok) {
        return isPlainObject(message.result);
    }
    return (
        isPlainObject(message.error) &&
        typeof message.error.code === "string" &&
        typeof message.error.message === "string"
    );
}