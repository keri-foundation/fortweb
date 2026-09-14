#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORTWEB_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
FORTWEB_VERIFY_SCRIPT="${SCRIPT_DIR}/verify-runtime-package.mjs"

MODE=""
METADATA_PATH=""
ZIP_PATH=""
OUT_DIR=""
REPO_NAME=""
TAG_NAME=""
EXPECTED_WORKFLOW=""
SKIP_ATTESTATION=false
VERIFY_TEMP_DIR=""
NORMALIZED_METADATA_PATH=""

usage() {
  cat <<'EOF'
Usage:
  verify-fortweb-release.sh --metadata <metadata.json> --zip <runtime.zip> --out <output-dir> [--skip-attestation-for-local-only]
  verify-fortweb-release.sh --repo <owner/repo> --tag <vX.Y.Z> --out <output-dir> [--expected-workflow <path>]

Modes:
  Local artifact mode
    - verifies a locally available metadata JSON and ZIP
    - requires --skip-attestation-for-local-only

  Release mode
    - downloads fortweb-release.json and the named ZIP from a pinned GitHub Release
    - verifies GitHub Artifact Attestation before unpacking

This script fails closed. It writes fortweb-verification-receipt.json only after every
verification step succeeds.
EOF
}

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

require_file() {
  local path="$1"
  local label="$2"

  [[ -n "$path" ]] || fail "$label is required"
  [[ -f "$path" ]] || fail "$label not found: $path"
}

require_nonempty() {
  local value="$1"
  local label="$2"

  [[ -n "$value" ]] || fail "$label is required"
}

sha256_file() {
  local file_path="$1"

  if command_exists sha256sum; then
    sha256sum "$file_path" | awk '{print $1}'
    return
  fi

  if command_exists shasum; then
    shasum -a 256 "$file_path" | awk '{print $1}'
    return
  fi

  fail "Neither sha256sum nor shasum is available"
}

file_size_bytes() {
  local file_path="$1"
  wc -c < "$file_path" | tr -d '[:space:]'
}

escape_regex() {
  node -e 'const value = process.argv[1]; process.stdout.write(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));' "$1"
}

metadata_copy_and_validate() {
  local source_path="$1"
  local target_path="$2"

  SOURCE_PATH="$source_path" TARGET_PATH="$target_path" node <<'NODE'
const fs = require('node:fs');

const sourcePath = process.env.SOURCE_PATH;
const targetPath = process.env.TARGET_PATH;
const metadata = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const required = [
  'schema_version',
  'package_version',
  'repository',
  'commit_sha',
  'ref',
  'ref_name',
  'workflow_identity',
  'artifact_name',
  'artifact_sha256',
  'artifact_bytes',
  'runtime_origin',
  'entrypoint',
];

for (const key of required) {
  if (!(key in metadata)) {
    throw new Error(`Missing required metadata field: ${key}`);
  }
}

for (const key of [
  'schema_version',
  'package_version',
  'repository',
  'commit_sha',
  'ref',
  'ref_name',
  'workflow_identity',
  'artifact_name',
  'artifact_sha256',
  'runtime_origin',
  'entrypoint',
]) {
  if (typeof metadata[key] !== 'string' || metadata[key].trim().length === 0) {
    throw new Error(`Metadata field ${key} must be a non-empty string.`);
  }
}

if (metadata.ref === 'latest' || metadata.ref_name === 'latest') {
  throw new Error('Metadata must not use latest');
}

if (!Number.isInteger(metadata.artifact_bytes) || metadata.artifact_bytes < 0) {
  throw new Error('Metadata field artifact_bytes must be a non-negative integer');
}

if (!/^[0-9a-f]{64}$/u.test(metadata.artifact_sha256)) {
  throw new Error('Metadata field artifact_sha256 must be a lowercase SHA-256 hex digest');
}

if (
  metadata.attestation !== undefined &&
  (metadata.attestation === null || typeof metadata.attestation !== 'object' || Array.isArray(metadata.attestation))
) {
  throw new Error('Metadata field attestation must be an object when present');
}

fs.writeFileSync(targetPath, `${JSON.stringify(metadata, null, 2)}\n`);
NODE
}

metadata_get() {
  local source_path="$1"
  local key_path="$2"

  SOURCE_PATH="$source_path" KEY_PATH="$key_path" node <<'NODE'
const fs = require('node:fs');

const sourcePath = process.env.SOURCE_PATH;
const keyPath = process.env.KEY_PATH;
const metadata = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const value = keyPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), metadata);

if (value === undefined || value === null) {
  process.exit(1);
}

if (typeof value === 'object') {
  process.stdout.write(JSON.stringify(value));
  process.exit(0);
}

process.stdout.write(String(value));
NODE
}

write_receipt() {
  local receipt_path="$1"
  local verified_at="$2"
  local repository="$3"
  local package_version="$4"
  local commit_sha="$5"
  local ref="$6"
  local ref_name="$7"
  local artifact_name="$8"
  local artifact_sha256="$9"
  local runtime_origin="${10}"
  local entrypoint="${11}"
  local attestation_verified="${12}"
  local verification_mode="${13}"

  RECEIPT_PATH="$receipt_path" VERIFIED_AT="$verified_at" REPOSITORY="$repository" PACKAGE_VERSION="$package_version" COMMIT_SHA="$commit_sha" REF="$ref" REF_NAME="$ref_name" ARTIFACT_NAME="$artifact_name" ARTIFACT_SHA256="$artifact_sha256" RUNTIME_ORIGIN="$runtime_origin" ENTRYPOINT="$entrypoint" ATTESTATION_VERIFIED="$attestation_verified" VERIFICATION_MODE="$verification_mode" node <<'NODE'
const fs = require('node:fs');

const receiptPath = process.env.RECEIPT_PATH;
const receipt = {
  verified_at: process.env.VERIFIED_AT,
  repository: process.env.REPOSITORY,
  package_version: process.env.PACKAGE_VERSION,
  commit_sha: process.env.COMMIT_SHA,
  ref: process.env.REF,
  ref_name: process.env.REF_NAME,
  artifact_name: process.env.ARTIFACT_NAME,
  artifact_sha256: process.env.ARTIFACT_SHA256,
  runtime_origin: process.env.RUNTIME_ORIGIN,
  entrypoint: process.env.ENTRYPOINT,
  attestation_verified: process.env.ATTESTATION_VERIFIED === 'true',
  verification_mode: process.env.VERIFICATION_MODE,
};

fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
NODE
}

cleanup() {
  if [[ -n "${VERIFY_TEMP_DIR:-}" && -d "${VERIFY_TEMP_DIR}" ]]; then
    rm -rf "${VERIFY_TEMP_DIR}"
  fi
}

trap cleanup EXIT

if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --metadata)
      METADATA_PATH="${2:-}"
      shift 2
      ;;
    --zip)
      ZIP_PATH="${2:-}"
      shift 2
      ;;
    --out)
      OUT_DIR="${2:-}"
      shift 2
      ;;
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
    --skip-attestation-for-local-only)
      SKIP_ATTESTATION=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

require_nonempty "$OUT_DIR" "--out"

if [[ "$OUT_DIR" == "/" ]]; then
  fail "Refusing to operate on the filesystem root as an output directory"
fi

if [[ -n "$METADATA_PATH" || -n "$ZIP_PATH" || "$SKIP_ATTESTATION" == true ]]; then
  MODE="local-artifact"
  require_file "$METADATA_PATH" "--metadata"
  require_file "$ZIP_PATH" "--zip"

  if [[ "$SKIP_ATTESTATION" != true ]]; then
    fail "Local artifact mode requires --skip-attestation-for-local-only"
  fi
else
  MODE="release"
  require_nonempty "$REPO_NAME" "--repo"
  require_nonempty "$TAG_NAME" "--tag"

  case "$TAG_NAME" in
    latest|refs/tags/latest)
      fail 'Release mode rejects "latest". Use a pinned version tag.'
      ;;
  esac

  if ! command_exists gh; then
    fail "gh is required for release mode"
  fi
fi

if [[ ! -f "$FORTWEB_VERIFY_SCRIPT" ]]; then
  fail "FortWeb verifier not found at $FORTWEB_VERIFY_SCRIPT"
fi

VERIFY_TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fortweb-release-verify.XXXXXX")"
NORMALIZED_METADATA_PATH="${VERIFY_TEMP_DIR}/fortweb-release.json"

if [[ "$MODE" == "release" ]]; then
  printf 'Downloading FortWeb release metadata for %s/%s\n' "$REPO_NAME" "$TAG_NAME"
  gh release download "$TAG_NAME" --repo "$REPO_NAME" --pattern 'fortweb-release.json' --dir "$VERIFY_TEMP_DIR"
  require_file "$NORMALIZED_METADATA_PATH" "fortweb-release.json"
  metadata_copy_and_validate "$NORMALIZED_METADATA_PATH" "$NORMALIZED_METADATA_PATH"
  ZIP_NAME="$(metadata_get "$NORMALIZED_METADATA_PATH" artifact_name)"
  [[ -n "$ZIP_NAME" ]] || fail "Metadata artifact_name was empty"
  case "$ZIP_NAME" in
    */*|*'..'*)
      fail "Metadata artifact_name is unsafe: $ZIP_NAME"
      ;;
  esac
  printf 'Downloading FortWeb runtime ZIP %s\n' "$ZIP_NAME"
  gh release download "$TAG_NAME" --repo "$REPO_NAME" --pattern "$ZIP_NAME" --dir "$VERIFY_TEMP_DIR"
  ZIP_PATH="${VERIFY_TEMP_DIR}/${ZIP_NAME}"
else
  metadata_copy_and_validate "$METADATA_PATH" "$NORMALIZED_METADATA_PATH"
fi

if [[ "$MODE" == "local-artifact" ]]; then
  ZIP_NAME="$(basename "$ZIP_PATH")"
fi

REPOSITORY="$(metadata_get "$NORMALIZED_METADATA_PATH" repository)"
PACKAGE_VERSION="$(metadata_get "$NORMALIZED_METADATA_PATH" package_version)"
COMMIT_SHA="$(metadata_get "$NORMALIZED_METADATA_PATH" commit_sha)"
REF="$(metadata_get "$NORMALIZED_METADATA_PATH" ref)"
REF_NAME="$(metadata_get "$NORMALIZED_METADATA_PATH" ref_name)"
WORKFLOW_IDENTITY="$(metadata_get "$NORMALIZED_METADATA_PATH" workflow_identity)"
ARTIFACT_NAME="$(metadata_get "$NORMALIZED_METADATA_PATH" artifact_name)"
ARTIFACT_SHA256="$(metadata_get "$NORMALIZED_METADATA_PATH" artifact_sha256)"
ARTIFACT_BYTES="$(metadata_get "$NORMALIZED_METADATA_PATH" artifact_bytes)"
RUNTIME_ORIGIN="$(metadata_get "$NORMALIZED_METADATA_PATH" runtime_origin)"
ENTRYPOINT="$(metadata_get "$NORMALIZED_METADATA_PATH" entrypoint)"

if [[ "$MODE" == "release" ]]; then
  if [[ "$REPOSITORY" != "$REPO_NAME" ]]; then
    fail "Metadata repository mismatch: expected $REPO_NAME, found $REPOSITORY"
  fi

  if [[ "$REF_NAME" != "$TAG_NAME" ]]; then
    fail "Metadata ref_name mismatch: expected $TAG_NAME, found $REF_NAME"
  fi

  if [[ "$REF" != "refs/tags/${TAG_NAME}" ]]; then
    fail "Metadata ref mismatch: expected refs/tags/${TAG_NAME}, found $REF"
  fi
fi

if [[ "$ARTIFACT_NAME" != "$ZIP_NAME" ]]; then
  fail "Metadata artifact_name mismatch: expected $ZIP_NAME, found $ARTIFACT_NAME"
fi

if [[ "$ARTIFACT_BYTES" != "$(file_size_bytes "$ZIP_PATH")" ]]; then
  fail "ZIP byte size mismatch for $ZIP_PATH"
fi

if [[ "$ARTIFACT_SHA256" != "$(sha256_file "$ZIP_PATH")" ]]; then
  fail "ZIP SHA-256 mismatch for $ZIP_PATH"
fi

# ── Attestation identity validation ──
# The expected workflow identity is derived from verifier inputs.
# Downloaded metadata's workflow_identity is checked for consistency
# but does not determine the identity passed to gh attestation verify.

if [[ -n "$REPO_NAME" || -n "$TAG_NAME" ]]; then
  require_nonempty "$REPO_NAME" "--repo (required for attestation identity validation)"
  require_nonempty "$TAG_NAME" "--tag (required for attestation identity validation)"

  if [[ -z "$EXPECTED_WORKFLOW" ]]; then
    EXPECTED_WORKFLOW=".github/workflows/fortweb-runtime-package.yml"
  fi

  case "$EXPECTED_WORKFLOW" in
    .github/workflows/*.yml|.github/workflows/*.yaml) ;;
    *)
      fail "--expected-workflow must be a path under .github/workflows/ ending in .yml or .yaml"
      ;;
  esac

  if [[ "$EXPECTED_WORKFLOW" == *'..'* ]]; then
    fail "--expected-workflow must not contain '..'"
  fi

  if [[ "$EXPECTED_WORKFLOW" == /* ]]; then
    fail "--expected-workflow must not be an absolute path"
  fi

  DERIVED_IDENTITY="https://github.com/${REPO_NAME}/${EXPECTED_WORKFLOW}@refs/tags/${TAG_NAME}"

  if [[ "$WORKFLOW_IDENTITY" != "$DERIVED_IDENTITY" ]]; then
    fail "Metadata workflow_identity mismatch: expected ${DERIVED_IDENTITY}, found ${WORKFLOW_IDENTITY}"
  fi

  ATTESTATION_IDENTITY="$DERIVED_IDENTITY"
else
  # Local/offline mode: no verifier-controlled repo or tag.
  # Do not derive attestation trust from downloaded metadata.
  # Attestation identity is intentionally left empty.
  ATTESTATION_IDENTITY=""
fi

if [[ "$MODE" == "release" ]]; then
  printf 'Verifying GitHub Artifact Attestation for %s\n' "$ZIP_PATH"
  attestation_identity_regex="^$(escape_regex "$ATTESTATION_IDENTITY")$"
  gh attestation verify "$ZIP_PATH" \
    --repo "$REPO_NAME" \
    --cert-identity-regexp "$attestation_identity_regex"
else
  printf 'Skipping attestation verification for local-only artifact mode\n'
fi

printf 'Verifying internal FortWeb runtime package contract\n'
node "$FORTWEB_VERIFY_SCRIPT" "$ZIP_PATH"

printf 'Preparing output directory %s\n' "$OUT_DIR"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

printf 'Unpacking verified runtime payload\n'
unzip -q "$ZIP_PATH" -d "$OUT_DIR"

VERIFIED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
case "$OUT_DIR" in
  */assets/fortweb)
    RECEIPT_PATH="${OUT_DIR%/assets/fortweb}/fortweb-verification-receipt.json"
    ;;
  *)
    RECEIPT_PATH="${OUT_DIR}/fortweb-verification-receipt.json"
    ;;
esac

write_receipt \
  "$RECEIPT_PATH" \
  "$VERIFIED_AT" \
  "$REPOSITORY" \
  "$PACKAGE_VERSION" \
  "$COMMIT_SHA" \
  "$REF" \
  "$REF_NAME" \
  "$ARTIFACT_NAME" \
  "$ARTIFACT_SHA256" \
  "$RUNTIME_ORIGIN" \
  "$ENTRYPOINT" \
  "$([[ "$MODE" == "release" ]] && printf 'true' || printf 'false')" \
  "$MODE"

printf 'FortWeb runtime payload verified and unpacked to %s\n' "$OUT_DIR"