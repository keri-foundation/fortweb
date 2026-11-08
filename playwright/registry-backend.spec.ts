import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";

test("unpatched browser runtime rejects registry operations without interrupting the vault", async ({ page, baseURL }) => {
    test.skip(process.env["FORTWEB_EXPECT_REGISTRY_BACKEND"] === "1", "requires the unpatched runtime");
    test.setTimeout(180_000);
    await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    const request = (method: string, params: Record<string, unknown> = {}) => page.evaluate(
        ({ method, params }) => (window as any).webbaserProductionHarness.request(method, params), { method, params },
    );
    const vault = await request("vaults.create", { name: `registry-unsupported-${Date.now()}`, passcode: "" });
    const vaultId = vault.vault.id;
    await request("vaults.open", { vaultId, passcode: "" });
    const issuer = await request("identifiers.create", { vaultId, alias: "issuer" });
    await expect(request("registries.create", { vaultId, issuerAid: issuer.identifier.aid, name: "registry" }))
        .rejects.toThrow(/does not support browser registries/);
    expect((await request("identifiers.list", { vaultId })).identifiers).toHaveLength(1);
    await request("vaults.close", { vaultId });
});

test("browser registry stores aliases and ordered KEL values and rejects unopened backends", async ({ page, baseURL }) => {
    test.skip(process.env["FORTWEB_EXPECT_REGISTRY_BACKEND"] !== "1", "requires the local registry compatibility patch");
    test.setTimeout(180_000);
    await page.route("**/app/runtime/wallet-worker.py", async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const dispatch = `    if method == "test.registryBackend":
        from keri.acdc import registering, registraring, webregbasing
        from keri.db import koming, subing, webdbing
        state = vaulting.require_open_state(params["vaultId"])
        baser = webregbasing.WebRegBaser(name=state["vault"]["storageName"] + "-probe")
        await baser.reopen(storageOpener=_open_worker_storage)
        try:
            records = koming.Komer(db=baser, subkey="regs.", klas=registering.RegistryRecord)
            records.pin(keys="alias", val=registering.RegistryRecord(registryKey="registry-test"))
            await baser.aclose()
            await baser.reopen(storageOpener=_open_worker_storage)
            records = koming.Komer(db=baser, subkey="regs.", klas=registering.RegistryRecord)
            assert records.get(keys="alias").registryKey == "registry-test"
            try:
                registraring.Regery(hby=state["hby"], baser=webregbasing.WebRegBaser(name="unopened"))
            except _load_modules()["kering"].ConfigurationError:
                guarded = True
            else:
                guarded = False
            temp = await webdbing.WebDBer.open(name="ordered-kel-probe", stores=["kels."], storageOpener=vaulting._open_transient_storage)
            try:
                kels = subing.OnIoSetSuber(db=temp, subkey="kels.")
                kels.add(keys="aid", on=0, val="first")
                kels.add(keys="aid", on=1, val="older")
                kels.add(keys="aid", on=1, val="latest")
                kels.add(keys="aid", on=2, val="next")
                return {"guarded": guarded, "last": list(kels.getLastIter(keys="aid", on=1))}
            finally:
                temp.close()
        finally:
            await baser.aclose(clear=True)
    if method.startswith("kf."):`;
        await route.fulfill({ response, body: source
            .replace('    "vaults.list",', '    "test.registryBackend",\n    "vaults.list",')
            .replace('    if method.startswith("kf."):', dispatch) });
    });
    await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    const request = (method: string, params: Record<string, unknown> = {}) => page.evaluate(
        ({ method, params }) => (window as any).webbaserProductionHarness.request(method, params), { method, params },
    );
    const created = await request("vaults.create", { name: `registry-backend-${Date.now()}`, passcode: "" });
    const vaultId = created.vault.id;
    await request("vaults.open", { vaultId, passcode: "" });
    expect(await request("test.registryBackend", { vaultId })).toEqual({ guarded: true, last: ["latest", "next"] });
    await request("vaults.close", { vaultId });
});

test("protected registry inception survives vault and worker restarts", async ({ page, baseURL }, testInfo) => {
    test.skip(process.env["FORTWEB_EXPECT_REGISTRY_BACKEND"] !== "1", "requires the local registry compatibility patch");
    test.setTimeout(180_000);
    let started = page.waitForEvent("worker");
    await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    let worker = await started;
    const request = (method: string, params: Record<string, unknown> = {}) => page.evaluate(
        ({ method, params }) => (window as any).webbaserProductionHarness.request(method, params), { method, params },
    );
    const created = await request("vaults.create", { name: `registry-vault-${Date.now()}`, passcode: "" });
    const vaultId = created.vault.id;
    await request("vaults.open", { vaultId, passcode: "" });
    const issuer = await request("identifiers.create", { vaultId, alias: "issuer" });
    const issuerAid = issuer.identifier.aid;
    await expect(request("registries.create", { vaultId, issuerAid: "missing", name: "registry" })).rejects.toThrow(/not found/i);
    const rival = await page.context().newPage();
    await rival.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
    await rival.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    await expect(rival.evaluate(({ vaultId, issuerAid }) => (window as any).webbaserProductionHarness.request(
        "registries.create", { vaultId, issuerAid, name: "rival" },
    ), { vaultId, issuerAid })).rejects.toThrow(/already open/);
    await rival.close();
    const registry = (await request("registries.create", { vaultId, issuerAid, name: "registry" })).registry;
    expect(registry).toEqual(expect.objectContaining({ name: "registry", issuerAid }));
    writeFileSync(testInfo.outputPath("registry-initial.json"), JSON.stringify(registry));
    await expect(request("registries.create", { vaultId, issuerAid, name: "registry" })).rejects.toThrow(/already exists/);
    await request("vaults.close", { vaultId });
    await request("vaults.open", { vaultId, passcode: "" });
    expect((await request("registries.get", { vaultId, name: "registry" })).registry).toEqual(registry);
    const stopped = worker.waitForEvent("close");
    await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
    await stopped;
    started = page.waitForEvent("worker");
    await page.reload();
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    worker = await started;
    await request("vaults.open", { vaultId, passcode: "" });
    const recovered = (await request("registries.get", { vaultId, name: "registry" })).registry;
    expect(recovered).toEqual(registry);
    writeFileSync(testInfo.outputPath("registry-recovered.json"), JSON.stringify(recovered));
    const second = (await request("registries.create", { vaultId, issuerAid, name: "second" })).registry;
    expect(second.registryId).not.toBe(registry.registryId);
    expect((await request("registries.get", { vaultId, name: "registry" })).registry.registryId).toBe(registry.registryId);
    await request("vaults.close", { vaultId });
    const closed = worker.waitForEvent("close");
    await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
    await closed;
});

for (const [stage, needle, setup] of [
    ["before pending marker sync", '                await baser.db.flush()\n                reg = manager.makeRegistry(name=name, prefix=issuer)', ""],
    ["during pending marker sync", '                await baser.db.flush()\n                reg = manager.makeRegistry(name=name, prefix=issuer)', `                class FailingMarker:
                    def __init__(self, handle): self.handle = handle
                    def get(self, key, default=None): return self.handle.get(key, default)
                    def __setitem__(self, key, value): raise RuntimeError("injected marker write failure")
                    async def sync(self): await self.handle.sync()
                baser.db._stores["regs."].handle = FailingMarker(baser.db._stores["regs."].handle)
`],
    ["before anchoring", '                reg = manager.makeRegistry(name=name, prefix=issuer)', ""],
    ["with missing-anchor escrow", '                rip = store.event(reg.regk)', ""],
    ["after signing before KEL persistence", '                await flush_open_state()', ""],
    ["after KEL persistence", '                await baser.db.flush()\n                validate()', ""],
    ["during TEL sync", '                await baser.db.flush()\n                validate()', `                class FailingHandle:
                    def __init__(self, handle): self.handle = handle
                    def get(self, key, default=None): return self.handle.get(key, default)
                    def __setitem__(self, key, value): self.handle[key] = value
                    async def sync(self): raise RuntimeError("injected TEL sync failure")
                baser.db._stores["tels."].handle = FailingHandle(baser.db._stores["tels."].handle)
`],
    ["after TEL persistence", '                if not store.records.rem(keys="_fortweb_pending"):', ""],
] as const) {
    test(`interrupted registry ${stage} is safe after worker restart`, async ({ page, baseURL }) => {
        test.skip(process.env["FORTWEB_EXPECT_REGISTRY_BACKEND"] !== "1", "requires the local registry compatibility patch");
        test.setTimeout(180_000);
        await page.route("**/app/runtime/vaulting.py", async (route) => {
            const response = await route.fetch();
            const source = await response.text();
            expect(source).toContain(needle);
            await route.fulfill({ response, body: source.replace(needle,
                (setup || '                raise RuntimeError("injected registry interruption")\n') + needle) });
        });
        let started = page.waitForEvent("worker");
        await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
        await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
        const worker = await started;
        const request = (method: string, params: Record<string, unknown> = {}) => page.evaluate(
            ({ method, params }) => (window as any).webbaserProductionHarness.request(method, params), { method, params },
        );
        const created = await request("vaults.create", { name: `registry-failure-${Date.now()}`, passcode: "" });
        const vaultId = created.vault.id;
        await request("vaults.open", { vaultId, passcode: "" });
        const issuer = await request("identifiers.create", { vaultId, alias: "issuer" });
        await expect(request("registries.create", { vaultId, issuerAid: issuer.identifier.aid, name: "registry" })).rejects.toThrow();
        const stopped = worker.waitForEvent("close");
        await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
        await stopped;
        await page.unroute("**/app/runtime/vaulting.py");
        started = page.waitForEvent("worker");
        await page.reload();
        await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
        await started;
        await request("vaults.open", { vaultId, passcode: "" });
        if (stage === "during pending marker sync") {
            await expect(request("registries.get", { vaultId, name: "registry" })).rejects.toThrow(/not found/i);
            expect((await request("registries.create", { vaultId, issuerAid: issuer.identifier.aid, name: "registry" })).registry.registryId).toBeTruthy();
        } else {
            await expect(request("registries.get", { vaultId, name: "registry" })).rejects.toThrow(/incomplete.*recovery/);
            await expect(request("registries.create", { vaultId, issuerAid: issuer.identifier.aid, name: "registry" })).rejects.toThrow(/incomplete.*recovery/);
        }
        await request("vaults.close", { vaultId });
    });
}

for (const [damage, injection] of [
    ["missing TEL index", 'baser.tels.rem(keys=params["registryId"], on=0)'],
    ["conflicting TEL index", 'baser.tels.pin(keys=params["registryId"], on=0, val=state["modules"]["coring"].Saider(qb64=state["modules"]["coring"].Diger(ser=b"conflict").qb64))'],
    ["missing anchor", 'baser.ancs.rem(keys=params["registryId"])'],
    ["missing event", 'baser.evts.rem(keys=params["registryId"])'],
    ["wrong anchor", 'old = baser.ancs.get(keys=params["registryId"])\n        baser.ancs.pin(keys=params["registryId"], val=(old[0], state["modules"]["coring"].Diger(ser=b"wrong")))'],
    ["wrong issuer anchor", 'other = state["hby"].habByName("attacker")\n        baser.ancs.pin(keys=params["registryId"], val=(state["modules"]["coring"].Number(num=other.kever.sn), state["modules"]["coring"].Diger(qb64=other.kever.serder.said)))'],
] as const) {
    test(`registry reopening rejects ${damage}`, async ({ page, baseURL }) => {
        test.skip(process.env["FORTWEB_EXPECT_REGISTRY_BACKEND"] !== "1", "requires the local registry compatibility patch");
        test.setTimeout(180_000);
        let started = page.waitForEvent("worker");
        await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
        await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
        const worker = await started;
        const request = (method: string, params: Record<string, unknown> = {}) => page.evaluate(
            ({ method, params }) => (window as any).webbaserProductionHarness.request(method, params), { method, params },
        );
        const vault = await request("vaults.create", { name: `registry-damage-${Date.now()}`, passcode: "" });
        const vaultId = vault.vault.id;
        await request("vaults.open", { vaultId, passcode: "" });
        const issuer = await request("identifiers.create", { vaultId, alias: "issuer" });
        const created = await request("registries.create", { vaultId, issuerAid: issuer.identifier.aid, name: "registry" });
        if (damage === "wrong issuer anchor") await request("identifiers.create", { vaultId, alias: "attacker" });
        const stopped = worker.waitForEvent("close");
        await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
        await stopped;
        await page.route("**/app/runtime/vaulting.py", async (route) => {
            const response = await route.fetch();
            const source = await response.text();
            const open = '    await baser.reopen(storageOpener=_CONFIG["storage_opener"])\n    try:';
            expect(source).toContain(open);
            await route.fulfill({ response, body: source.replace(open,
                '    await baser.reopen(storageOpener=_CONFIG["storage_opener"])\n    if method == "registries.get":\n        ' + injection + '\n        await baser.db.flush()\n    try:') });
        });
        started = page.waitForEvent("worker");
        await page.reload();
        await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
        await started;
        await request("vaults.open", { vaultId, passcode: "" });
        await expect(request("registries.get", { vaultId, name: "registry", registryId: created.registry.registryId }))
            .rejects.toThrow(/Registry (storage|inception|anchoring)/);
        await request("vaults.close", { vaultId });
    });
}

test("terminating a worker during registry inception leaves the registry incomplete", async ({ page, baseURL }) => {
    test.skip(process.env["FORTWEB_EXPECT_REGISTRY_BACKEND"] !== "1", "requires the local registry compatibility patch");
    test.setTimeout(180_000);
    await page.route("**/app/runtime/vaulting.py", async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const needle = '                await _validate_open_kels(state["hby"].db, state["modules"], keeper=state["hby"].ks)';
        expect(source).toContain(needle);
        const pause = '                import js\n                js.self.postMessage(json.dumps({"kind": "fortweb.runtime.diagnostic", "event": "registry_test_paused"}))\n                await asyncio.sleep(120)\n';
        await route.fulfill({ response, body: source.replace(needle, pause + needle) });
    });
    let started = page.waitForEvent("worker");
    await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    const worker = await started;
    const request = (method: string, params: Record<string, unknown> = {}) => page.evaluate(
        ({ method, params }) => (window as any).webbaserProductionHarness.request(method, params), { method, params },
    );
    const created = await request("vaults.create", { name: `registry-termination-${Date.now()}`, passcode: "" });
    const vaultId = created.vault.id;
    await request("vaults.open", { vaultId, passcode: "" });
    const issuer = await request("identifiers.create", { vaultId, alias: "issuer" });
    await page.evaluate(({ vaultId, issuerAid }) => {
        void (window as any).webbaserProductionHarness.request("registries.create", { vaultId, issuerAid, name: "registry" }).catch(() => {});
    }, { vaultId, issuerAid: issuer.identifier.aid });
    await page.waitForFunction(() => (window as any).webbaserProductionHarness.diagnostics()
        .some((message: { message: string }) => message.message.includes("registry_test_paused")));
    const stopped = worker.waitForEvent("close");
    await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
    await stopped;
    await page.unroute("**/app/runtime/vaulting.py");
    started = page.waitForEvent("worker");
    await page.reload();
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    await started;
    await request("vaults.open", { vaultId, passcode: "" });
    await expect(request("registries.get", { vaultId, name: "registry" })).rejects.toThrow(/incomplete.*recovery/);
    await request("vaults.close", { vaultId });
});
