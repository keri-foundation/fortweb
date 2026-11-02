import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

test.beforeEach(() => {
    test.skip(process.env["FORTWEB_EXPECT_REGISTRY_BACKEND"] !== "1", "requires the local registry compatibility patch");
});

test("pinned browser KERIpy can generate and verify an anchored issuance update", async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    await page.route("**/app/runtime/wallet-worker.py", async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const dispatch = `    if method == "test.issuanceProbe":
        from keri.acdc import messaging, registraring, regeventing, webregbasing
        from keri.core import Noncer
        state = vaulting.require_open_state(params["vaultId"])
        hby = state["hby"]
        baser = webregbasing.WebRegBaser(name=state["vault"]["storageName"])
        await baser.reopen(storageOpener=_open_worker_storage)
        try:
            manager = registraring.Regery(hby=hby, baser=baser)
            registry = manager.registryByName("registry")
            hab = registry.hab
            acdc = messaging.acdcmap(israid=hab.pre, uuid=Noncer().qb64,
                                     regid=registry.regk, attribute={"d": "", "name": "Example"})
            blinder, update = registraring.Registrar(rgy=manager).issue(registry, acdc=acdc)
            hab.interact(data=[dict(i=registry.regk, s=update.sad["n"], d=update.said)],
                         version=_load_modules()["kering"].Vrsn_2_0,
                         gvrsn=_load_modules()["kering"].Vrsn_2_0)
            assert registry.anchorMsg(update.said)
            result = regeventing.vet(manager.store.seqEvent(registry.regk, 0), [update], db=hby.db,
                                     acdc=acdc, blinder=blinder.qb64)
            return {"state": result.state, "binding": result.binding, "sequence": registry.sn}
        finally:
            await baser.aclose(clear=True)
    if method.startswith("kf."):`;
        expect(source).toContain('    if method.startswith("kf."):');
        await route.fulfill({ response, body: source
            .replace('    "vaults.list",', '    "test.issuanceProbe",\n    "vaults.list",')
            .replace('    if method.startswith("kf."):', dispatch) });
    });
    await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    const request = (method: string, params: Record<string, unknown> = {}) => page.evaluate(
        ({ method, params }) => (window as any).webbaserProductionHarness.request(method, params), { method, params },
    );
    const vault = await request("vaults.create", { name: `issuance-probe-${Date.now()}`, passcode: "" });
    const vaultId = vault.vault.id;
    await request("vaults.open", { vaultId, passcode: "" });
    const issuer = await request("identifiers.create", { vaultId, alias: "issuer" });
    await request("registries.create", { vaultId, issuerAid: issuer.identifier.aid, name: "registry" });
    expect(await request("test.issuanceProbe", { vaultId })).toEqual({ state: "issued", binding: "mutual", sequence: 1 });
});

test("registered issuance survives vault and worker restarts", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const schema = readFileSync("playwright/fixtures/default-acdc-schema.json", "utf8");
    const schemaId = JSON.parse(schema).$id;
    let started = page.waitForEvent("worker");
    await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    let worker = await started;
    const request = (method: string, params: Record<string, unknown> = {}) => page.evaluate(
        ({ method, params }) => (window as any).webbaserProductionHarness.request(method, params), { method, params },
    );
    const source = await request("vaults.create", { name: `issuance-source-${Date.now()}`, passcode: "" });
    const vaultId = source.vault.id;
    await request("vaults.open", { vaultId, passcode: "" });
    const issuerAid = (await request("identifiers.create", { vaultId, alias: "issuer" })).identifier.aid;
    await request("vaults.close", { vaultId });
    const target = await request("vaults.create", { name: `issuance-target-${Date.now()}`, passcode: "" });
    const targetId = target.vault.id;
    await request("vaults.open", { vaultId: targetId, passcode: "" });
    const recipientAid = (await request("identifiers.create", { vaultId: targetId, alias: "recipient" })).identifier.aid;
    const recipient = await request("identifiers.export", { vaultId: targetId, aid: recipientAid });
    await request("vaults.close", { vaultId: targetId });
    await request("vaults.open", { vaultId, passcode: "" });
    await request("remotes.import", { vaultId, alias: "recipient", cesr: recipient.cesr });
    await request("schemas.import", { vaultId, schemaId, schema });
    const registry = (await request("registries.create", { vaultId, issuerAid, name: "registry" })).registry;
    const params = { vaultId, name: "registry", requestId: "issuance-1", issuerAid, recipientAid, schemaId, attributes: { name: "Example" } };
    for (const invalid of [
        { issuerAid: recipientAid }, { recipientAid: issuerAid }, { schemaId: "missing" },
        { name: "missing" }, { attributes: { i: issuerAid } },
    ]) {
        await expect(request("credentials.issueRegistered", { ...params, ...invalid })).rejects.toThrow();
    }
    const rival = await page.context().newPage();
    await rival.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
    await rival.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    await expect(rival.evaluate((params) => (window as any).webbaserProductionHarness.request("credentials.issueRegistered", params), params))
        .rejects.toThrow(/already open/);
    await rival.close();
    const issued = (await request("credentials.issueRegistered", params)).credential;
    expect(issued).toEqual(expect.objectContaining({ issuerAid, recipientAid, schemaId, registryId: registry.registryId, sequence: 1 }));
    expect((await request("credentials.issueRegistered", params)).credential).toEqual(issued);
    await expect(request("credentials.issueRegistered", { ...params, attributes: { name: "Changed" } })).rejects.toThrow(/already in use/);
    writeFileSync(testInfo.outputPath("issuance-initial.json"), JSON.stringify(issued));
    writeFileSync(testInfo.outputPath("schema.json"), schema);
    writeFileSync(testInfo.outputPath("expected.json"), JSON.stringify({ issuerAid, recipientAid, schemaId, registryId: registry.registryId }));
    await request("vaults.close", { vaultId });
    await request("vaults.open", { vaultId, passcode: "" });
    expect((await request("credentials.getIssued", { vaultId, name: "registry", requestId: "issuance-1" })).credential).toEqual(issued);
    const stopped = worker.waitForEvent("close");
    await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
    await stopped;
    started = page.waitForEvent("worker");
    await page.reload();
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    worker = await started;
    await request("vaults.open", { vaultId, passcode: "" });
    const restored = (await request("credentials.getIssued", { vaultId, name: "registry", requestId: "issuance-1" })).credential;
    expect(restored).toEqual(issued);
    writeFileSync(testInfo.outputPath("issuance-restored.json"), JSON.stringify(restored));
    const second = (await request("credentials.issueRegistered", { ...params, requestId: "issuance-2", attributes: { name: "Second" } })).credential;
    expect(second.sequence).toBe(2);
    const later = (await request("credentials.getIssued", { vaultId, name: "registry", requestId: "issuance-1" })).credential;
    expect(later.said).toBe(issued.said);
    expect(later.tel).toHaveLength(3);
    writeFileSync(testInfo.outputPath("issuance-later.json"), JSON.stringify(later));
    await request("vaults.close", { vaultId });
    const closed = worker.waitForEvent("close");
    await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
    await closed;
});

for (const [stage, needle, setup, retryable] of [
    ["before pending marker", '                    if not store.records.pin(keys="_fortweb_pending", val=registering.RegistryRecord(registryKey="pending")):', "", true],
    ["before TEL staging", "                        blinder, update = registraring.Registrar(rgy=manager).issue(reg, acdc=acdc)", "", false],
    ["before KEL anchor", '                        reg.hab.interact(data=[dict(i=reg.regk, s=update.sad["n"], d=update.said)],', "", false],
    ["after KEL anchor", "                        if not reg.anchorMsg(update.said):", "", false],
    ["before credential persistence", "                        record.update(registryId=reg.regk, sequence=reg.sn, blinder=blinder.qb64,", "", false],
    ["before vault flush", "                        await flush_open_state()", "", false],
    ["during credential sync", "                        await flush_open_state()", `                        class FailingHandle:
                            def __init__(self, handle): self.handle = handle
                            def get(self, key, default=None): return self.handle.get(key, default)
                            def __setitem__(self, key, value): self.handle[key] = value
                            async def sync(self): raise RuntimeError("injected credential sync failure")
                        state["hby"].db.db._stores["fwic."].handle = FailingHandle(state["hby"].db.db._stores["fwic."].handle)
`, false],
    ["after vault flush", "                        await baser.db.flush()\n                        records = validate()", "", false],
    ["after TEL flush", '                        if not store.records.rem(keys="_fortweb_pending"):', "", false],
    ["worker termination", '                        await _validate_open_kels(state["hby"].db, state["modules"], keeper=state["hby"].ks)', `                        import js
                        js.self.postMessage(json.dumps({"kind": "fortweb.runtime.diagnostic", "event": "issuance_test_paused"}))
                        await asyncio.sleep(120)
`, false],
    ...([ ["missing credential", "credentials.rem(keys='issuance')"],
          ["altered disclosure", "record['blinder'] = 'invalid'; credentials.pin(keys='issuance', val=_json_bytes(record))"],
          ["altered signature", "record['cesr'] = 'e30='; credentials.pin(keys='issuance', val=_json_bytes(record))"],
          ["altered schema", "record['schemaId'] = 'invalid'; credentials.pin(keys='issuance', val=_json_bytes(record))"],
          ["altered request fingerprint", "record['requestHash'] = '0' * 64; credentials.pin(keys='issuance', val=_json_bytes(record))"],
        ] as const).map(([label, damage]) => [`damaged ${label}`, "        def validate():", `        if method == "credentials.getIssued":
            record = json.loads(credentials.get(keys="issuance"))
            ${damage}
            await flush_open_state()
`, false] as const),
] as const) {
    test(`issuance interrupted ${stage} stays safe after restart`, async ({ page, baseURL }) => {
        test.setTimeout(180_000);
        await page.route("**/app/runtime/vaulting.py", async (route) => {
            const response = await route.fetch();
            const source = await response.text();
            expect(source).toContain(needle);
            await route.fulfill({ response, body: source.replace(needle,
                (setup || `${needle.match(/^ */)?.[0]}raise RuntimeError("injected issuance interruption")\n`) + needle) });
        });
        let started = page.waitForEvent("worker");
        await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
        await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
        let worker = await started;
        const request = (method: string, params: Record<string, unknown> = {}) => page.evaluate(
            ({ method, params }) => (window as any).webbaserProductionHarness.request(method, params), { method, params },
        );
        const source = await request("vaults.create", { name: `issuance-failure-${Date.now()}`, passcode: "" });
        const vaultId = source.vault.id;
        await request("vaults.open", { vaultId, passcode: "" });
        const issuerAid = (await request("identifiers.create", { vaultId, alias: "issuer" })).identifier.aid;
        await request("vaults.close", { vaultId });
        const target = await request("vaults.create", { name: `issuance-failure-target-${Date.now()}`, passcode: "" });
        const targetId = target.vault.id;
        await request("vaults.open", { vaultId: targetId, passcode: "" });
        const recipientAid = (await request("identifiers.create", { vaultId: targetId, alias: "recipient" })).identifier.aid;
        const recipient = await request("identifiers.export", { vaultId: targetId, aid: recipientAid });
        await request("vaults.close", { vaultId: targetId });
        await request("vaults.open", { vaultId, passcode: "" });
        await request("remotes.import", { vaultId, alias: "recipient", cesr: recipient.cesr });
        const schema = readFileSync("playwright/fixtures/default-acdc-schema.json", "utf8");
        const schemaId = JSON.parse(schema).$id;
        await request("schemas.import", { vaultId, schemaId, schema });
        await request("registries.create", { vaultId, issuerAid, name: "registry" });
        const params = { vaultId, name: "registry", requestId: "issuance", issuerAid, recipientAid, schemaId, attributes: { name: "Example" } };
        if (stage.startsWith("damaged")) {
            expect((await request("credentials.issueRegistered", params)).credential.sequence).toBe(1);
            await expect(request("credentials.getIssued", { vaultId, name: "registry", requestId: "issuance" })).rejects.toThrow(/invalid or incomplete/);
        } else if (stage === "worker termination") {
            await page.evaluate((params) => {
                void (window as any).webbaserProductionHarness.request("credentials.issueRegistered", params).catch(() => {});
            }, params);
            await page.waitForFunction(() => (window as any).webbaserProductionHarness.diagnostics()
                .some((message: { message: string }) => message.message.includes("issuance_test_paused")));
        } else {
            await expect(request("credentials.issueRegistered", params)).rejects.toThrow();
        }
        const stopped = worker.waitForEvent("close");
        await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
        await stopped;
        await page.unroute("**/app/runtime/vaulting.py");
        started = page.waitForEvent("worker");
        await page.reload();
        await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
        worker = await started;
        await request("vaults.open", { vaultId, passcode: "" });
        if (retryable) {
            await expect(request("credentials.getIssued", { vaultId, name: "registry", requestId: "issuance" })).rejects.toThrow(/not found/);
            expect((await request("credentials.issueRegistered", params)).credential.sequence).toBe(1);
        } else if (stage.startsWith("damaged")) {
            await expect(request("credentials.getIssued", { vaultId, name: "registry", requestId: "issuance" })).rejects.toThrow(/invalid or incomplete/);
            await expect(request("credentials.issueRegistered", params)).rejects.toThrow(/invalid or incomplete/);
        } else {
            await expect(request("credentials.getIssued", { vaultId, name: "registry", requestId: "issuance" })).rejects.toThrow(/incomplete.*recovery/);
            await expect(request("credentials.issueRegistered", params)).rejects.toThrow(/incomplete.*recovery/);
        }
        await request("vaults.close", { vaultId });
        const closed = worker.waitForEvent("close");
        await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
        await closed;
    });
}
