import { expect, test } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

test("@slow Core SEDI presentation interoperates with independent native KERIpy", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const keripy = process.env["FORTWEB_SEDI_REFERENCE"];
    const python = process.env["FORTWEB_SEDI_PYTHON"];
    test.skip(!keripy || !python || process.env["FORTWEB_EXPECT_REGISTRY_BACKEND"] !== "1",
        "requires the SEDI reference checkout, native Python, and browser registry backend");
    const sha = (name: string) => createHash("sha256").update(readFileSync(path.join(keripy!, name))).digest("hex");
    expect(sha("src/keri/acdc/ipexing.py")).toBe("fadc924b0e48b3e3f8f82d0730f5f2e3b6938149a38915c9b43fee715e3a5806");
    expect(sha("tests/sedi/test_ipex_sedi.py")).toBe("0309bcc6c11a5da1754ad05939ce565c8fb6094e9f7db02e4310639963e7c9a2");
    await page.route("**/pyscript-ci.toml", async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: `fort_synthetic_recipient_testing = true\n${await response.text()}` });
    });
    await page.route("**/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", async route => {
        const response = await route.fetch();
        const body = (await response.text()).replace('<script type="module">', '<script nonce="csp-test" type="module">');
        await route.fulfill({ response, body, headers: { ...response.headers(),
            "content-security-policy": "default-src 'none'; script-src 'self' 'nonce-csp-test' 'wasm-unsafe-eval'; " +
                "worker-src 'self' blob:; connect-src 'self' https:; style-src 'unsafe-inline'" } });
    });
    await page.route("**/app/runtime/wallet-worker.py", async route => {
        const response = await route.fetch();
        const source = await response.text();
        const dispatch = `    if method == "test.signedState":
        import hashlib
        from keri.acdc import registering, webregbasing
        from keri.db import subing, webdbing
        state = vaulting.require_open_state(params["vaultId"])
        def hashes(db, names):
            return {name: hashlib.sha256(webdbing._serialize_records(db._stores[name].items).encode()).hexdigest()
                    for name in names if name in db._stores}
        reg = webregbasing.WebRegBaser(name=state["vault"]["storageName"])
        await reg.reopen(storageOpener=vaulting._CONFIG["storage_opener"])
        try:
            store = registering.RegistryStore(reg)
            events = []
            while event := store.seqEvent(params["registryId"], len(events)):
                events.append(event.said)
            hab = state["hby"].habByPre(params["holder"])
            return {"wallet": hashes(state["hby"].db, ("kels.", "evts.", "sigs.", "fwpn.", "fwrc.")),
                    "registry": hashes(reg.db, ("regs.", "tels.", "evts.", "ancs.", "heds.")),
                    "holderHead": [hab.kever.sn, hab.kever.serder.said], "tel": events,
                    "registryPending": store.records.get(keys="_fortweb_pending") is not None,
                    "receiptPending": subing.Suber(db=state["hby"].db, subkey="fwrc.").get(keys="_pending") is not None,
                    "bindings": subing.Suber(db=state["hby"].db, subkey="fwpn.").cnt()}
        finally:
            await reg.aclose()
    if method == "test.staleStatus":
        evidence = params["evidence"]
        state = vaulting.require_open_state(params["vaultId"])
        result, _, _ = await vaulting._verify_received_evidence(state, {
            "issuerAid": evidence["issuerAid"], "recipientAid": evidence["recipientAid"],
            "schemaId": evidence["schemaId"], "evidence": evidence,
        }, require_local_recipient=False)
        return {"status": result["currentStatus"], "statusSequence": result["statusSequence"],
                "headSequence": result["headSequence"]}
    if method == "test.expectCachedSchema":
        from keri.acdc import scheming
        original = scheming.validateSchema
        vaulting._sedi_test_schema_calls = []
        def checked(*args, **kwargs):
            db = kwargs.get("db")
            if getattr(db, "name", "") == "sedi-preflight":
                if db.schema.get(keys=(params["schemaId"],)) is None:
                    raise AssertionError("Cached referenced schema is absent from preflight")
                vaulting._sedi_test_schema_calls.append(True)
            return original(*args, **kwargs)
        scheming.validateSchema = checked
        return {"armed": True}
    if method == "test.cachedSchemaCalls":
        return {"count": len(vaulting._sedi_test_schema_calls)}
    if method == "test.removeSchema":
        state = vaulting.require_open_state(params["vaultId"])
        return {"removed": state["hby"].db.schema.rem(keys=(params["schemaId"],))}
    if method.startswith("kf."):`;
        await route.fulfill({ response, body: source.replace('    "vaults.list",', '    "test.signedState",\n    "test.staleStatus",\n    "test.expectCachedSchema",\n    "test.cachedSchemaCalls",\n    "test.removeSchema",\n    "vaults.list",')
            .replace('    if method.startswith("kf."):', dispatch) });
    });
    await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).href);
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    const request = (method: string, params: Record<string, unknown>) => page.evaluate(
        ({ method, params }) => (window as any).webbaserProductionHarness.request(method, params), { method, params });
    const holder = (await request("vaults.create", { name: "core-holder", passcode: "synthetic-holder-passcode" })).vault.id;
    await request("vaults.open", { vaultId: holder, passcode: "synthetic-holder-passcode" });
    const holderAid = (await request("identifiers.create", { vaultId: holder, alias: "holder" })).identifier.aid;
    const registry = (await request("registries.create", { vaultId: holder, issuerAid: holderAid, name: "presentations" })).registry;
    await request("vaults.close", { vaultId: holder });
    const raw = execFileSync(python!,
        [path.resolve("playwright/fixtures/sedi-core-reference.py"), holderAid, registry.registryId],
        { cwd: keripy!, encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1",
            PYTHONPATH: `${keripy}/src:${keripy}` }, maxBuffer: 10 * 1024 * 1024 });
    const reference = JSON.parse(raw);
    writeFileSync(testInfo.outputPath("core-public-fixture.json"), raw);
    await request("vaults.open", { vaultId: holder, passcode: "synthetic-holder-passcode" });
    await request("schemas.import", { vaultId: holder, schemaId: reference.evidence.schemaId,
        schema: JSON.stringify(reference.schema) });
    for (const schema of reference.authority_schemas) {
        await request("schemas.import", { vaultId: holder, schemaId: schema.$id, schema: JSON.stringify(schema) });
    }
    const cachedSchema = JSON.parse(readFileSync("playwright/fixtures/default-acdc-schema.json", "utf8"));
    await request("schemas.import", { vaultId: holder, schemaId: cachedSchema.$id, schema: JSON.stringify(cachedSchema) });
    await request("test.expectCachedSchema", { schemaId: cachedSchema.$id });
    for (const [index, evidence] of reference.supporting.entries()) {
        await request("remotes.import", { vaultId: holder, alias: `authority-${index}`, cesr: evidence.kel });
    }
    await request("remotes.import", { vaultId: holder, alias: "issuer", cesr: reference.issuer });
    await request("remotes.import", { vaultId: holder, alias: "verifier", cesr: reference.verifierKel });
    const receipt = await request("credentials.receive", { vaultId: holder, syntheticOnly: true,
        issuerAid: reference.evidence.issuerAid, recipientAid: holderAid, schemaId: reference.evidence.schemaId,
        evidence: reference.evidence });
    expect(receipt.credential.issuance).toBe("verified");
    const params = { vaultId: holder, syntheticOnly: true,
        credentialSaid: reference.evidence.said, presenterAid: holderAid, verifierAid: reference.verifierAid,
        message: "Present Core SEDI", presentationRegistry: "presentations", authorityEvidence: reference.supporting,
        disclosurePlan: [[reference.evidence.schemaId, "/", [""]],
            [reference.supporting[0].schemaId, "/e/utahAgent/_/", [""]],
            [reference.supporting[1].schemaId, "/e/utahAgent/_/e/orgUnit/_/", [""]]] };
    const preflightKel = await request("identifiers.export", { vaultId: holder, aid: holderAid });
    const stateParams = { vaultId: holder, holder: holderAid, registryId: registry.registryId };
    const preflightState = await request("test.signedState", stateParams);
    const unitSchema = reference.authority_schemas.find((schema: { $id: string }) => schema.$id === reference.supporting[1].schemaId);
    expect((await request("test.removeSchema", { vaultId: holder, schemaId: unitSchema.$id })).removed).toBe(true);
    await expect(request("ipex.present", params)).rejects.toThrow(/schema is missing.*retry/i);
    await request("schemas.import", { vaultId: holder, schemaId: unitSchema.$id, schema: JSON.stringify(unitSchema) });
    expect(await request("test.signedState", stateParams)).toEqual(preflightState);
    expect(await request("test.staleStatus", { vaultId: holder, evidence: reference.stale_unit }))
        .toEqual({ status: "issued", statusSequence: 1, headSequence: 2 });
    const alteredSignature = Buffer.from(reference.supporting[1].cesr, "base64");
    alteredSignature[alteredSignature.length - 1] ^= 1;
    for (const bad of [
        { authorityEvidence: reference.supporting.slice(0, 1) },
        { authorityEvidence: reference.supporting.slice(1) },
        { disclosurePlan: params.disclosurePlan.slice(0, 2) },
        { disclosurePlan: Array(10).fill(params.disclosurePlan[0]) },
        { disclosurePlan: [...params.disclosurePlan].reverse() },
        { disclosurePlan: [[reference.evidence.schemaId, "/", [""]],
            [reference.supporting[0].schemaId, "/e/wrong/_/", [""]], params.disclosurePlan[2]] },
        { disclosurePlan: [[reference.supporting[0].schemaId, "/", [""]], ...params.disclosurePlan.slice(1)] },
        { authorityEvidence: [reference.supporting[0], { ...reference.supporting[1], blinder: "bad" }] },
        { authorityEvidence: [reference.supporting[0], { ...reference.supporting[1], cesr: alteredSignature.toString("base64") }] },
        { authorityEvidence: [reference.supporting[0], { ...reference.supporting[1], issuerAid: holderAid }] },
        { authorityEvidence: [reference.supporting[0], { ...reference.supporting[1], schemaId: "invalid" }] },
        { authorityEvidence: [reference.supporting[0], { ...reference.supporting[1], tel: [] }] },
        { authorityEvidence: [reference.supporting[0], reference.stale_unit] },
    ]) {
        await expect(request("ipex.present", { ...params, ...bad })).rejects.toThrow();
        expect(await request("identifiers.export", { vaultId: holder, aid: holderAid })).toEqual(preflightKel);
        expect(await request("test.signedState", stateParams)).toEqual(preflightState);
    }
    const other = await request("ipex.present", { ...params, message: "Different Core Grant" });
    const native = (mode: string) => {
        const child = spawn(python!,
            [path.resolve("playwright/fixtures/sedi-core-verifier.py"), testInfo.outputDir, mode],
            { cwd: keripy!, encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1",
                PYTHONPATH: `${keripy}/src:${keripy}`, FORTWEB_NATIVE_WAIT: "1",
                FORTWEB_NATIVE_RECHECK: mode === "valid" ? "1" : "0" } });
        let stdout = "", stderr = "";
        const ready = new Promise<void>((resolve, reject) => {
            child.stdout.on("data", chunk => { stdout += chunk; if (stdout.includes("READY\n")) resolve(); });
            child.on("error", reject);
            child.on("exit", code => { if (!stdout.includes("READY\n")) reject(new Error(`native ${mode} exited ${code}`)); });
        });
        const accepted = new Promise<void>((resolve, reject) => {
            if (mode !== "valid") return resolve();
            child.stdout.on("data", () => { if (stdout.includes("ACCEPTED\n")) resolve(); });
            child.on("exit", code => { if (!stdout.includes("ACCEPTED\n")) reject(new Error(`native verifier exited ${code}`)); });
        });
        child.stderr.on("data", chunk => { stderr += chunk; });
        const done = new Promise<string>((resolve, reject) => {
            child.on("error", reject);
            child.on("close", code => {
                writeFileSync(testInfo.outputPath(`native-${mode}.txt`), stdout + stderr);
                if (code !== 0) reject(new Error(`native ${mode} failed: ${stderr}`)); else resolve(stdout);
            });
        });
        void done.catch(() => {});
        return { child, ready, accepted, done };
    };
    const verifiers = [native("valid"), native("wrong"), native("missing"), native("missing-agent"), native("missing-proof"),
        ...(process.env["FORTWEB_NATIVE_MAILBOX"] === "1" ? [native("stale")] : [])];
    try {
        await Promise.all(verifiers.map(verifier => verifier.ready));
        const result = await request("ipex.present", params);
        expect((await request("test.cachedSchemaCalls", {})).count).toBeGreaterThan(0);
        result.otherPresentation = other.presentation;
        writeFileSync(testInfo.outputPath("fortweb-presentation.json"), JSON.stringify(result));
        expect(result.exchange.cesr).toBeTruthy();
        verifiers[0].child.stdin.write("go\n");
        for (const verifier of verifiers.slice(1)) verifier.child.stdin.end("go\n");
        await verifiers[0].accepted;
        const [wrong, missing, missingAgent, missingProof, stale] = await Promise.all(verifiers.slice(1).map(verifier => verifier.done));
        expect(wrong).toContain("Native verifier rejected wrong evidence after KRAM authentication.");
        expect(missing).toContain("Native verifier rejected missing evidence after KRAM authentication.");
        expect(missingAgent).toContain("Native verifier rejected missing-agent evidence after KRAM authentication.");
        expect(missingProof).toContain("Native verifier rejected missing-proof evidence after KRAM authentication.");
        if (process.env["FORTWEB_NATIVE_MAILBOX"] === "1") {
            expect(stale).toContain("Native verifier rejected stale mailbox Grant under normal KRAM.");
        }
        await request("vaults.close", { vaultId: holder });
        await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
        await page.reload();
        await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
        await request("vaults.open", { vaultId: holder, passcode: "synthetic-holder-passcode" });
        const recovered = await request("credentials.getReceived", { vaultId: holder,
            syntheticOnly: true, said: reference.evidence.said });
        expect(recovered.evidence).toEqual(reference.evidence);
        const recoveredPresentation = await request("registries.present", { vaultId: holder,
            name: "presentations", grantSaid: result.exchange.said });
        expect(recoveredPresentation.presentation).toEqual(result.presentation);
        const recoveredExchange = await request("ipex.get", { vaultId: holder, syntheticOnly: true,
            said: result.exchange.said });
        expect(recoveredExchange.exchange.said).toBe(result.exchange.said);
        verifiers[0].child.stdin.end("recheck\n");
        const verified = await verifiers[0].done;
        expect(verified).toContain("Native verifier accepted Core Grant and all three authority nodes.");
        expect(verified).toContain("Native verifier rechecked the original accepted Core Grant after holder restart.");
        if (process.env["FORTWEB_NATIVE_MAILBOX"] === "1") {
            for (const mode of ["valid", "wrong", "missing", "missing-agent", "missing-proof", "stale"]) {
                const delivered = JSON.parse(readFileSync(testInfo.outputPath(`mailbox-${mode}.json`), "utf8"));
                expect(delivered.authenticated_components_match).toBe(true);
                expect(delivered.kram_authenticated).toBe(mode !== "stale");
                expect(delivered.original_sha256).toMatch(/^[a-f0-9]{64}$/);
                expect(delivered.received_sha256).toMatch(/^[a-f0-9]{64}$/);
            }
            const valid = JSON.parse(readFileSync(testInfo.outputPath("mailbox-valid.json"), "utf8"));
            const stale = JSON.parse(readFileSync(testInfo.outputPath("mailbox-stale.json"), "utf8"));
            expect(valid.nested_sha256).toHaveLength(3);
            expect(stale.original_sha256).toBe(valid.original_sha256);
            expect(stale.received_sha256).toBe(valid.received_sha256);
        }
        await request("vaults.close", { vaultId: holder });
        await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
    } finally {
        for (const verifier of verifiers) verifier.child.kill();
    }
});
