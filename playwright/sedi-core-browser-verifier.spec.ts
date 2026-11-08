import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

test("@slow Core SEDI presentation is verified by a separate browser vault", async ({ page, baseURL }, testInfo) => {
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
    await request("vaults.close", { vaultId: holder });
    const verifierId = (await request("vaults.create", { name: "browser-verifier", passcode: "synthetic-verifier-passcode" })).vault.id;
    await request("vaults.open", { vaultId: verifierId, passcode: "synthetic-verifier-passcode" });
    const browserVerifier = (await request("identifiers.create", { vaultId: verifierId, alias: "verifier" })).identifier.aid;
    const browserVerifierKel = (await request("identifiers.export", { vaultId: verifierId, aid: browserVerifier })).cesr;
    for (const schema of reference.authority_schemas) {
        await request("schemas.import", { vaultId: verifierId, schemaId: schema.$id, schema: JSON.stringify(schema) });
    }
    for (const [index, evidence] of reference.supporting.entries()) {
        await request("remotes.import", { vaultId: verifierId, alias: `authority-${index}`, cesr: evidence.kel });
    }
    await request("remotes.import", { vaultId: verifierId, alias: "issuer", cesr: reference.issuer });
    await request("vaults.close", { vaultId: verifierId });
    await request("vaults.open", { vaultId: holder, passcode: "synthetic-holder-passcode" });
    await request("remotes.import", { vaultId: holder, alias: "browser-verifier", cesr: browserVerifierKel });
    const plan = [[reference.evidence.schemaId, "/", [""]],
        [reference.supporting[0].schemaId, "/e/utahAgent/_/", [""]],
        [reference.supporting[1].schemaId, "/e/utahAgent/_/e/orgUnit/_/", [""]]];
    const result = await request("ipex.present", { vaultId: holder, syntheticOnly: true,
        credentialSaid: reference.evidence.said, presenterAid: holderAid, verifierAid: browserVerifier,
        presentationRegistry: "presentations", authorityEvidence: reference.supporting, disclosurePlan: plan });
    await request("vaults.close", { vaultId: holder });
    await request("vaults.open", { vaultId: verifierId, passcode: "synthetic-verifier-passcode" });
    await request("remotes.import", { vaultId: verifierId, alias: "holder", cesr: result.presentation.kel });
    const params = { vaultId: verifierId, syntheticOnly: true, cesr: result.exchange.cesr,
        evidence: result.evidence, presentation: result.presentation, authorityEvidence: reference.supporting,
        presenterAid: holderAid, verifierAid: browserVerifier };
    await expect(request("ipex.verifyPresentation", params)).rejects.toThrow(/schema is missing.*retry/i);
    await request("schemas.import", { vaultId: verifierId, schemaId: reference.schema.$id,
        schema: JSON.stringify(reference.schema) });
    await expect(request("ipex.verifyPresentation", { ...params,
        authorityEvidence: reference.supporting.slice(0, 1) })).rejects.toThrow();
    await expect(request("ipex.verifyPresentation", { ...params, presentation: undefined })).rejects.toThrow();
    const accepted = await request("ipex.verifyPresentation", params);
    expect(accepted.exchange.said).toBe(result.exchange.said);
    await request("vaults.close", { vaultId: verifierId });
    await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
});
