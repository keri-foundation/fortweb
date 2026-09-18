#!/usr/bin/env bash
#
# Verify a FortWeb runtime product without trusting anything inside the product.
#
# Two modes:
#   release mode  download the three published product files for a release tag,
#                 verify the GitHub Artifact Attestation, then verify the bytes.
#   local mode    verify an already-materialized product directory, for example
#                 the output of tools/package-runtime.mjs, without attestation.
#
# The expected workflow identity is derived here from the repository, the
# publisher workflow path, and the release tag. It is never read back out of the
# downloaded release metadata and used to select the signer, because that would
# let an artifact nominate its own publisher.
#
# This script fails closed. It writes fortweb-verification-receipt.json only
# after every verification step has succeeded.
#
# It never deletes a caller-supplied directory. Downloads go to a
# verifier-owned temporary directory that is removed on exit.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEFAULT_EXPECTED_WORKFLOW=".github/workflows/fortweb-runtime-package.yml"
RELEASE_METADATA_FILENAME="fortweb-release.json"
UNPUBLISHED_IDENTITY="unpublished-local-build"
RECEIPT_FILENAME="fortweb-verification-receipt.json"

REPO_NAME=""
TAG_NAME=""
EXPECTED_WORKFLOW="${DEFAULT_EXPECTED_WORKFLOW}"
PRODUCT_DIR=""
OUT_DIR=""
SKIP_ATTESTATION=false
WORK_DIR=""

usage() {
    cat <<'EOF'
Usage:
  verify-fortweb-release.sh --repo <owner/repo> --tag <vX.Y.Z> --out <dir> \
    [--expected-workflow <path>]

  verify-fortweb-release.sh --repo <owner/repo> --tag <vX.Y.Z> --out <dir> \
    --product-dir <dir> --skip-attestation-for-local-only \
    [--expected-workflow <path>]

Modes:
  release mode (default)
    Downloads fortweb-release.json and the versioned ZIP with its sidecar from
    the GitHub Release for --tag, verifies the GitHub Artifact Attestation, and
    then verifies the downloaded bytes.

  local mode (--product-dir)
    Verifies an already-materialized product directory. Attestation cannot be
    checked for a local directory, so --skip-attestation-for-local-only is
    required and the receipt records attestation_verified=false.

Both modes:
  - derive the expected workflow identity from --repo, --expected-workflow, and
    --tag, and never from the product metadata
  - pin every version-bearing product name and field to the version in --tag
  - refuse --tag values that are not v-prefixed release versions such as latest
EOF
}

fail() {
    printf 'error: %s\n' "$1" >&2
    exit 1
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

cleanup() {
    if [[ -n "${WORK_DIR}" && -d "${WORK_DIR}" ]]; then
        rm -rf "${WORK_DIR}"
    fi
}

trap cleanup EXIT

metadata_field() {
    node -e '
        const fs = require("node:fs");
        const metadata = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const value = process.argv[2]
            .split(".")
            .reduce((accumulator, key) => (accumulator == null ? undefined : accumulator[key]), metadata);
        if (value === undefined || value === null) {
            process.stdout.write("");
            process.exit(0);
        }
        process.stdout.write(String(value));
    ' "$1" "$2"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --repo)
            REPO_NAME="${2:-}"
            shift 2
            ;;
        --tag)
            TAG_NAME="${2:-}"
            shift 2
            ;;
        --expected-workflow)
            EXPECTED_WORKFLOW="${2:-}"
            shift 2
            ;;
        --product-dir)
            PRODUCT_DIR="${2:-}"
            shift 2
            ;;
        --out)
            OUT_DIR="${2:-}"
            shift 2
            ;;
        --skip-attestation-for-local-only)
            SKIP_ATTESTATION=true
            shift 1
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            usage >&2
            fail "unknown argument: $1"
            ;;
    esac
done

if [[ -z "${REPO_NAME}" && -z "${TAG_NAME}" && -z "${OUT_DIR}" ]]; then
    usage
    exit 1
fi

[[ -n "${OUT_DIR}" ]] || fail "--out is required"
[[ -n "${TAG_NAME}" ]] || fail "--tag is required"

# The tag is the only accepted version authority. This rejects "latest", branch
# names, and fully-qualified branch refs.
if ! printf '%s' "${TAG_NAME}" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
    fail "--tag must be a v-prefixed release version (got: ${TAG_NAME})"
fi

[[ -n "${REPO_NAME}" ]] || fail "--repo is required"
case "${REPO_NAME}" in
    */*) ;;
    *) fail "--repo must be owner/name (got: ${REPO_NAME})" ;;
esac
case "${REPO_NAME}" in
    */*/*|*..*|/*|*/) fail "--repo must be a plain owner/name (got: ${REPO_NAME})" ;;
esac

case "${EXPECTED_WORKFLOW}" in
    .github/workflows/*.yml|.github/workflows/*.yaml) ;;
    *) fail "--expected-workflow must be a .github/workflows/*.yml path (got: ${EXPECTED_WORKFLOW})" ;;
esac
case "${EXPECTED_WORKFLOW}" in
    *..*) fail "--expected-workflow must not contain path traversal" ;;
esac

MODE="release"
if [[ -n "${PRODUCT_DIR}" ]]; then
    MODE="local"
    [[ "${SKIP_ATTESTATION}" == true ]] || fail "local verification requires --skip-attestation-for-local-only"
    [[ -d "${PRODUCT_DIR}" ]] || fail "--product-dir not found: ${PRODUCT_DIR}"
fi

VERSION="${TAG_NAME#v}"
REF="refs/tags/${TAG_NAME}"
IDENTITY="https://github.com/${REPO_NAME}/${EXPECTED_WORKFLOW}@refs/tags/${TAG_NAME}"
ARTIFACT_NAME="fortweb-runtime-${VERSION}.zip"

if [[ "${MODE}" == "release" ]]; then
    command_exists gh || fail "gh is required for release verification"
    WORK_DIR="$(mktemp -d)"
    for asset in "${RELEASE_METADATA_FILENAME}" "${ARTIFACT_NAME}" "${ARTIFACT_NAME}.sha256"; do
        gh release download "${TAG_NAME}" \
            --repo "${REPO_NAME}" \
            --pattern "${asset}" \
            --dir "${WORK_DIR}" \
            --clobber >&2
    done
    VERIFY_DIR="${WORK_DIR}"
else
    VERIFY_DIR="${PRODUCT_DIR}"
fi

METADATA_PATH="${VERIFY_DIR}/${RELEASE_METADATA_FILENAME}"
[[ -f "${METADATA_PATH}" ]] || fail "missing release metadata: ${METADATA_PATH}"

# The verifier-owned identity must match what the product records. A mismatch
# means the product claims a different publisher than the one we are willing to
# trust, so it fails closed.
RECORDED_IDENTITY="$(metadata_field "${METADATA_PATH}" workflow_identity)"
RECORDED_REF="$(metadata_field "${METADATA_PATH}" ref)"

if [[ "${MODE}" == "release" ]]; then
    [[ "${RECORDED_IDENTITY}" == "${IDENTITY}" ]] || fail "recorded workflow identity does not match the verifier-derived identity in release mode"
    [[ "${RECORDED_REF}" == "${REF}" ]] || fail "recorded ref does not match the release tag"
else
    if [[ "${RECORDED_IDENTITY}" == "${IDENTITY}" ]]; then
        [[ "${RECORDED_REF}" == "${REF}" ]] || fail "recorded ref does not match the release tag"
    elif [[ "${RECORDED_IDENTITY}" != "${UNPUBLISHED_IDENTITY}" ]]; then
        fail "recorded workflow identity is neither the verifier-derived identity nor an unpublished local build"
    fi
fi

ATTESTATION_VERIFIED=false
if [[ "${MODE}" == "release" ]]; then
    # An exact SAN identity, not a pattern. The identity is derived from the trusted
    # repository, expected workflow, and requested tag; the downloaded product never
    # nominates the identity it is checked against.
    gh attestation verify "${VERIFY_DIR}/${ARTIFACT_NAME}" \
        --repo "${REPO_NAME}" \
        --cert-identity "${IDENTITY}" >&2
    ATTESTATION_VERIFIED=true
fi

# Delegate every package-internal check to the canonical product verifier, pinning
# the version taken from the tag rather than from the product.
node "${SCRIPT_DIR}/verify-runtime-package.mjs" \
    --product-dir "${VERIFY_DIR}" \
    --package-version "${VERSION}" >&2

mkdir -p "${OUT_DIR}"
RECEIPT_PATH="${OUT_DIR}/${RECEIPT_FILENAME}"

RECEIPT_PATH="${RECEIPT_PATH}" \
VERIFICATION_MODE="${MODE}" \
REPOSITORY="${REPO_NAME}" \
TAG_NAME="${TAG_NAME}" \
PACKAGE_VERSION="${VERSION}" \
REF="${REF}" \
EXPECTED_WORKFLOW="${EXPECTED_WORKFLOW}" \
WORKFLOW_IDENTITY="${IDENTITY}" \
RECORDED_IDENTITY="${RECORDED_IDENTITY}" \
ARTIFACT_NAME="${ARTIFACT_NAME}" \
ATTESTATION_VERIFIED="${ATTESTATION_VERIFIED}" \
COMMIT_SHA="$(metadata_field "${METADATA_PATH}" commit_sha)" \
ARTIFACT_SHA256="$(metadata_field "${METADATA_PATH}" artifact_sha256)" \
ARTIFACT_BYTES="$(metadata_field "${METADATA_PATH}" artifact_bytes)" \
ENTRYPOINT="$(metadata_field "${METADATA_PATH}" entrypoint)" \
SCHEMA_VERSION="$(metadata_field "${METADATA_PATH}" schema_version)" \
node -e '
    const fs = require("node:fs");
    const receipt = {
        artifact_bytes: Number(process.env.ARTIFACT_BYTES),
        artifact_name: process.env.ARTIFACT_NAME,
        artifact_sha256: process.env.ARTIFACT_SHA256,
        attestation_verified: process.env.ATTESTATION_VERIFIED === "true",
        commit_sha: process.env.COMMIT_SHA,
        entrypoint: process.env.ENTRYPOINT,
        expected_workflow: process.env.EXPECTED_WORKFLOW,
        package_version: process.env.PACKAGE_VERSION,
        recorded_workflow_identity: process.env.RECORDED_IDENTITY,
        ref: process.env.REF,
        repository: process.env.REPOSITORY,
        schema_version: process.env.SCHEMA_VERSION,
        tag: process.env.TAG_NAME,
        verification_mode: process.env.VERIFICATION_MODE,
        verified_at: new Date().toISOString(),
        workflow_identity: process.env.WORKFLOW_IDENTITY,
    };
    fs.writeFileSync(process.env.RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
'

printf 'verified %s %s (%s mode)\n' "${REPO_NAME}" "${TAG_NAME}" "${MODE}"
printf 'receipt: %s\n' "${RECEIPT_PATH}"
