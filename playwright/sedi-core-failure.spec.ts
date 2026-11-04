import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

for (const failPoint of ["beforeRegistry", "beforeHandler"]) test(`Core presentation remains blocked after ${failPoint}`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(180_000);
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
    await page.route("**/app/runtime/wallet-worker.py", async route => {
        const response = await route.fetch();
        const source = await response.text();
        const dispatch = `    if method == "test.armFailure":
        if params["point"] == "beforeRegistry":
            original = vaulting._registry_operation
            async def failure(method, params, state, **kwargs):
                if method == "registries.present":
                    vaulting._registry_operation = original
                    raise RuntimeError("synthetic failure before registry")
                return await original(method, params, state, **kwargs)
            vaulting._registry_operation = failure
        else:
            def failure(*args, **kwargs):
                raise RuntimeError("synthetic failure before handler")
            vaulting._parse_ipex_stream = failure
        return {"armed": True}
    if method.startswith("kf."):`;
        await route.fulfill({ response, body: source.replace('    "vaults.list",', '    "test.armFailure",\n    "vaults.list",')
            .replace('    if method.startswith("kf."):', dispatch) });
    });
    await page.route("**/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", async route => {
        const response = await route.fetch();
        const body = (await response.text()).replace('<script type="module">', '<script nonce="csp-test" type="module">');
        await route.fulfill({ response, body, headers: { ...response.headers(),
            "content-security-policy": "default-src 'none'; script-src 'self' 'nonce-csp-test' 'wasm-unsafe-eval'; " +
                "worker-src 'self' blob:; connect-src 'self' https:; style-src 'unsafe-inline'" } });
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
    const before = await request("identifiers.export", { vaultId: holder, aid: holderAid });
    await request("test.armFailure", { point: failPoint });
    await expect(request("ipex.present", params)).rejects.toThrow();
    await expect(request("credentials.getReceived", { vaultId: holder, syntheticOnly: true,
        said: reference.evidence.said })).rejects.toThrow(/persistence failed/i);
    await request("vaults.close", { vaultId: holder });
    await request("vaults.open", { vaultId: holder, passcode: "synthetic-holder-passcode" });
    const after = await request("identifiers.export", { vaultId: holder, aid: holderAid });
    expect(after.cesr).not.toEqual(before.cesr);
    await expect(request("credentials.getReceived", { vaultId: holder, syntheticOnly: true,
        said: reference.evidence.said })).rejects.toThrow(/incomplete and requires recovery/i);
    await expect(request("ipex.present", params)).rejects.toThrow(/incomplete and requires recovery/i);
    await expect(request("registries.present", { vaultId: holder, name: "presentations",
        grantSaid: reference.evidence.said })).rejects.toThrow(/incomplete and requires recovery/i);
    await expect(request("registries.create", { vaultId: holder, name: "blocked", issuerAid: holderAid }))
        .rejects.toThrow(/incomplete and requires recovery/i);
    await expect(request("credentials.issueRegistered", { vaultId: holder, name: "presentations" }))
        .rejects.toThrow(/incomplete and requires recovery/i);
    await request("vaults.close", { vaultId: holder });
    await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
});
