import assert from 'node:assert/strict';
import test from 'node:test';

import {
    generateReleaseMetadata,
    releaseWorkflowIdentity,
    serializeReleaseMetadata,
} from './generate-release-metadata.mjs';

const BRANCH_REF = 'refs/heads/pyodide-314-runtime';
const TAG_REF = 'refs/tags/v1.2.3';

function values(overrides = {}) {
    return {
        artifactSha256: '1'.repeat(64),
        artifactBytes: 123,
        fortwebCommitSha: '2'.repeat(40),
        ref: BRANCH_REF,
        packageVersion: '0.0.0',
        ...overrides,
    };
}

test('release metadata is canonical and explicitly unpublished', () => {
    const release = generateReleaseMetadata(values());
    assert.equal(release.publication.status, 'unpublished');
    assert.equal(release.attestation.required, true);
    assert.equal(release.attestation.required_for_publication, true);
    assert.equal(release.attestation.present, false);
    assert.equal(release.attestation.verified, false);
    assert.equal(release.attestation.status, 'not-produced');
    assert.equal(release.workflow_identity, 'unpublished-local-build');
    assert.equal(release.schema_version, '2.0.0');
    assert.equal(Object.hasOwn(release, 'runtime_origin'), false);
    assert.equal(release.commit_sha, values().fortwebCommitSha);
    assert.equal(release.ref_name, 'pyodide-314-runtime');
    assert.equal(release.package_version, '0.0.0');
    assert.equal(release.artifact_name, 'fortweb-runtime-0.0.0.zip');
    assert.equal(release.entrypoint, 'app/index.html');
    assert.equal(release.repository, 'keri-foundation/fortweb');
    assert.equal(release.workflow, '.github/workflows/fortweb-runtime-package.yml');
    assert.ok(
        release.attestation.verify_command.includes('gh attestation verify fortweb-runtime-0.0.0.zip'),
        release.attestation.verify_command,
    );
    assert.ok(
        release.attestation.verify_command.includes('github\\.com/keri-foundation/fortweb/'),
        release.attestation.verify_command,
    );
    assert.equal(JSON.parse(serializeReleaseMetadata(values())).artifact_bytes, 123);
});

test('release metadata requires explicit source identity', () => {
    const withoutCommit = { artifactSha256: '1'.repeat(64), artifactBytes: 123 };
    assert.throws(() => generateReleaseMetadata(withoutCommit), /FortWeb commit/);
});

test('release-tag metadata binds tag, version, and publisher identity together', () => {
    const release = generateReleaseMetadata(values({ ref: TAG_REF, packageVersion: '1.2.3' }));
    assert.equal(release.ref, TAG_REF);
    assert.equal(release.ref_name, 'v1.2.3');
    assert.equal(release.package_version, '1.2.3');
    assert.equal(release.artifact_name, 'fortweb-runtime-1.2.3.zip');
    assert.equal(
        release.workflow_identity,
        releaseWorkflowIdentity('keri-foundation/fortweb', 'v1.2.3'),
    );
    assert.ok(
        release.attestation.verify_command.includes('@refs/tags/v1\\.2\\.3$'),
        release.attestation.verify_command,
    );
});

test('release metadata rejects tag/version disagreement and non-release refs', () => {
    assert.throws(
        () => generateReleaseMetadata(values({ ref: TAG_REF, packageVersion: '1.2.4' })),
        /tag does not match the package version/,
    );
    assert.throws(() => generateReleaseMetadata(values({ ref: 'refs/pull/1/head' })), /branch or release-tag ref/);
    assert.throws(() => generateReleaseMetadata(values({ ref: 'HEAD' })), /branch or release-tag ref/);
    assert.throws(() => generateReleaseMetadata(values({ ref: 'refs/tags/latest' })), /version/i);
});

test('release metadata rejects non-release package versions', () => {
    for (const bad of ['', 'v1.2.3', '1.2', '1.2.3.4', '1.2.3 ', ' 1.2.3', '1.2.3/../x', 'latest', '1.2.3;rm -rf /', 'a'.repeat(80)]) {
        assert.throws(() => generateReleaseMetadata(values({ packageVersion: bad })), /version/i, bad);
    }
});
