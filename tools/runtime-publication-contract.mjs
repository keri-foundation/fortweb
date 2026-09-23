// Publication-contract checks for the FortWeb runtime publisher.
//
// These checks read the parsed structure of the producer workflow, the shared acceptance
// action, and the pull-request lane, and report the invariants that actually gate a
// release: which job depends on which, what a required step is allowed to skip, what the
// acceptance marker output is bound to, and whether acceptance validates the runtime that
// was already produced. They inspect declared structure only; they do not execute GitHub
// Actions and cannot prove runtime behaviour of the platform itself.
import { asArray, findStep } from './workflow-structure.mjs';

export const PRODUCER_WORKFLOW = '.github/workflows/fortweb-runtime-package.yml';
export const PLAYWRIGHT_WORKFLOW = '.github/workflows/fortweb-runtime-playwright.yml';
export const ACCEPTANCE_ACTION = '.github/actions/runtime-browser-acceptance/action.yml';
export const PRODUCER_ACTION = '.github/actions/produce-runtime-package/action.yml';
export const ACCEPTANCE_ACTION_USES = './.github/actions/runtime-browser-acceptance';
export const PRODUCT_ARTIFACT_NAME = 'fortweb-runtime-product';
export const PREPARED_RUNTIME_COMMAND = 'npm run test:e2e:prepared-runtime';

const ACCEPTED_OUTPUT_BINDING = /^\$\{\{\s*steps\.([A-Za-z0-9_-]+)\.outputs\.accepted\s*\}\}$/u;
// The plain e2e command carries a pretest hook that rebuilds the runtime, so acceptance
// must never reach for it.
const REBUILDING_COMMAND = /npm run test:e2e(?![:\w-])/u;
const FORBIDDEN_ACCEPTANCE_COMMANDS = ['npm run build:runtime', 'package:runtime', 'build:runtime-source'];
// Options the composite action used to expose without honouring them across its whole
// lifecycle. They must not come back as a partial interface.
const REMOVED_PRODUCER_INPUTS = ['runtime_dir', 'python'];
const PRODUCER_CONTRACT_STEP = 'Test source contracts';
const PRODUCER_CONTRACT_SUITES = [
    'tools/runtime-publication-workflow.test.mjs',
    'tools/direct-cli.test.mjs',
];
const DUPLICATED_ACCEPTANCE_COMMANDS = [
    'npm run test:e2e:runtime-canary',
    'npm run test:e2e:runtime-lifecycle',
    'npm run test:e2e:wheelhouse',
    'npx playwright install',
];

function normalizeCondition(value) {
    return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function needsIncludes(needs, jobId) {
    if (typeof needs === 'string') {
        return needs === jobId;
    }
    return asArray(needs).includes(jobId);
}

function stepRunText(step) {
    return typeof step?.run === 'string' ? step.run : '';
}

export function findPublicationContractViolations({ packageWorkflow, acceptanceAction, playwrightWorkflow, producerAction, packageJson }) {
    const violations = [];
    const require = (condition, message) => {
        if (!condition) {
            violations.push(message);
        }
    };

    // The producer action exposes only the options it honours across the whole producer
    // lifecycle, and it uses one runtime directory and one interpreter throughout.
    for (const removed of REMOVED_PRODUCER_INPUTS) {
        require(
            !Object.hasOwn(producerAction?.inputs ?? {}, removed),
            `the producer action must not expose the unsupported "${removed}" input`,
        );
    }
    const producerSteps = asArray(producerAction?.runs?.steps);
    const producerStepsSource = JSON.stringify(producerSteps);
    for (const removed of REMOVED_PRODUCER_INPUTS) {
        require(
            !producerStepsSource.includes(`inputs.${removed}`),
            `the producer action must not read the removed "${removed}" input`,
        );
    }
    const producerRuns = producerSteps.map(stepRunText).join('\n');
    for (const match of producerRuns.matchAll(/--runtime-dir\s+("[^"]*"|'[^']*'|\S+)/gu)) {
        require(
            match[1].replace(/^["']|["']$/gu, '') === 'dist/runtime',
            'the producer action must use the dist/runtime directory throughout',
        );
    }
    for (const match of producerRuns.matchAll(/--python\s+("[^"]*"|'[^']*'|\S+)/gu)) {
        require(
            match[1].replace(/^["']|["']$/gu, '') === 'python3',
            'the producer action must use the python3 interpreter throughout',
        );
    }
    const contractStep = findStep(producerSteps, (step) => step?.name === PRODUCER_CONTRACT_STEP);
    require(Boolean(contractStep), `the producer action must keep the "${PRODUCER_CONTRACT_STEP}" step`);
    if (contractStep) {
        for (const suite of PRODUCER_CONTRACT_SUITES) {
            require(
                stepRunText(contractStep).includes(suite),
                `the producer source-contract step must run ${suite}`,
            );
        }
    }

    const packageJob = packageWorkflow?.jobs?.package ?? null;
    const releaseJob = packageWorkflow?.jobs?.release ?? null;
    require(Boolean(packageJob), 'the producer workflow must define a "package" job');
    require(Boolean(releaseJob), 'the producer workflow must define a "release" job');
    if (!packageJob || !releaseJob) {
        return violations;
    }

    // The release gate is the acceptance step's own output, so an absent value leaves
    // publication ineligible instead of defaulting to true.
    const exportedAcceptance = packageJob.outputs?.release_acceptance;
    const boundStepId = ACCEPTED_OUTPUT_BINDING.exec(String(exportedAcceptance ?? '').trim())?.[1] ?? null;
    require(
        Boolean(boundStepId),
        'the package job must export release_acceptance bound to a step output (steps.<id>.outputs.accepted)',
    );

    const packageSteps = asArray(packageJob.steps);
    const acceptanceStep = boundStepId
        ? findStep(packageSteps, (step) => step?.id === boundStepId)
        : null;
    if (boundStepId) {
        require(Boolean(acceptanceStep), `the package job must contain a step with id "${boundStepId}"`);
    }
    if (acceptanceStep) {
        require(
            acceptanceStep.uses === ACCEPTANCE_ACTION_USES,
            `acceptance step "${boundStepId}" must invoke the shared acceptance action`,
        );
        const acceptanceCondition = normalizeCondition(acceptanceStep.if);
        require(
            acceptanceCondition.includes("github.event_name == 'push'")
                && acceptanceCondition.includes("startsWith(github.ref, 'refs/tags/v')"),
            `acceptance step "${boundStepId}" must run only for a v-prefixed tag push`,
        );
    }

    const productStep = findStep(packageSteps, (step) => step?.with?.name === PRODUCT_ARTIFACT_NAME);
    require(Boolean(productStep), `the package job must upload the "${PRODUCT_ARTIFACT_NAME}" artifact`);
    if (acceptanceStep && productStep) {
        require(
            packageSteps.indexOf(acceptanceStep) < packageSteps.indexOf(productStep),
            'the release product artifact must be uploaded only after acceptance ran',
        );
    }

    require(needsIncludes(releaseJob.needs, 'package'), 'the release job must depend on the package job');
    const releaseCondition = normalizeCondition(releaseJob.if);
    require(
        releaseCondition.includes("github.event_name == 'push'"),
        "the release job must require the push event",
    );
    require(
        releaseCondition.includes("startsWith(github.ref, 'refs/tags/v')"),
        'the release job must require a v-prefixed tag ref',
    );
    require(
        releaseCondition.includes("needs.package.outputs.release_acceptance == 'true'"),
        'the release job must require an explicit positive acceptance result',
    );

    const acceptanceSteps = asArray(acceptanceAction?.runs?.steps);
    require(acceptanceAction?.runs?.using === 'composite', 'the acceptance action must be a composite action');
    require(acceptanceSteps.length > 0, 'the acceptance action must declare its steps');

    const markerStepId = ACCEPTED_OUTPUT_BINDING.exec(
        String(acceptanceAction?.outputs?.accepted?.value ?? '').trim(),
    )?.[1] ?? null;
    require(
        Boolean(markerStepId),
        'the acceptance action must export accepted from a marker step output (steps.<id>.outputs.accepted)',
    );
    const markerStep = markerStepId ? findStep(acceptanceSteps, (step) => step?.id === markerStepId) : null;
    if (markerStepId) {
        require(Boolean(markerStep), `the acceptance action must contain a step with id "${markerStepId}"`);
    }

    const writeSites = [];
    for (const step of acceptanceSteps) {
        const label = step?.name ?? '<unnamed step>';
        require(step?.if === undefined, `acceptance step "${label}" must be unconditional so it cannot be skipped`);
        require(
            !Object.hasOwn(step ?? {}, 'continue-on-error') && !JSON.stringify(step ?? {}).includes('continue-on-error'),
            `acceptance step "${label}" must not tolerate failure`,
        );
        if (stepRunText(step).includes('accepted=true')) {
            writeSites.push(step);
        }
    }
    require(
        writeSites.length === 1 && writeSites[0] === markerStep,
        'accepted=true must have exactly one write site, inside the marker step',
    );

    const acceptanceSource = JSON.stringify(acceptanceSteps);
    require(
        acceptanceSource.includes(PREPARED_RUNTIME_COMMAND),
        `the acceptance action must validate the prepared runtime with "${PREPARED_RUNTIME_COMMAND}"`,
    );
    require(
        !REBUILDING_COMMAND.test(acceptanceSource),
        'the acceptance action must not run the rebuilding e2e command',
    );
    for (const forbidden of FORBIDDEN_ACCEPTANCE_COMMANDS) {
        require(
            !acceptanceSource.includes(forbidden),
            `the acceptance action must not build or package the runtime: ${forbidden}`,
        );
    }

    const scripts = packageJson?.scripts ?? {};
    const prepared = String(scripts['test:e2e:prepared-runtime'] ?? '');
    require(prepared.startsWith('playwright test '), 'test:e2e:prepared-runtime must run the Playwright set directly');
    require(
        !Object.hasOwn(scripts, 'pretest:e2e:prepared-runtime'),
        'test:e2e:prepared-runtime must not have a pretest rebuild hook',
    );
    require(
        String(scripts['pretest:e2e'] ?? '').includes('build:runtime'),
        'test:e2e must keep its pretest runtime rebuild hook',
    );
    require(
        String(scripts['test:e2e'] ?? '').trimEnd().endsWith('--'),
        'test:e2e must forward arguments to test:e2e:prepared-runtime with a trailing -- separator',
    );

    const playwrightStepsSource = JSON.stringify(asArray(playwrightWorkflow?.jobs?.['fortweb-runtime-playwright']?.steps));
    require(
        playwrightStepsSource.includes(ACCEPTANCE_ACTION_USES),
        'the pull-request lane must invoke the shared acceptance action',
    );
    require(
        !REBUILDING_COMMAND.test(playwrightStepsSource),
        'the pull-request lane must not run the rebuilding e2e command before acceptance',
    );
    for (const duplicated of DUPLICATED_ACCEPTANCE_COMMANDS) {
        require(
            !playwrightStepsSource.includes(duplicated),
            `the pull-request lane must not duplicate acceptance: ${duplicated}`,
        );
    }

    return violations;
}
