// Contract tests for the publication gate.
//
// These are deliberately structural: they assert the shape of the workflow DAG and the
// acceptance action, using exact stable anchors and their relative order. They cannot
// prove that GitHub Actions behaves correctly at runtime, and they do not replace a
// hosted run. What they do guarantee is that the wiring cannot silently regress: the
// release job stays ineligible without a positive acceptance result, and the acceptance
// path keeps validating the runtime that was already produced rather than rebuilding one.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACCEPTANCE_ACTION = '.github/actions/runtime-browser-acceptance/action.yml';
const PACKAGE_WORKFLOW = '.github/workflows/fortweb-runtime-package.yml';
const PLAYWRIGHT_WORKFLOW = '.github/workflows/fortweb-runtime-playwright.yml';

function read(relative) {
    return readFileSync(path.join(PROJECT_DIR, relative), 'utf8');
}

function indexOfExactlyOnce(haystack, needle) {
    const index = haystack.indexOf(needle);
    assert.notEqual(index, -1, `missing required anchor: ${needle}`);
    assert.equal(haystack.indexOf(needle, index + 1), -1, `anchor must appear exactly once: ${needle}`);
    return index;
}

const TAG_CONDITION = "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')";

test('the publisher validates the selected release runtime on the tag path', () => {
    const workflow = read(PACKAGE_WORKFLOW);
    const step = indexOfExactlyOnce(workflow, '      - name: Validate the selected release runtime');
    const id = indexOfExactlyOnce(workflow, '        id: release_acceptance');
    const uses = indexOfExactlyOnce(workflow, '        uses: ./.github/actions/runtime-browser-acceptance');
    assert.ok(step < id && id < uses, 'the acceptance step must declare its id before it is invoked');
    // Real publication authority only: a PR or branch run must not pay for acceptance,
    // and must not be able to manufacture a positive release gate.
    assert.ok(workflow.includes(TAG_CONDITION), 'release acceptance must be limited to a v-prefixed tag push');
});

test('the product artifact is uploaded after selected-release acceptance', () => {
    const workflow = read(PACKAGE_WORKFLOW);
    const acceptance = indexOfExactlyOnce(workflow, '      - name: Validate the selected release runtime');
    const diagnostics = indexOfExactlyOnce(workflow, '      - name: Upload release acceptance failure diagnostics');
    const product = indexOfExactlyOnce(workflow, '      - name: Upload the exact verified product files');
    assert.ok(acceptance < diagnostics, 'failure diagnostics must follow the acceptance step');
    assert.ok(acceptance < product, 'the release-consumable product must not exist before acceptance');
});

test('failure diagnostics cannot ship the release product set', () => {
    const workflow = read(PACKAGE_WORKFLOW);
    const start = workflow.indexOf('      - name: Upload release acceptance failure diagnostics');
    const end = workflow.indexOf('      - name: Upload the exact verified product files');
    const diagnostics = workflow.slice(start, end);
    assert.match(diagnostics, /if: failure\(\)/);
    assert.equal(diagnostics.includes('dist/package'), false, 'diagnostics are not release products');
    assert.equal(diagnostics.includes('fortweb-runtime-product'), false, 'diagnostics must not replace the product artifact');
});

test('the package job exports the acceptance result and the release job requires it', () => {
    const workflow = read(PACKAGE_WORKFLOW);
    const output = '      release_acceptance: ${{ steps.release_acceptance.outputs.accepted }}';
    assert.ok(workflow.includes(output), 'the package job must export the acceptance result');
    assert.ok(workflow.includes('    needs: package'), 'the release job must depend on the package job');
    const gate = "needs.package.outputs.release_acceptance == 'true'";
    assert.ok(workflow.includes(gate), 'publication must require an explicit positive acceptance result');
    // The gate must sit in the release job's condition, not merely be mentioned.
    const releaseJob = workflow.slice(workflow.indexOf('  release:'));
    assert.ok(releaseJob.includes(gate), 'the acceptance gate must be part of the release job condition');
    assert.ok(releaseJob.includes('startsWith(github.ref, \'refs/tags/v\')'), 'tag authority must be retained');
});

test('the acceptance action emits its positive output only after every acceptance command', () => {
    const action = read(ACCEPTANCE_ACTION);
    const order = [
        '    - name: Assert the prepared runtime inputs exist',
        '    - name: Install Playwright browsers',
        '    - name: Run application Playwright tests against the prepared runtime',
        '    - name: Run isolated runtime canary',
        '    - name: Run runtime lifecycle tests',
        '    - name: Run source wheelhouse test',
        '    - name: Mark the prepared runtime accepted',
    ];
    const positions = order.map((anchor) => indexOfExactlyOnce(action, anchor));
    for (let index = 1; index < positions.length; index += 1) {
        assert.ok(positions[index - 1] < positions[index], `${order[index]} must follow ${order[index - 1]}`);
    }
    assert.ok(
        action.includes('value: ${{ steps.accepted.outputs.accepted }}'),
        'the accepted output must be bound to the marker step',
    );
    assert.equal(action.includes('continue-on-error'), false, 'no acceptance step may tolerate failure');
    assert.equal(action.includes('always()'), false, 'no acceptance step may be forced to run after a failure');
    // Exactly one write site, and it is inside the final marker step.
    const writes = action.split("echo 'accepted=true' >> \"$GITHUB_OUTPUT\"").length - 1;
    assert.equal(writes, 1, 'accepted=true must have exactly one write site');
    const marker = action.slice(positions[positions.length - 1]);
    assert.ok(marker.includes("echo 'accepted=true'"), 'the single write site must live in the marker step');
    assert.equal(marker.includes('\n      if:'), false, 'the marker step must be unconditional');
});

test('the acceptance action tests the prepared runtime instead of rebuilding one', () => {
    const action = read(ACCEPTANCE_ACTION);
    assert.ok(action.includes('npm run test:e2e:prepared-runtime'), 'acceptance must use the prepared-runtime command');
    // `npm run test:e2e` carries a pretest hook that rebuilds the runtime, which would
    // accept a different runtime than the one already produced for this candidate.
    assert.doesNotMatch(
        action,
        /npm run test:e2e(?![:\w-])/,
        'acceptance must not use the rebuilding test command',
    );
    for (const forbidden of ['npm run build:runtime', 'package:runtime', 'build:runtime-source']) {
        assert.equal(action.includes(forbidden), false, `acceptance must not build or package: ${forbidden}`);
    }
});

test('the prepared-runtime command exists and does not rebuild the runtime', () => {
    const pkg = JSON.parse(read('package.json'));
    const prepared = pkg.scripts['test:e2e:prepared-runtime'];
    assert.ok(prepared, 'the prepared-runtime command must exist');
    assert.match(prepared, /^playwright test /, 'it must run the application Playwright set directly');
    assert.equal(
        Object.hasOwn(pkg.scripts, 'pretest:e2e:prepared-runtime'),
        false,
        'the prepared-runtime command must not have a pretest rebuild hook',
    );
    for (const spec of [
        'playwright/fortweb-empty-error-states.spec.ts',
        'playwright/fortweb-route-acceptance.spec.ts',
        'playwright/fortweb-runtime-origin-missing.spec.ts',
        'playwright/fortweb-sidebar-behavior.spec.ts',
        'playwright/fortweb-smoke.spec.ts',
    ]) {
        assert.ok(prepared.includes(spec), `the prepared-runtime command must run ${spec}`);
    }
    // Developer behaviour is preserved: the plain command still rebuilds first.
    assert.equal(pkg.scripts['pretest:e2e'], 'npm run build:runtime');
});

test('the pull-request lane uses the same shared acceptance action', () => {
    const workflow = read(PLAYWRIGHT_WORKFLOW);
    assert.ok(
        workflow.includes('uses: ./.github/actions/runtime-browser-acceptance'),
        'the PR lane must invoke the shared acceptance action',
    );
    // The acceptance commands must exist in exactly one place. If they reappear here,
    // the two lanes can drift into validating different things.
    for (const duplicated of [
        'npm run test:e2e:runtime-canary',
        'npm run test:e2e:runtime-lifecycle',
        'npm run test:e2e:wheelhouse',
        'npx playwright install',
    ]) {
        assert.equal(workflow.includes(duplicated), false, `the PR lane must not duplicate acceptance: ${duplicated}`);
    }
    assert.doesNotMatch(
        workflow,
        /npm run test:e2e(?![:\w-])/,
        'the PR lane must not run the rebuilding test command before acceptance',
    );
    assert.ok(workflow.includes('if: failure()'), 'failure evidence upload must be preserved');
});
