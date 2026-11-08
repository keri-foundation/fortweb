import { expect, test } from "@playwright/test";

test("bundled worker creates an identifier without JavaScript evaluation", async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    await page.route("https://wallet-service.test/data", (route) => route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*", "cross-origin-resource-policy": "cross-origin" },
        contentType: "application/json",
        body: '{"value":42}',
    }));
    await page.route("**/csp-redirect-script", (route) => route.fulfill({
        status: 302, headers: { location: "https://wallet-service.test/remote.js" },
    }));
    await page.route("**/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", async (route) => {
        const response = await route.fetch();
        const probe = `<script nonce="csp-test">
            window.__cspProbe = (async () => {
                let evaluated = false;
                try { evaluated = (0, eval)("40+2") === 42; } catch {}
                const wasm = await WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0]));
                const text = await (await fetch('https://wallet-service.test/data')).text();
                const blocked = [];
                document.addEventListener('securitypolicyviolation', event => blocked.push(event.violatedDirective));
                let fetchedEvaluation = false, cleartextBlocked = false;
                try { fetchedEvaluation = (0, eval)('(' + text + ')').value === 42; } catch {}
                try { await fetch('http://wallet-service.test/data'); } catch { cleartextBlocked = true; }
                async function scriptBlocked(src) {
                    return await new Promise(resolve => {
                        const script = document.createElement('script');
                        script.onload = () => resolve(false);
                        script.onerror = () => resolve(true);
                        script.src = src;
                        document.head.append(script);
                    });
                }
                const remoteScriptBlocked = await scriptBlocked('https://wallet-service.test/remote.js');
                const redirectBlocked = await scriptBlocked('/csp-redirect-script');
                let remoteWorkerBlocked = false;
                try { new Worker('https://wallet-service.test/worker.js'); } catch { remoteWorkerBlocked = true; }
                const source = "onmessage=async()=>{let blocked=false;try{eval('40+2')}catch{blocked=true};" +
                    "const w=await WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0]));postMessage({blocked,wasm:!!w})}";
                const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
                const worker = new Worker(url);
                const workerResult = await new Promise((resolve, reject) => {
                    worker.onmessage = event => resolve(event.data);
                    worker.onerror = reject;
                    worker.postMessage('go');
                });
                worker.terminate(); URL.revokeObjectURL(url);
                return { evaluated, wasm: !!wasm, data: JSON.parse(text).value, fetchedEvaluation,
                    cleartextBlocked, remoteScriptBlocked, redirectBlocked, remoteWorkerBlocked, workerResult,
                    scriptPolicyViolation: blocked.some(value => value.startsWith('script-src')),
                    connectPolicyViolation: blocked.some(value => value.startsWith('connect-src')) };
            })();
        </script>`;
        const body = (await response.text()).replace(
            '<script type="module">', `${probe}<script nonce="csp-test" type="module">`,
        );
        await route.fulfill({
            response,
            headers: {
                ...response.headers(),
                "content-security-policy": "default-src 'none'; script-src 'self' 'nonce-csp-test' 'wasm-unsafe-eval'; " +
                    "worker-src 'self' blob:; connect-src 'self' https:; style-src 'unsafe-inline'",
            },
            body,
        });
    });
    await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);

    const policy = await page.evaluate(() => (window as any).__cspProbe);
    expect(policy).toEqual({
        evaluated: false, wasm: true, data: 42, fetchedEvaluation: false,
        cleartextBlocked: true, remoteScriptBlocked: true, redirectBlocked: true,
        remoteWorkerBlocked: true, workerResult: { blocked: true, wasm: true }, scriptPolicyViolation: true,
        connectPolicyViolation: true,
    });

    const request = (method: string, params: Record<string, unknown> = {}) => page.evaluate(
        ({ method, params }) => (window as any).webbaserProductionHarness.request(method, params), { method, params },
    );
    const vault = await request("vaults.create", { name: `csp-${Date.now()}`, passcode: "synthetic-csp-passcode" });
    const vaultId = vault.vault.id;
    await request("vaults.open", { vaultId, passcode: "synthetic-csp-passcode" });
    const identifier = await request("identifiers.create", { vaultId, alias: "csp-test" });
    expect(identifier.identifier.aid).toBeTruthy();
    await request("vaults.close", { vaultId });
});

test("application entrypoint enforces its policy", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await page.route("**/fortweb/app/csp-entry-probe.js", (route) => route.fulfill({
        contentType: "text/javascript",
        body: `window.__entryCspProbe = (async () => {
            let evaluated = false;
            try { evaluated = (0, eval)('40+2') === 42; } catch {}
            const wasm = await WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0]));
            return { evaluated, wasm: !!wasm };
        })();`,
    }));
    await page.goto(new URL("/fortweb/app/index.html", baseURL).toString());
    await page.waitForFunction(() => (document.querySelector("#app-root")?.children.length ?? 0) > 0);
    await page.evaluate(() => {
        const script = document.createElement("script");
        script.src = "/fortweb/app/csp-entry-probe.js";
        document.head.append(script);
    });
    await page.waitForFunction(() => "__entryCspProbe" in window);
    expect(await page.evaluate(() => (window as any).__entryCspProbe)).toEqual({ evaluated: false, wasm: true });
});
