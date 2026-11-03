import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

test.beforeEach(() => {
    test.skip(process.env["FORTWEB_EXPECT_REGISTRY_BACKEND"] !== "1", "requires the local registry compatibility patch");
});

test("recipient API is disabled in the ordinary runtime", async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    const request = (method: string, params: Record<string, unknown> = {}) => page.evaluate(
        ({ method, params }) => (window as any).webbaserProductionHarness.request(method, params), { method, params },
    );
    const vaultId = (await request("vaults.create", { name: `synthetic-disabled-${Date.now()}`, passcode: "" })).vault.id;
    await request("vaults.open", { vaultId, passcode: "" });
    await expect(request("credentials.getReceived", { vaultId, said: "missing", syntheticOnly: true })).rejects.toThrow(/synthetic/);
    await request("vaults.close", { vaultId });
});

test("synthetic recipient verifies and retains independent issuance evidence", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    await page.route("**/pyscript-ci.toml", async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: `fort_synthetic_recipient_testing = true\n${await response.text()}` });
    });
    await page.route("**/app/runtime/wallet-worker.py", async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const dispatch = `    if method == "test.receiptStorage":
        from keri.core import signing
        state = vaulting.require_open_state(params["vaultId"])
        store = state["hby"].db._stores["fwrc."]
        values = list(state["modules"]["webdbing"]._deserialize_records(store.handle.get("__records__")).values())
        try:
            signing.Decrypter(seed=signing.Signer().qb64).decrypt(qb64=values[0], bare=True)
            wrong_key_rejected = False
        except Exception:
            wrong_key_rejected = True
        return {"containsName": any(b"Synthetic Example" in val for val in values),
                "containsBlinder": any(params["blinder"].encode() in val for val in values),
                "hasData": bool(values), "wrongKeyRejected": wrong_key_rejected}
    if method == "test.corruptReceipt":
        from keri.db import subing
        state = vaulting.require_open_state(params["vaultId"])
        subing.Suber(db=state["hby"].db, subkey="fwrc.").pin(keys=params["said"], val="invalid")
        await state["hby"].db.flush()
        return {"corrupted": True}
    if method == "test.wrongSignature":
        state = vaulting.require_open_state(params["vaultId"])
        serder = state["modules"]["serdering"].SerderACDC(raw=base64.b64decode(params["cesr"], validate=True))
        signer = state["hby"].habByPre(params["recipientAid"])
        proof = signer.endorse(serder, gvrsn=state["modules"]["kering"].Vrsn_2_0)
        return {"cesr": base64.b64encode(proof).decode("ascii")}
    if method.startswith("kf."):`;
        await route.fulfill({ response, body: source.replace('    "vaults.list",', '    "test.receiptStorage",\n    "test.corruptReceipt",\n    "test.wrongSignature",\n    "vaults.list",')
            .replace('    if method.startswith("kf."):', dispatch) });
    });
    let started = page.waitForEvent("worker");
    await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    let worker = await started;
    const request = (method: string, params: Record<string, unknown> = {}) => page.evaluate(
        ({ method, params }) => (window as any).webbaserProductionHarness.request(method, params), { method, params },
    );
    const schema = readFileSync("playwright/fixtures/default-acdc-schema.json", "utf8");
    const schemaId = JSON.parse(schema).$id;
    const sourceId = (await request("vaults.create", { name: `synthetic-issuer-${Date.now()}`, passcode: "test-issuer-passcode" })).vault.id;
    await request("vaults.open", { vaultId: sourceId, passcode: "test-issuer-passcode" });
    const issuerAid = (await request("identifiers.create", { vaultId: sourceId, alias: "issuer" })).identifier.aid;
    await request("vaults.close", { vaultId: sourceId });
    const vaultId = (await request("vaults.create", { name: `synthetic-recipient-${Date.now()}`, passcode: "test-recipient-passcode" })).vault.id;
    await request("vaults.open", { vaultId, passcode: "test-recipient-passcode" });
    const recipientAid = (await request("identifiers.create", { vaultId, alias: "recipient" })).identifier.aid;
    const recipient = await request("identifiers.export", { vaultId, aid: recipientAid });
    await request("schemas.import", { vaultId, schemaId, schema });
    await request("vaults.close", { vaultId });
    await request("vaults.open", { vaultId: sourceId, passcode: "test-issuer-passcode" });
    await request("remotes.import", { vaultId: sourceId, alias: "recipient", cesr: recipient.cesr });
    await request("schemas.import", { vaultId: sourceId, schemaId, schema });
    const registryId = (await request("registries.create", { vaultId: sourceId, issuerAid, name: "registry" })).registry.registryId;
    const issue = { vaultId: sourceId, name: "registry", issuerAid, recipientAid, schemaId };
    const early = (await request("credentials.issueRegistered", { ...issue, requestId: "first", attributes: { name: "Synthetic Example" } })).credential;
    await request("credentials.issueRegistered", { ...issue, requestId: "second", attributes: { name: "Synthetic Second" } });
    const latest = (await request("credentials.getIssued", { vaultId: sourceId, name: "registry", requestId: "first" })).credential;
    await request("vaults.close", { vaultId: sourceId });
    await request("vaults.open", { vaultId, passcode: "test-recipient-passcode" });
    const params = { vaultId, issuerAid, recipientAid, schemaId, syntheticOnly: true, evidence: latest };
    await expect(request("credentials.receive", { ...params, syntheticOnly: false })).rejects.toThrow(/synthetic/);
    const rival = await page.context().newPage();
    await rival.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
    await rival.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    await expect(rival.evaluate((params) => (window as any).webbaserProductionHarness.request("credentials.receive", params), params))
        .rejects.toThrow(/already open/);
    await rival.close();
    const wrongSignature = await request("test.wrongSignature", { vaultId, recipientAid, cesr: latest.cesr });
    const truncatedKel = Buffer.from(latest.kel, "base64").subarray(0, -20).toString("base64");
    const trailingTel = [...latest.tel];
    trailingTel[1] = Buffer.concat([Buffer.from(trailingTel[1], "base64"), Buffer.from("extra")]).toString("base64");
    for (const bad of [
        { ...latest, cesr: "e30=" }, { ...latest, cesr: wrongSignature.cesr },
        { ...latest, kel: "" }, { ...latest, kel: truncatedKel }, { ...latest, blinder: "invalid" },
        { ...latest, blinder: "" }, { ...latest, registryId: "invalid" },
        { ...latest, tel: latest.tel.slice(0, 1) }, { ...latest, tel: trailingTel }, { ...latest, head: "invalid" },
    ]) await expect(request("credentials.receive", { ...params, evidence: bad })).rejects.toThrow();
    await expect(request("credentials.receive", { ...params, recipientAid: issuerAid })).rejects.toThrow();
    await expect(request("credentials.receive", { ...params, issuerAid: recipientAid })).rejects.toThrow();
    await expect(request("credentials.receive", { ...params, schemaId: "missing" })).rejects.toThrow();
    const accepted = await request("credentials.receive", params);
    expect(accepted.credential).toEqual(expect.objectContaining({ said: early.said, issuerAid, recipientAid, schemaId, registryId,
        integrity: "verified", issuerSignature: "verified", issuance: "verified", headSequence: 2, headState: "blinded", currentStatus: "unknown" }));
    expect((await request("credentials.receive", { ...params, evidence: early })).credential.headSequence).toBe(2);
    expect((await request("credentials.receive", params)).credential).toEqual(accepted.credential);
    expect(await request("test.receiptStorage", { vaultId, blinder: latest.blinder })).toEqual({ containsName: false, containsBlinder: false, hasData: true, wrongKeyRejected: true });
    writeFileSync(testInfo.outputPath("issuance-initial.json"), JSON.stringify(accepted.evidence));
    writeFileSync(testInfo.outputPath("schema.json"), schema);
    writeFileSync(testInfo.outputPath("expected.json"), JSON.stringify({ issuerAid, recipientAid, schemaId, registryId }));
    await request("vaults.close", { vaultId });
    await expect(request("vaults.open", { vaultId, passcode: "incorrect-test-passcode" })).rejects.toThrow();
    await request("vaults.open", { vaultId, passcode: "test-recipient-passcode" });
    expect((await request("credentials.getReceived", { vaultId, said: early.said, syntheticOnly: true })).credential).toEqual(accepted.credential);
    const stopped = worker.waitForEvent("close");
    await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
    await stopped;
    started = page.waitForEvent("worker");
    await page.reload();
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    worker = await started;
    await request("vaults.open", { vaultId, passcode: "test-recipient-passcode" });
    const recovered = await request("credentials.getReceived", { vaultId, said: early.said, syntheticOnly: true });
    expect(recovered.credential).toEqual(accepted.credential);
    writeFileSync(testInfo.outputPath("issuance-restored.json"), JSON.stringify(recovered.evidence));
    writeFileSync(testInfo.outputPath("issuance-later.json"), JSON.stringify(recovered.evidence));
    await request("test.corruptReceipt", { vaultId, said: early.said });
    await expect(request("credentials.getReceived", { vaultId, said: early.said, syntheticOnly: true })).rejects.toThrow(/invalid or incomplete/);
    await request("vaults.close", { vaultId });
    await request("vaults.open", { vaultId, passcode: "test-recipient-passcode" });
    await expect(request("credentials.getReceived", { vaultId, said: early.said, syntheticOnly: true })).rejects.toThrow(/invalid or incomplete/);
    await request("vaults.close", { vaultId });
    const insecure = (await request("vaults.create", { name: `synthetic-no-passcode-${Date.now()}`, passcode: "" })).vault.id;
    await request("vaults.open", { vaultId: insecure, passcode: "" });
    await expect(request("credentials.receive", { ...params, vaultId: insecure })).rejects.toThrow(/passcode-protected/);
    await request("vaults.close", { vaultId: insecure });
    const closed = worker.waitForEvent("close");
    await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
    await closed;
});

test("synthetic IPEX grant and admit retain the verified credential exchange", async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    await page.route("**/pyscript-ci.toml", async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: `fort_synthetic_recipient_testing = true\n${await response.text()}` });
    });
    await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    const request = (method: string, params: Record<string, unknown> = {}) => page.evaluate(
        ({ method, params }) => (window as any).webbaserProductionHarness.request(method, params), { method, params },
    );
    const schema = readFileSync("playwright/fixtures/default-acdc-schema.json", "utf8");
    const schemaId = JSON.parse(schema).$id;
    const sourceId = (await request("vaults.create", { name: `ipex-issuer-${Date.now()}`, passcode: "test-issuer-passcode" })).vault.id;
    await request("vaults.open", { vaultId: sourceId, passcode: "test-issuer-passcode" });
    const issuerAid = (await request("identifiers.create", { vaultId: sourceId, alias: "issuer" })).identifier.aid;
    const issuer = await request("identifiers.export", { vaultId: sourceId, aid: issuerAid });
    await request("vaults.close", { vaultId: sourceId });
    const recipientId = (await request("vaults.create", { name: `ipex-recipient-${Date.now()}`, passcode: "test-recipient-passcode" })).vault.id;
    await request("vaults.open", { vaultId: recipientId, passcode: "test-recipient-passcode" });
    const recipientAid = (await request("identifiers.create", { vaultId: recipientId, alias: "recipient" })).identifier.aid;
    const recipient = await request("identifiers.export", { vaultId: recipientId, aid: recipientAid });
    await request("schemas.import", { vaultId: recipientId, schemaId, schema });
    await request("remotes.import", { vaultId: recipientId, alias: "issuer", cesr: issuer.cesr });
    await request("vaults.close", { vaultId: recipientId });
    await request("vaults.open", { vaultId: sourceId, passcode: "test-issuer-passcode" });
    await request("remotes.import", { vaultId: sourceId, alias: "recipient", cesr: recipient.cesr });
    await request("schemas.import", { vaultId: sourceId, schemaId, schema });
    await request("registries.create", { vaultId: sourceId, issuerAid, name: "registry" });
    await request("credentials.issueRegistered", {
        vaultId: sourceId, name: "registry", requestId: "credential", issuerAid, recipientAid, schemaId,
        attributes: { name: "Synthetic IPEX Example" },
    });
    const grant = await request("ipex.grant", {
        vaultId: sourceId, name: "registry", requestId: "credential", syntheticOnly: true, message: "Credential grant",
    });
    expect(grant.exchange).toEqual(expect.objectContaining({ route: "/ipex/grant", senderAid: issuerAid, recipientAid }));
    await request("vaults.close", { vaultId: sourceId });
    await request("vaults.open", { vaultId: recipientId, passcode: "test-recipient-passcode" });
    const received = await request("ipex.receive", {
        vaultId: recipientId, syntheticOnly: true, cesr: grant.exchange.cesr, evidence: grant.evidence,
    });
    expect(received).toEqual(expect.objectContaining({
        exchange: expect.objectContaining({ said: grant.exchange.said, route: "/ipex/grant" }),
        credential: expect.objectContaining({ said: grant.evidence.said, issuance: "verified" }),
    }));
    await expect(request("ipex.receive", { vaultId: recipientId, syntheticOnly: true, cesr: "e30=" })).rejects.toThrow();
    expect((await request("ipex.get", { vaultId: recipientId, syntheticOnly: true, said: grant.exchange.said })).exchange)
        .toEqual(expect.objectContaining({ route: "/ipex/grant" }));
    const admit = await request("ipex.admit", {
        vaultId: recipientId, syntheticOnly: true, grantSaid: grant.exchange.said, message: "Credential admitted",
    });
    expect(admit.exchange).toEqual(expect.objectContaining({ route: "/ipex/admit", prior: grant.exchange.said }));
    await request("vaults.close", { vaultId: recipientId });
    await request("vaults.open", { vaultId: sourceId, passcode: "test-issuer-passcode" });
    const admitted = await request("ipex.receive", { vaultId: sourceId, syntheticOnly: true, cesr: admit.exchange.cesr });
    expect(admitted.exchange).toEqual(expect.objectContaining({ said: admit.exchange.said, route: "/ipex/admit" }));
    expect((await request("ipex.get", { vaultId: sourceId, syntheticOnly: true, said: grant.exchange.said })).exchange)
        .toEqual(expect.objectContaining({ response: admit.exchange.said }));
    await request("vaults.close", { vaultId: sourceId });
    await request("vaults.open", { vaultId: recipientId, passcode: "test-recipient-passcode" });
    expect((await request("ipex.get", { vaultId: recipientId, syntheticOnly: true, said: grant.exchange.said })).exchange)
        .toEqual(expect.objectContaining({ route: "/ipex/grant", response: admit.exchange.said }));
    await request("vaults.close", { vaultId: recipientId });
});

for (const [stage, needle, setup, retryable] of [
    ["before marker", '    if not records.put(keys="_pending", val="pending"):', "", true],
    ["before ciphertext", "        cipher = manager.encrypter.encrypt(ser=_json_bytes(record)).qb64", "", false],
    ["during ciphertext sync", '        await flush_open_state()\n        if not records.rem(keys="_pending"):', `        class FailingHandle:
            def __init__(self, handle): self.handle = handle
            def get(self, key, default=None): return self.handle.get(key, default)
            def __setitem__(self, key, value): self.handle[key] = value
            async def sync(self):
                import js
                js.self.postMessage(json.dumps({"kind": "fortweb.runtime.diagnostic", "event": "receipt_sync_failed"}))
                raise RuntimeError("injected receipt sync failure")
        state["hby"].db._stores["fwrc."].handle = FailingHandle(state["hby"].db._stores["fwrc."].handle)
`, false],
    ["after ciphertext flush", '        if not records.rem(keys="_pending"):', "", false],
    ["worker termination", '        if not records.rem(keys="_pending"):', `        import js
        js.self.postMessage(json.dumps({"kind": "fortweb.runtime.diagnostic", "event": "receipt_test_paused"}))
        await asyncio.sleep(120)
`, false],
] as const) {
    test(`synthetic receipt interrupted ${stage} fails safely`, async ({ page, baseURL }) => {
        test.setTimeout(240_000);
        await page.route("**/pyscript-ci.toml", async (route) => {
            const response = await route.fetch();
            await route.fulfill({ response, body: `fort_synthetic_recipient_testing = true\n${await response.text()}` });
        });
        await page.route("**/app/runtime/vaulting.py", async (route) => {
            const response = await route.fetch();
            const source = await response.text();
            expect(source).toContain(needle);
            const indent = needle.match(/^ */)?.[0] ?? "";
            const failure = `${indent}import js\n${indent}js.self.postMessage(json.dumps({"kind": "fortweb.runtime.diagnostic", "event": "receipt_injected"}))\n${indent}raise RuntimeError("injected receipt interruption")\n`;
            await route.fulfill({ response, body: source.replace(needle,
                (setup || failure) + needle) });
        });
        let started = page.waitForEvent("worker");
        await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).toString());
        await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
        let worker = await started;
        const request = (method: string, params: Record<string, unknown> = {}) => page.evaluate(
            ({ method, params }) => (window as any).webbaserProductionHarness.request(method, params), { method, params },
        );
        const schema = readFileSync("playwright/fixtures/default-acdc-schema.json", "utf8");
        const schemaId = JSON.parse(schema).$id;
        const sourceId = (await request("vaults.create", { name: `receipt-source-${Date.now()}`, passcode: "test-issuer-passcode" })).vault.id;
        await request("vaults.open", { vaultId: sourceId, passcode: "test-issuer-passcode" });
        const issuerAid = (await request("identifiers.create", { vaultId: sourceId, alias: "issuer" })).identifier.aid;
        await request("vaults.close", { vaultId: sourceId });
        const vaultId = (await request("vaults.create", { name: `receipt-target-${Date.now()}`, passcode: "test-recipient-passcode" })).vault.id;
        await request("vaults.open", { vaultId, passcode: "test-recipient-passcode" });
        const recipientAid = (await request("identifiers.create", { vaultId, alias: "recipient" })).identifier.aid;
        const recipient = await request("identifiers.export", { vaultId, aid: recipientAid });
        await request("schemas.import", { vaultId, schemaId, schema });
        await request("vaults.close", { vaultId });
        await request("vaults.open", { vaultId: sourceId, passcode: "test-issuer-passcode" });
        await request("remotes.import", { vaultId: sourceId, alias: "recipient", cesr: recipient.cesr });
        await request("schemas.import", { vaultId: sourceId, schemaId, schema });
        await request("registries.create", { vaultId: sourceId, issuerAid, name: "registry" });
        const evidence = (await request("credentials.issueRegistered", { vaultId: sourceId, name: "registry", requestId: "first",
            issuerAid, recipientAid, schemaId, attributes: { name: "Synthetic Example" } })).credential;
        await request("vaults.close", { vaultId: sourceId });
        await request("vaults.open", { vaultId, passcode: "test-recipient-passcode" });
        const params = { vaultId, issuerAid, recipientAid, schemaId, syntheticOnly: true, evidence };
        if (stage === "worker termination") {
            await page.evaluate((params) => {
                void (window as any).webbaserProductionHarness.request("credentials.receive", params).catch(() => {});
            }, params);
            await page.waitForFunction(() => (window as any).webbaserProductionHarness.diagnostics()
                .some((message: { message: string }) => message.message.includes("receipt_test_paused")));
        } else {
            await expect(request("credentials.receive", params)).rejects.toThrow();
            const marker = stage === "during ciphertext sync" ? "receipt_sync_failed" : "receipt_injected";
            await page.waitForFunction((marker) => (window as any).webbaserProductionHarness.diagnostics()
                .some((message: { message: string }) => message.message.includes(marker)), marker);
        }
        const closed = worker.waitForEvent("close");
        await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
        await closed;
        await page.unroute("**/app/runtime/vaulting.py");
        started = page.waitForEvent("worker");
        await page.reload();
        await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
        worker = await started;
        await request("vaults.open", { vaultId, passcode: "test-recipient-passcode" });
        const get = { vaultId, said: evidence.said, syntheticOnly: true };
        if (retryable) {
            await expect(request("credentials.getReceived", get)).rejects.toThrow(/not found/);
            expect((await request("credentials.receive", params)).credential.said).toBe(evidence.said);
        } else {
            await expect(request("credentials.getReceived", get)).rejects.toThrow(/incomplete.*recovery/);
            await expect(request("credentials.receive", params)).rejects.toThrow(/incomplete.*recovery/);
        }
        await request("vaults.close", { vaultId });
        const stopped = worker.waitForEvent("close");
        await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
        await stopped;
    });
}
