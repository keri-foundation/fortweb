// Contract tests for the publication gate.
//
// Each check below asserts a structural invariant of the wiring: which job depends on
// which, what a required acceptance step is allowed to skip, what the acceptance marker
// output is bound to, and whether acceptance validates the runtime that was already
// produced. The negative cases mutate a parsed copy of the real files, so a skipped
// required step and a harmless display-name rename are both exercised directly. These
// tests inspect declared structure; they do not execute GitHub Actions, and they do not
// replace a hosted run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    ACCEPTANCE_ACTION,
    PLAYWRIGHT_WORKFLOW,
    PRODUCER_ACTION,
    PRODUCER_WORKFLOW,
    findPublicationContractViolations,
} from './runtime-publication-contract.mjs';
import { asArray, findStep, parseYamlStructure } from './workflow-structure.mjs';

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relative) {
    return readFileSync(path.join(PROJECT_DIR, relative), 'utf8');
}

function loadContract() {
    return {
        packageWorkflow: parseYamlStructure(read(PRODUCER_WORKFLOW)),
        acceptanceAction: parseYamlStructure(read(ACCEPTANCE_ACTION)),
        playwrightWorkflow: parseYamlStructure(read(PLAYWRIGHT_WORKFLOW)),
        producerAction: parseYamlStructure(read(PRODUCER_ACTION)),
        packageJson: JSON.parse(read('package.json')),
    };
}

function violationsFor(mutate) {
    const contract = loadContract();
    mutate?.(contract);
    return findPublicationContractViolations(contract);
}

function assertRejected(violations, fragment) {
    assert.ok(
        violations.some((violation) => violation.includes(fragment)),
        `expected a violation mentioning "${fragment}", got ${JSON.stringify(violations)}`,
    );
}

test('the current publication wiring satisfies the contract', () => {
    assert.deepEqual(violationsFor(), []);
});

test('the release gate is bound to the acceptance step output, not to a literal', () => {
    assertRejected(
        violationsFor(({ packageWorkflow }) => {
            packageWorkflow.jobs.package.outputs.release_acceptance = 'true';
        }),
        'release_acceptance',
    );
});

test('the release job cannot run without package, a tag, and a positive acceptance result', () => {
    assertRejected(
        violationsFor(({ packageWorkflow }) => {
            packageWorkflow.jobs.release.needs = null;
        }),
        'must depend on the package job',
    );
    assertRejected(
        violationsFor(({ packageWorkflow }) => {
            packageWorkflow.jobs.release.if = "startsWith(github.ref, 'refs/tags/v')";
        }),
        'must require an explicit positive acceptance result',
    );
    assertRejected(
        violationsFor(({ packageWorkflow }) => {
            packageWorkflow.jobs.release.if = "github.event_name == 'push' && needs.package.outputs.release_acceptance == 'true'";
        }),
        'must require a v-prefixed tag ref',
    );
});

test('the release product cannot be uploaded before acceptance ran', () => {
    assertRejected(
        violationsFor(({ packageWorkflow }) => {
            const steps = packageWorkflow.jobs.package.steps;
            const acceptanceIndex = steps.findIndex((step) => step.id === 'release_acceptance');
            const [acceptance] = steps.splice(acceptanceIndex, 1);
            const productIndex = steps.findIndex((step) => step.with?.name === 'fortweb-runtime-product');
            steps.splice(productIndex + 1, 0, acceptance);
        }),
        'must be uploaded only after acceptance ran',
    );
});

test('a required acceptance step made skippable is rejected', () => {
    // The failure mode this replaces: adding `if: false` to the lifecycle step left the
    // suite green because the check only looked at display text.
    assertRejected(
        violationsFor(({ acceptanceAction }) => {
            const lifecycle = findStep(acceptanceAction.runs.steps, (step) => step.name === 'Run runtime lifecycle tests');
            assert.ok(lifecycle, 'expected the runtime lifecycle acceptance step');
            lifecycle.if = 'false';
        }),
        'Run runtime lifecycle tests',
    );
});

test('the acceptance marker keeps a single write site', () => {
    assertRejected(
        violationsFor(({ acceptanceAction }) => {
            const canary = findStep(acceptanceAction.runs.steps, (step) => step.name === 'Run isolated runtime canary');
            assert.ok(canary, 'expected the isolated runtime canary step');
            canary.run = `${canary.run}\necho 'accepted=true' >> "$GITHUB_OUTPUT"`;
        }),
        'exactly one write site',
    );
});

test('a renamed step that becomes skippable is still rejected', () => {
    assertRejected(
        violationsFor(({ acceptanceAction }) => {
            for (const step of acceptanceAction.runs.steps) {
                step.name = `Renamed ${step.name ?? ''}`;
            }
            acceptanceAction.runs.steps.at(-2).if = 'false';
        }),
        'must be unconditional',
    );
});

test('renaming steps does not invalidate the contract', () => {
    // A harmless display-name change must not fail: no check may key off step names.
    assert.deepEqual(
        violationsFor(({ acceptanceAction, packageWorkflow, playwrightWorkflow }) => {
            for (const step of acceptanceAction.runs.steps) {
                step.name = `Renamed ${step.name ?? ''}`;
            }
            for (const job of Object.values(packageWorkflow.jobs)) {
                for (const step of asArray(job.steps)) {
                    step.name = `Renamed ${step.name ?? ''}`;
                }
            }
            for (const job of Object.values(playwrightWorkflow.jobs)) {
                for (const step of asArray(job.steps)) {
                    step.name = `Renamed ${step.name ?? ''}`;
                }
            }
        }),
        [],
    );
});

test('acceptance validates the prepared runtime instead of rebuilding one', () => {
    assertRejected(
        violationsFor(({ acceptanceAction }) => {
            const application = findStep(
                acceptanceAction.runs.steps,
                (step) => step.name === 'Run application Playwright tests against the prepared runtime',
            );
            assert.ok(application, 'expected the application acceptance step');
            application.run = 'npm run test:e2e';
        }),
        'must not run the rebuilding e2e command',
    );
    assertRejected(
        violationsFor(({ acceptanceAction }) => {
            acceptanceAction.runs.steps[1].run = 'npm run build:runtime';
        }),
        'must not build or package the runtime',
    );
});

test('the e2e wrapper forwards arguments to the prepared-runtime command', () => {
    assertRejected(
        violationsFor(({ packageJson }) => {
            packageJson.scripts['test:e2e'] = 'npm run test:e2e:prepared-runtime';
        }),
        '-- separator',
    );
});

test('the pull-request lane reuses the shared acceptance action', () => {
    assertRejected(
        violationsFor(({ playwrightWorkflow }) => {
            const steps = playwrightWorkflow.jobs['fortweb-runtime-playwright'].steps;
            const acceptance = findStep(steps, (step) => step.uses === './.github/actions/runtime-browser-acceptance');
            assert.ok(acceptance, 'expected the shared acceptance invocation');
            delete acceptance.uses;
            acceptance.run = 'npm run test:e2e:runtime-canary';
        }),
        'must invoke the shared acceptance action',
    );
});

test('the producer action does not expose unsupported inputs', () => {
    assertRejected(
        violationsFor(({ producerAction }) => {
            producerAction.inputs.runtime_dir = { description: 'Runtime tree output directory.', default: 'dist/runtime' };
        }),
        '"runtime_dir" input',
    );
    assertRejected(
        violationsFor(({ producerAction }) => {
            producerAction.inputs.python = { description: 'Python interpreter used by the producer.', default: 'python3' };
        }),
        '"python" input',
    );
    assertRejected(
        violationsFor(({ producerAction }) => {
            findStep(producerAction.runs.steps, (step) => step.name === 'Verify runtime tree').run += '\n          echo "${{ inputs.runtime_dir }}"';
        }),
        'must not read the removed',
    );
});

test('the producer action uses one runtime directory and one interpreter', () => {
    assertRejected(
        violationsFor(({ producerAction }) => {
            const packageStep = findStep(producerAction.runs.steps, (step) => step.id === 'package');
            assert.ok(packageStep, 'expected the packaging step');
            packageStep.run = packageStep.run.replace('--python python3', '--python python3.14');
        }),
        'must use the python3 interpreter',
    );
    assertRejected(
        violationsFor(({ producerAction }) => {
            const verifyStep = findStep(producerAction.runs.steps, (step) => step.name === 'Verify runtime tree');
            assert.ok(verifyStep, 'expected the runtime tree verification step');
            verifyStep.run = verifyStep.run.replace('--runtime-dir dist/runtime', '--runtime-dir dist/other');
        }),
        'must use the dist/runtime directory',
    );
});

test('the producer CI path runs the publication and CLI contracts', () => {
    const producerAction = parseYamlStructure(read(PRODUCER_ACTION));
    const contractStep = findStep(producerAction.runs.steps, (step) => step.name === 'Test source contracts');
    assert.ok(contractStep, 'expected the producer source-contract step');
    for (const suite of ['tools/runtime-publication-workflow.test.mjs', 'tools/direct-cli.test.mjs']) {
        assert.ok(contractStep.run.includes(suite), `the producer source-contract step must run ${suite}`);
    }
});
