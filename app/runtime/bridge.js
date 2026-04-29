import { PyWorker } from "../../vendor/pyscript/2025.11.2/core.js";
import { parse as parseToml } from "../../vendor/pyscript/2025.11.2/toml-BK2RWy-G.js";
import { createRuntimeRequest, isRuntimeResponse } from "./messages.js";
import { postLog, postLifecycle } from "./logger.js";

const WORKER_DIAGNOSTIC_KIND = "fortweb.runtime.diagnostic";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const WORKER_LIVENESS_TIMEOUT_MS = 3_000;
const BACKGROUND_STALE_THRESHOLD_MS = 30_000;
/** Max wait for Python-side wheel import preload (WKWebView cold boot can exceed brief RPC timeouts). */
const PRELOAD_MAX_MS = 300_000;
const METHOD_TIMEOUT_MS = {
    "vaults.create": 120_000,
    "vaults.open": 90_000,
    "identifiers.create": 90_000,
    "remotes.resolveOobi": 60_000,
    "kf.onboarding.start": 120_000,
};

function roundDurationMs(startedAt) {
    return Math.max(0, Math.round(performance.now() - startedAt));
}

function resolveTimeoutMs(method, timeoutMs) {
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        return timeoutMs;
    }

    return METHOD_TIMEOUT_MS[method] ?? DEFAULT_REQUEST_TIMEOUT_MS;
}

function createPreloadGate() {
    let settled = false;
    /** @type {(reason?: string) => void} */
    let resolveGate;
    const promise = new Promise((resolve) => {
        resolveGate = (reason) => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(reason);
        };
    });
    return { promise, resolve: resolveGate };
}

function withTimeout(promise, timeoutMs, method) {
    return new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
            const error = new Error(`Runtime request timed out for ${method}.`);
            error.code = "TIMEOUT";
            reject(error);
        }, timeoutMs);

        promise.then(
            (value) => {
                clearTimeout(timeoutId);
                resolve(value);
            },
            (error) => {
                clearTimeout(timeoutId);
                reject(error);
            },
        );
    });
}

function parseRuntimeResponse(rawResponse) {
    const payload =
        typeof rawResponse === "string"
            ? rawResponse
            : rawResponse?.data ?? rawResponse;

    if (typeof payload !== "string") {
        return payload;
    }

    try {
        return JSON.parse(payload);
    } catch (error) {
        const wrapped = new Error("Runtime worker returned a malformed response.");
        wrapped.code = "BAD_RESPONSE";
        wrapped.cause = error;
        throw wrapped;
    }
}

function parseWorkerDiagnostic(rawPayload) {
    const payload =
        typeof rawPayload === "string"
            ? (() => {
                  try {
                      return JSON.parse(rawPayload);
                  } catch {
                      return null;
                  }
              })()
            : rawPayload?.data ?? rawPayload;

    if (!payload || payload.kind !== WORKER_DIAGNOSTIC_KIND || typeof payload.event !== "string") {
        return null;
    }

    const { kind, event, level, ...fields } = payload;
    return {
        event,
        level: typeof level === "string" ? level : undefined,
        fields,
    };
}

export function createRuntimeBridge({ workerUrl, configUrl }) {
    let requestCounter = 0;
    let bootedWorker = null;
    let workerPromise = null;
    let hiddenSince = 0;
    let preloadGate = createPreloadGate();

    function resetPreloadGate() {
        preloadGate = createPreloadGate();
    }

    function resolvePreloadGate(reason = "resolved") {
        preloadGate.resolve(reason);
    }

    async function waitForPreloadReady() {
        await Promise.race([
            preloadGate.promise,
            new Promise((_, reject) => {
                window.setTimeout(() => {
                    const err = new Error("Worker preload timed out.");
                    err.code = "TIMEOUT";
                    reject(err);
                }, PRELOAD_MAX_MS);
            }),
        ]);
    }

    function createWorkerPromise() {
        resetPreloadGate();
        return (async () => {
            console.time("[bridge] worker boot");
            postLifecycle("boot");

            try {
                const response = await fetch(configUrl.toString());
                if (!response.ok) {
                    throw new Error(`Unable to load runtime config from ${configUrl.toString()}.`);
                }

                const config = parseToml(await response.text());
                const worker = await PyWorker(workerUrl.toString(), {
                    type: "pyodide",
                    configURL: configUrl.toString(),
                    config,
                });
                postLifecycle("ready");
                return worker;
            } catch (error) {
                postLifecycle("error", {
                    reason: error?.message ?? String(error),
                });
                resolvePreloadGate("js_boot_error");
                throw error;
            } finally {
                console.timeEnd("[bridge] worker boot");
            }
        })();
    }

    workerPromise = createWorkerPromise();

    function invalidateWorker(reason, fields = {}) {
        postLog("worker_invalidation", {
            level: "warning",
            reason,
            ...fields,
        });

        if (bootedWorker) {
            console.warn(`[bridge] invalidating worker: ${reason}`);
            bootedWorker = null;
        }
    }

    function attachWorkerHandlers(worker) {
        if (typeof worker.addEventListener === "function") {
            worker.addEventListener("message", (event) => {
                const diagnostic = parseWorkerDiagnostic(event?.data);
                if (!diagnostic) {
                    return;
                }

                postLog(diagnostic.event, {
                    level: diagnostic.level ?? "info",
                    ...diagnostic.fields,
                });
                if (
                    diagnostic.event === "worker_preload_complete" ||
                    diagnostic.event === "worker_preload_failed"
                ) {
                    resolvePreloadGate(diagnostic.event);
                }
            });
        }

        worker.onerror = (ev) => {
            console.error("[bridge] worker error:", ev?.message ?? ev);
            postLifecycle("error", {
                reason: ev?.message ?? String(ev),
            });
            resolvePreloadGate("worker_error");
            invalidateWorker("worker error event");
        };
        if (typeof worker.onmessageerror === "object" || worker.onmessageerror === null) {
            worker.onmessageerror = () => {
                console.error("[bridge] worker message deserialization error");
                postLifecycle("error", {
                    reason: "worker message deserialization error",
                });
                resolvePreloadGate("worker_message_error");
                invalidateWorker("message error event");
            };
        }
    }

    workerPromise.then(attachWorkerHandlers, () => {});

    async function bootFreshWorker(timeoutMs) {
        workerPromise = createWorkerPromise();
        workerPromise.then(attachWorkerHandlers, () => {});
        bootedWorker = await withTimeout(workerPromise, timeoutMs, "worker boot");
        return bootedWorker;
    }

    async function getWorker(timeoutMs) {
        if (!bootedWorker) {
            try {
                bootedWorker = await withTimeout(workerPromise, timeoutMs, "worker boot");
            } catch (error) {
                console.warn("[bridge] initial worker promise failed, booting fresh worker:", error?.message);
                bootedWorker = await bootFreshWorker(timeoutMs);
            }
        }

        await waitForPreloadReady();
        return bootedWorker;
    }

    async function checkWorkerLiveness(worker) {
        const pingId = `ping-${Date.now()}`;
        const pingPayload = JSON.stringify({
            id: pingId,
            kind: "fortweb.runtime.request",
            method: "settings.get",
            params: {},
        });
        try {
            console.time("[bridge] liveness check");
            await withTimeout(worker.sync.handle_request(pingPayload), WORKER_LIVENESS_TIMEOUT_MS, "liveness check");
            console.timeEnd("[bridge] liveness check");
            return true;
        } catch {
            console.timeEnd("[bridge] liveness check");
            return false;
        }
    }

    function onVisibilityChange() {
        if (document.hidden) {
            hiddenSince = Date.now();
        } else if (hiddenSince > 0) {
            const elapsed = Date.now() - hiddenSince;
            hiddenSince = 0;
            if (elapsed >= BACKGROUND_STALE_THRESHOLD_MS) {
                invalidateWorker(`app was hidden for ${Math.round(elapsed / 1000)}s`);
            }
        }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);

    async function rawRequest(rawPayload, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, label = "raw runtime request") {
        if (typeof rawPayload !== "string") {
            throw new Error("Runtime raw request payload must be a string.");
        }

        const worker = await getWorker(timeoutMs);
        console.time(`[bridge] ${label}`);
        const rawResponse = await withTimeout(worker.sync.handle_request(rawPayload), timeoutMs, label);
        console.timeEnd(`[bridge] ${label}`);
        return parseRuntimeResponse(rawResponse);
    }

    async function request(method, params = {}, timeoutMs) {
        const effectiveTimeoutMs = resolveTimeoutMs(method, timeoutMs);
        const id = `runtime-${Date.now()}-${requestCounter++}`;
        const payload = JSON.stringify(createRuntimeRequest(id, method, params));
        const startedAt = performance.now();

        postLog("request_start", {
            level: "info",
            method,
            request_id: id,
            timeout_ms: effectiveTimeoutMs,
        });

        try {
            const response = await rawRequest(payload, effectiveTimeoutMs, method);
            const result = handleResponse(response, id);
            postLog("request_end", {
                level: "info",
                method,
                request_id: id,
                outcome: "ok",
                duration_ms: roundDurationMs(startedAt),
            });
            return result;
        } catch (firstError) {
            if (firstError.code !== "TIMEOUT") {
                postLog("terminal_failure", {
                    level: "error",
                    method,
                    request_id: id,
                    code: firstError.code ?? "RUNTIME_ERROR",
                    message: firstError.message,
                    duration_ms: roundDurationMs(startedAt),
                });
                throw firstError;
            }

            console.warn(`[bridge] ${method} timed out, checking worker liveness`);
            postLog("request_timeout", {
                level: "warning",
                method,
                request_id: id,
                timeout_ms: effectiveTimeoutMs,
            });
            const worker = await getWorker(effectiveTimeoutMs);
            const alive = await checkWorkerLiveness(worker);

            if (alive) {
                postLog("terminal_failure", {
                    level: "error",
                    method,
                    request_id: id,
                    code: firstError.code ?? "TIMEOUT",
                    message: firstError.message,
                    duration_ms: roundDurationMs(startedAt),
                });
                throw firstError;
            }

            console.warn(`[bridge] worker is dead after timeout, booting fresh worker and retrying ${method}`);
            invalidateWorker("dead after timeout", {
                request_id: id,
                method,
            });
            await bootFreshWorker(effectiveTimeoutMs);

            const retryId = `runtime-${Date.now()}-${requestCounter++}`;
            const retryPayload = JSON.stringify(createRuntimeRequest(retryId, method, params));
            postLog("request_retry", {
                level: "warning",
                method,
                request_id: id,
                retry_request_id: retryId,
                reason: "dead_after_timeout",
            });

            try {
                const retryResponse = await rawRequest(retryPayload, effectiveTimeoutMs, method);
                const retryResult = handleResponse(retryResponse, retryId);
                postLog("request_end", {
                    level: "info",
                    method,
                    request_id: retryId,
                    prior_request_id: id,
                    outcome: "ok",
                    duration_ms: roundDurationMs(startedAt),
                });
                return retryResult;
            } catch (retryError) {
                postLog("terminal_failure", {
                    level: "error",
                    method,
                    request_id: retryId,
                    prior_request_id: id,
                    code: retryError.code ?? "RUNTIME_ERROR",
                    message: retryError.message,
                    duration_ms: roundDurationMs(startedAt),
                });
                throw retryError;
            }
        }
    }

    function handleResponse(response, expectedId) {
        if (!isRuntimeResponse(response) || response.id !== expectedId) {
            const error = new Error("Runtime worker returned an invalid response.");
            error.code = "BAD_RESPONSE";
            throw error;
        }

        if (response.ok) {
            return response.result;
        }

        const error = new Error(response.error?.message || "Runtime request failed.");
        error.code = response.error?.code || "RUNTIME_ERROR";
        throw error;
    }

    return {
        request,
        rawRequest,
        destroy() {
            document.removeEventListener("visibilitychange", onVisibilityChange);
            void workerPromise.then((worker) => {
                worker.terminate?.();
            });
        },
    };
}
