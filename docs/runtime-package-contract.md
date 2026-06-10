# FortWeb Runtime Package Contract

## 1. Purpose
This document defines the formal producer/consumer contract for FortWeb runtime packages consumed by mobile applications (Android and iOS). It establishes the required artifact structure, metadata, integrity checks, and authenticity guarantees to ensure secure, deterministic, and verifiable runtime deployments.

## 2. Scope
This contract covers:
- The runtime ZIP package structure and contents.
- The `manifest.json` schema and `checksums.sha256` format.
- Release asset naming conventions.
- Authenticity, signature, and provenance requirements.
- Android and iOS consumer verification expectations.
- GitHub Actions publishing guarantees.

This contract **does not yet implement**:
- Production artifact download logic in mobile apps.
- Cryptographic signing workflows in GitHub Actions.
- Mobile production import mechanisms.

## 3. Artifact Set
A complete FortWeb runtime release must consist of the following assets, published together:

```text
fortweb-runtime-<version>-<commit-sha>.zip
fortweb-runtime-<version>-<commit-sha>.zip.sha256
fortweb-runtime-<version>-<commit-sha>.zip.sig (or .attestation)
```

- **`.zip`**: The deterministic runtime payload.
- **`.zip.sha256`**: The checksum file for ZIP-level integrity verification.
- **`.zip.sig` / `.attestation`**: Cryptographic signature or SLSA provenance proving the artifact originated from the trusted FortWeb release process.
- **Internal files**: The ZIP must contain `manifest.json` and `checksums.sha256` at its root to verify unpacked contents.

## 4. Runtime ZIP Contents
The ZIP archive must contain a flat or predictably structured directory (e.g., `fortweb-runtime/`) including:

**Required:**
- `manifest.json`
- `checksums.sha256`
- `index.html` (or defined entrypoint)
- Runtime asset files (e.g., `app/`, `vendor/`, `wheels/`, `pyscript-ci.toml`)

**Forbidden:**
- Path traversal entries (e.g., `../`).
- Absolute paths.
- Symlinks (unless explicitly supported and verified by consumers).
- Duplicate ZIP entries.
- Files not explicitly listed in `manifest.json`.
- Secrets, environment-specific credentials, or private keys.

## 5. Manifest Schema
The `manifest.json` file must adhere to the following schema:

```json
{
  "schema_version": "1.0.0",
  "package_version": "0.1.0",
  "fortweb_commit_sha": "1e3870ad7632654dfbdebad0a0d03d120225a96c",
  "runtime_origin": "https://appassets.androidplatform.net",
  "entrypoint": "index.html",
  "files": [
    {
      "path": "index.html",
      "sha256": "125c6f6c4ea343964f789ecb20ae9f7021e042e7db27e1257a6e0f7c395cfa59",
      "bytes": 126
    }
  ]
}
```

**Required Fields:**
- `schema_version`: Contract version (e.g., `"1.0.0"`).
- `package_version`: Semantic version of the package.
- `fortweb_commit_sha`: Exact Git commit hash of the producer.
- `runtime_origin`: Trusted origin string for the runtime environment.
- `entrypoint`: Expected entrypoint file (e.g., `"index.html"`).
- `files`: Array of objects, each containing `path`, `sha256` (lowercase hex), and `bytes`.

**Planned/Future Fields:**
- `build_timestamp`: ISO 8601 timestamp of generation.
- `workflow_run_id`: GitHub Actions run ID for traceability.
- `minimum_consumer_contract_version`: Minimum mobile app version required to consume this package.

## 6. Integrity Rules
Mobile consumers and CI verifiers **must** enforce the following rules:

1. Verify `manifest.json` exists in the ZIP.
2. Verify `checksums.sha256` exists in the ZIP.
3. Verify the SHA-256 hash of `manifest.json` matches the single line in `checksums.sha256`.
4. Verify every file listed in `manifest.json` exists in the ZIP.
5. Verify the SHA-256 hash of each file matches the manifest.
6. Verify the byte size of each file matches the manifest.
7. **Reject** if any manifest-listed file is missing.
8. **Reject** if any file exists in the ZIP that is not listed in the manifest (unexpected files).
9. **Reject** any path containing `..` or starting with `/` (path traversal/absolute paths).
10. **Reject** duplicate ZIP entries or symlinks (unless explicitly supported and hardened).

## 7. Authenticity and Provenance
**Integrity** ensures bytes match expected hashes. **Authenticity** proves the bytes came from the trusted FortWeb release process.

**Current State:** PR27 implements integrity checks (checksums, SHA-256, byte-size, unexpected-file rejection) but **does not yet implement authenticity**.

**Required for Production:**
Before mobile apps consume production artifacts, the workflow must attach an authenticity proof.
- **Selected Mechanism**: **GitHub Artifact Attestations**. The workflow uses `actions/attest@v4` to generate an OIDC-backed provenance statement, requiring `id-token: write` and `attestations: write` permissions.
- **Deferred**: Detached signatures (e.g., `minisign`/`cosign`) remain deferred in favor of the built-in GitHub provenance model.

*Production mobile import must not be considered complete until authenticity verification is implemented and enforced in the mobile CI pipelines (e.g., via `gh attestation verify`).*

## 8. GitHub Actions Publishing Requirements
The release workflow must guarantee:

- **Trigger**: Publish only from protected `main` branch pushes or signed/versioned Git tags. **Never** publish release artifacts from `pull_request` contexts.
- **Permissions**: Use least-privilege permissions. `contents: write` only for the release publishing job. `id-token: write` only if using OIDC/attestation.
- **Verification**: Run `verify:runtime-package` immediately after generation and again after any upload/download step.
- **Fail Closed**: The workflow must fail if the manifest, checksum, signature, or provenance generation fails.
- **Deterministic Naming**: Use GitHub context variables (`${{ github.sha }}`, `${{ github.ref_name }}`) to name artifacts predictably.
- **Concurrency**: Use concurrency controls to prevent overlapping release jobs.
- **Secrets**: No secrets exposed to PR workflows or untrusted contexts.

## 9. Android Consumer Requirements
Android production import must eventually:

- Download artifacts only from the trusted GitHub Releases API or pinned CDN.
- Verify the external ZIP checksum (`.zip.sha256`) before unpacking.
- Verify the signature/provenance (`.zip.sig` or attestation) before unpacking.
- Enforce all internal integrity rules (manifest, checksums, file hashes, path traversal rejection).
- Cache only fully verified packages.
- Fail closed to a safe state (e.g., "Update Required" screen) if verification fails.
- **Never** execute or load unverified package contents.
- Keep the current debug fixture behavior strictly separate from production import logic.

*Current Android Status:* Debug fixture path exists and is gated to debug builds. Production import is not yet implemented.

## 10. iOS Consumer Requirements
iOS production import must mirror the Android requirements:

- Download from trusted sources.
- Verify external checksum and signature/provenance.
- Enforce internal integrity rules.
- Fail closed on verification failure.

*Current iOS Status:* Local ZIP consumer lane exists (PR30), but production artifact alignment and verification are pending.

## 11. Open Decisions
The following items require explicit resolution before production implementation:

1. **Signature Mechanism**: GitHub Artifact Attestations vs. `minisign`/`cosign` detached signatures.
2. **Provenance Format**: Whether mobile consumers will verify GitHub attestations directly or use a pinned public key.
3. **Release Trigger Policy**: Whether to publish on every `main` push or only on explicit Git tags.
4. **Artifact Retention**: How long PR preview artifacts are retained vs. permanent release assets.
5. **Rollback/Version Policy**: How mobile apps handle downgrades or rollback to a previously verified package.
6. **SBOM**: Whether a Software Bill of Materials is required for compliance.
7. **Duplicate ZIP Entry Enforcement**: Whether the current verifier explicitly rejects duplicate entries (requires hardening if not).

## 12. Next Implementation Slices
To progress toward production readiness, the following slices are recommended:

- `FORTWEB-RELEASE-ASSET-SIGNATURE-PLAN-001`: Design and implement the authenticity/provenance mechanism.
- `FORTWEB-RELEASE-ASSET-WORKFLOW-HARDENING-001`: Harden the GitHub Actions workflow to enforce publishing constraints and fail-closed verification.
- `ANDROID-PRODUCTION-RUNTIME-ARTIFACT-IMPORT-PLAN-001`: Design the Android production download and verification pipeline.
- `IOS-RUNTIME-PACKAGE-CONTRACT-ALIGNMENT-001`: Align the iOS consumer (PR30) with this formalized contract.