/**
 * WKWebView capability probe — inject into bundled iOS runtime.
 * Measures actual WebKit API support under the app://local origin.
 * Safe: no user data, no network, unique temp names, self-cleaning.
 */
export async function probeWkWebViewCapabilities(): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};

    // ── Synchronous property checks ──
    results.href = window.location.href;
    results.origin = window.location.origin;
    results.isSecureContext = window.isSecureContext;
    results.cryptoObjectPresent = typeof globalThis.crypto === "object";
    results.subtleCryptoPresent = typeof globalThis.crypto?.subtle === "object";
    results.indexedDbPresent = typeof globalThis.indexedDB === "object";
    results.blobPresent = typeof globalThis.Blob === "function";
    results.createObjectUrlPresent = typeof globalThis.URL?.createObjectURL === "function";
    results.workerPresent = typeof globalThis.Worker === "function";

    // ── IndexedDB probe ──
    const dbName = `__fortios_capability_probe_${Date.now()}`;
    try {
        const openReq = indexedDB.open(dbName, 1);
        await new Promise<void>((resolve, reject) => {
            openReq.onupgradeneeded = () => { openReq.result.createObjectStore("test"); };
            openReq.onsuccess = () => { openReq.result.close(); resolve(); };
            openReq.onerror = () => reject(new Error("IndexedDB open failed"));
        });
        await new Promise<void>((resolve, reject) => {
            const delReq = indexedDB.deleteDatabase(dbName);
            delReq.onsuccess = () => resolve();
            delReq.onerror = () => reject(new Error("IndexedDB delete failed"));
        });
        results.indexedDbProbe = "SUPPORTED";
    } catch (e) {
        results.indexedDbProbe = `UNSUPPORTED: ${e instanceof Error ? e.message : String(e)}`;
    }

    // ── WebCrypto probe ──
    try {
        const data = new TextEncoder().encode("fortios-capability-probe");
        await crypto.subtle.digest("SHA-256", data);
        results.webCryptoProbe = "SUPPORTED";
    } catch (e) {
        results.webCryptoProbe = `UNSUPPORTED: ${e instanceof Error ? e.message : String(e)}`;
    }

    // ── Blob fetch probe ──
    try {
        const blob = new Blob(["blob-probe-ok"], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const response = await fetch(url);
        const text = await response.text();
        URL.revokeObjectURL(url);
        results.blobFetchProbe = text === "blob-probe-ok" ? "SUPPORTED" : "UNSUPPORTED: content mismatch";
    } catch (e) {
        results.blobFetchProbe = `UNSUPPORTED: ${e instanceof Error ? e.message : String(e)}`;
    }

    // ── Blob worker probe ──
    try {
        const workerCode = "self.onmessage = () => self.postMessage('worker-probe-ok');";
        const blob = new Blob([workerCode], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        const worker = new Worker(url);
        const message = await new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("worker timed out")), 3000);
            worker.onmessage = (e) => { clearTimeout(timeout); resolve(e.data); };
            worker.onerror = (e) => { clearTimeout(timeout); reject(new Error(e.message)); };
            worker.postMessage("probe");
        });
        worker.terminate();
        URL.revokeObjectURL(url);
        results.blobWorkerProbe = message === "worker-probe-ok" ? "SUPPORTED" : "UNSUPPORTED: unexpected message";
    } catch (e) {
        results.blobWorkerProbe = `UNSUPPORTED: ${e instanceof Error ? e.message : String(e)}`;
    }

    return results;
}
