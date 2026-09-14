import {
    canonicalJson, ENTRYPOINT, PACKAGE_SCHEMA_VERSION, packageVersionFromTag,
    validatePackageVersion, zipBasenameForVersion,
} from './runtime-package-manifest.mjs';

export const REPOSITORY = 'keri-foundation/fortweb';
export const PUBLISHER_WORKFLOW = '.github/workflows/fortweb-runtime-package.yml';

// Branch refs describe unpublished validation/local builds. Release-tag refs are the
// only other accepted form and are the production publication path. Arbitrary Git refs
// are not accepted.
const BRANCH_REF_PATTERN = /^refs\/heads\/[A-Za-z0-9._/-]+$/;
const TAG_REF_PATTERN = /^refs\/tags\/(.+)$/;

// The single trusted workflow identity shape. The publisher and the consumer verifier
// both build it from the same helper so the expected identity cannot drift.
export function releaseWorkflowIdentity(repository, tag) {
    if (typeof repository !== 'string' || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repository)) {
        throw new Error('Release workflow identity requires an owner/repository name.');
    }
    if (typeof tag !== 'string' || !tag.startsWith('v')) {
        throw new Error('Release workflow identity requires a "v"-prefixed tag.');
    }
    packageVersionFromTag(tag);
    return `https://github.com/${repository}/${PUBLISHER_WORKFLOW}@refs/tags/${tag}`;
}

export function generateReleaseMetadata({ artifactSha256, artifactBytes, fortwebCommitSha, ref, packageVersion }) {
    if (typeof fortwebCommitSha !== 'string' || !/^[0-9a-f]{40}$/.test(fortwebCommitSha)) {
        throw new Error('Release metadata requires a lowercase 40-hex FortWeb commit.');
    }
    if (typeof ref !== 'string') {
        throw new Error('Release metadata requires an explicit ref.');
    }
    const tagMatch = TAG_REF_PATTERN.exec(ref);
    if (!tagMatch && !BRANCH_REF_PATTERN.test(ref)) {
        throw new Error('Release metadata requires an explicit branch or release-tag ref.');
    }
    const version = validatePackageVersion(packageVersion);
    const artifactName = zipBasenameForVersion(version);
    let refName;
    let workflowIdentity;
    let identityPattern;
    if (tagMatch) {
        // The tag is authoritative for the release version: a package labelled with a
        // different version must not be able to describe itself as that release.
        const tag = tagMatch[1];
        if (tag !== `v${version}`) {
            throw new Error(`Release metadata tag does not match the package version: ${tag}`);
        }
        refName = tag;
        workflowIdentity = releaseWorkflowIdentity(REPOSITORY, tag);
        // A published release is verified against the exact tag identity.
        identityPattern = escapeRegExp(workflowIdentity);
    } else {
        refName = ref.slice('refs/heads/'.length);
        workflowIdentity = 'unpublished-local-build';
        // An unpublished build has no attestation, so its metadata records the
        // publisher identity as a shape rather than claiming a verified one.
        identityPattern = `${escapeRegExp(authenticatedPublisherPrefix())}(heads/main|tags/v.*)`;
    }
    return {
        artifact_bytes: artifactBytes,
        artifact_name: artifactName,
        artifact_sha256: artifactSha256,
        attestation: {
            present: false,
            required: true,
            required_for_publication: true,
            status: 'not-produced',
            type: 'github-artifact-attestation',
            verified: false,
            verify_command: `gh attestation verify ${artifactName} --repo ${REPOSITORY} --cert-identity-regexp "^${identityPattern}$"`,
        },
        commit_sha: fortwebCommitSha,
        entrypoint: ENTRYPOINT,
        package_version: version,
        publication: { status: 'unpublished' },
        ref,
        ref_name: refName,
        repository: REPOSITORY,
        schema_version: PACKAGE_SCHEMA_VERSION,
        workflow: PUBLISHER_WORKFLOW,
        workflow_identity: workflowIdentity,
    };
}

function authenticatedPublisherPrefix() {
    return `https://github.com/${REPOSITORY}/${PUBLISHER_WORKFLOW}@refs/`;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function serializeReleaseMetadata(values) {
    return canonicalJson(generateReleaseMetadata(values));
}
