import { expect, test } from "@playwright/test";

test("@slow selective compaction preserves commitments and hides unrequested fields", async ({ page, baseURL }) => {
    test.skip(process.env["FORTWEB_EXPECT_SEDI_COMPAT"] !== "1", "requires the Core SEDI compatibility patch");
    test.setTimeout(120_000);
    await page.route("**/app/runtime/wallet-worker.py", async route => {
        const response = await route.fetch();
        const source = await response.text();
        const dispatch = `    if method == "test.compactor":
        from copy import deepcopy
        from keri import Kinds
        from keri.core import Compactor
        from keri.kering import InvalidValueError
        raw = {"d": "", "status": {"d": "", "value": "citizen"},
               "private": {"d": "", "value": "hidden"}}
        whole = Compactor(mad=deepcopy(raw), makify=True, kind=Kinds.json)
        whole.compact(paths=[""])
        full = whole.partials[("",)].mad
        selected = Compactor(mad=deepcopy(raw), makify=True, kind=Kinds.json)
        selected.compact(paths=["a/status/"], root="a")
        partial = selected.partials[("a/status/",)].mad
        normal = Compactor(mad=deepcopy(raw), makify=True, kind=Kinds.json)
        normal.compact()
        invalid = []
        for path, root in (("a/missing/", "a"), ("a/status/", "wrong")):
            try:
                candidate = Compactor(mad=deepcopy(raw), makify=True, kind=Kinds.json)
                candidate.compact(paths=[path], root=root)
                invalid.append((path,) not in candidate.partials)
            except InvalidValueError:
                invalid.append(True)
        return {"sameCommitment": full["d"] == partial["d"], "selected": partial["status"]["value"],
                "privateCompact": isinstance(partial["private"], str), "ordinaryCompact": normal.iscompact,
                "invalidRejected": invalid}
    if method.startswith("kf."):`;
        await route.fulfill({ response, body: source.replace('    "vaults.list",', '    "test.compactor",\n    "vaults.list",')
            .replace('    if method.startswith("kf."):', dispatch) });
    });
    await page.goto(new URL("/_runtime-test/ci/fixtures/webbaser-lifecycle/production.html", baseURL).href);
    await page.waitForFunction(() => (window as any).webbaserProductionHarnessReady === true);
    const result = await page.evaluate(() => (window as any).webbaserProductionHarness.request("test.compactor", {}));
    expect(result).toEqual({ sameCommitment: true, selected: "citizen", privateCompact: true,
        ordinaryCompact: true, invalidRejected: [true, true] });
    await page.evaluate(() => (window as any).webbaserProductionHarness.destroy());
});
