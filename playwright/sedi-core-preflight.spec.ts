import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

test("@slow rejects a reference Core presentation without changing signed state", async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    const reference = process.env["FORTWEB_SEDI_REFERENCE"];
    const python = process.env["FORTWEB_SEDI_PYTHON"];
    test.skip(!reference || !python || process.env["FORTWEB_EXPECT_REGISTRY_BACKEND"] !== "1",
        "requires the SEDI reference checkout, native Python, and browser registry backend");
    const sha = (name: string) => createHash("sha256").update(readFileSync(path.join(reference!, name))).digest("hex");
    expect(sha("src/keri/acdc/ipexing.py")).toBe("fadc924b0e48b3e3f8f82d0730f5f2e3b6938149a38915c9b43fee715e3a5806");
    expect(sha("tests/sedi/test_ipex_sedi.py")).toBe("0309bcc6c11a5da1754ad05939ce565c8fb6094e9f7db02e4310639963e7c9a2");
    await page.route("**/pyscript-ci.toml", async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: `fort_synthetic_recipient_testing = true\n${await response.text()}` });
    });
    if (process.env["FORTWEB_TEST_STRICT_CSP"] === "1") {
        await page.route("**/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", async route => {
            const response = await route.fetch();
            const body = (await response.text()).replace('<script type="module">', '<script nonce="csp-test" type="module">');
            await route.fulfill({ response, body, headers: { ...response.headers(),
                "content-security-policy": "default-src 'none'; script-src 'self' 'nonce-csp-test' 'wasm-unsafe-eval'; " +
                    "worker-src 'self' blob:; connect-src 'self' https:; style-src 'unsafe-inline'" } });
        });
    }
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
    if method.startswith("kf."):`;
        await route.fulfill({ response, body: source.replace('    "vaults.list",', '    "test.signedState",\n    "vaults.list",')
            .replace('    if method.startswith("kf."):', dispatch) });
    });
    await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).href);
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    const request = (method: string, params: Record<string, unknown>) => page.evaluate(
        ({ method, params }) => (window as any).webbaserProductionHarness.request(method, params), { method, params });
    const vaultId = (await request("vaults.create", { name: "core-preflight", passcode: "synthetic-passcode" })).vault.id;
    await request("vaults.open", { vaultId, passcode: "synthetic-passcode" });
    const holder = (await request("identifiers.create", { vaultId, alias: "holder" })).identifier.aid;
    const registry = (await request("registries.create", { vaultId, issuerAid: holder, name: "presentations" })).registry;
    const fixture = JSON.parse(execFileSync(python!, [path.resolve("playwright/fixtures/sedi-core-reference.py"), holder, registry.registryId], {
        cwd: reference!, encoding: "utf8", maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONPATH: `${reference}/src:${reference}` },
    }));
    await request("schemas.import", { vaultId, schemaId: fixture.evidence.schemaId, schema: JSON.stringify(fixture.schema) });
    await request("remotes.import", { vaultId, alias: "issuer", cesr: fixture.issuer });
    await request("remotes.import", { vaultId, alias: "verifier", cesr: fixture.verifierKel });
    await request("credentials.receive", { vaultId, syntheticOnly: true, issuerAid: fixture.evidence.issuerAid,
        recipientAid: holder, schemaId: fixture.evidence.schemaId, evidence: fixture.evidence });
    const params = { vaultId, syntheticOnly: true, credentialSaid: fixture.evidence.said,
        presenterAid: holder, verifierAid: fixture.verifierAid, message: "Present Core SEDI", presentationRegistry: "presentations" };
    const kel = await request("identifiers.export", { vaultId, aid: holder });
    const stateParams = { vaultId, holder, registryId: registry.registryId };
    const before = await request("test.signedState", stateParams);
    expect(Object.keys(before.wallet)).toEqual(expect.arrayContaining(["kels.", "evts.", "sigs.", "fwpn.", "fwrc."]));
    expect(Object.keys(before.registry)).toEqual(expect.arrayContaining(["regs.", "tels.", "evts.", "ancs.", "heds."]));
    expect(before).toEqual(expect.objectContaining({ tel: [registry.registryId], registryPending: false, receiptPending: false, bindings: 0 }));
    console.log(`Synthetic holder KEL head: ${before.holderHead.join(":")}; registry TEL: ${before.tel.join(",")}`);
    for (const extra of [{}, { authorityEvidence: [] }, { authorityEvidence: fixture.supporting },
        { authorityEvidence: [{ malformed: true }], disclosurePlan: [] }]) {
        await expect(request("ipex.present", { ...params, ...extra })).rejects.toThrow(
            process.env["FORTWEB_EXPECT_SEDI_COMPAT"] === "1"
                ? /authority evidence or disclosure plan is invalid/i : /chained credential presentations are not supported/i);
        expect(await request("test.signedState", stateParams)).toEqual(before);
        expect(await request("identifiers.export", { vaultId, aid: holder })).toEqual(kel);
    }
    await request("vaults.close", { vaultId });
    await request("vaults.open", { vaultId, passcode: "synthetic-passcode" });
    expect(await request("test.signedState", stateParams)).toEqual(before);
    expect(await request("identifiers.export", { vaultId, aid: holder })).toEqual(kel);
    expect((await request("credentials.getReceived", { vaultId, syntheticOnly: true, said: fixture.evidence.said })).evidence)
        .toEqual(fixture.evidence);
    await request("vaults.close", { vaultId });
});
