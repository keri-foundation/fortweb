# FortWeb Runtime Package Contract

## Status
**Proposed / Draft** — This document is intended for team review to establish a stable contract for FortWeb runtime package consumption by mobile wrappers.

## Goals
Define a concrete, versioned, and manifest-verified runtime package artifact for FortWeb releases. This contract ensures that iOS (`Fort-ios`) and Android (`fortoid-scaffold`) wrappers can consume FortWeb releases cleanly, repeatably, and without relying on ad-hoc Git checkout directory copies.

## Non-goals
- This document does not implement packaging scripts or GitHub Actions workflows.
- This document does not modify mobile wrapper source code or sync mechanisms.
- This document does not alter FortWeb runtime behavior, build output structure, or Playwright test suites.

## Current State
- **FortWeb Build Output**: `npm run build:runtime` compiles TypeScript sources and copies static assets (`pyscript-ci.toml`, `app/runtime/*.py`, `vendor/pyscript/2025.11.2`) into `dist/runtime/`.
- **iOS Consumption**: `Fort-ios` uses `sync-payload.sh` to copy `app/`, `vendor/`, `wheels/`, and `pyscript-ci.toml` from a local or fetched FortWeb Git checkout into `WebPayload/`, followed by validation via `validate-mobile-payload.mjs`.
- **Android Consumption**: `fortoid-scaffold` uses `sync-payload.sh` to copy the same assets into `app/src/main/assets/payload/fortweb/`, generating a `build-manifest.json` via `gen-fortweb-bundle-manifest.mjs`.
- **Gap**: Current flows depend on live Git checkouts or shallow fetches, lacking a stable, versioned, and integrity-verified package artifact.

## Artifact Name
```text
fortweb-runtime-${version}-${shortSha}.zip
```
- **PR Preview Builds**: May use a placeholder version such as `0.0.0-pr+<pr-number>`.
- **Release Builds**: Should use semantic versions aligned with tags, e.g., `v1.2.3`.

## Package Root Layout
The ZIP archive must contain a single top-level directory named `fortweb-runtime/` with the following structure:
```text
fortweb-runtime/
  manifest.json
  checksums.sha256
  app/
  vendor/
  wheels/
  pyscript-ci.toml
```
*Note: The `dist/runtime/` prefix is flattened to the root of the package for cleaner mobile extraction paths.*

## Manifest Schema
The `manifest.json` file must adhere to the following schema:
```json
{
  "schemaVersion": 1,
  "packageName": "fortweb-runtime",
  "version": "0.0.0-pr+24",
  "gitSha": "0be8e7e734b524b9e1bb10b172eff82e87cfc498",
  "gitRef": "refs/pull/24/head",
  "createdAt": "2026-06-04T12:00:00Z",
  "basePath": "/fortweb/app/",
  "entrypoint": "app/index.html",
  "runtimeRoot": ".",
  "vendorRoot": "vendor",
  "wheelsRoot": "wheels",
  "originContract": {
    "schema": "fortweb.runtime-origin.v1",
    "version": 1
  },
  "files": [
    {
      "path": "app/index.html",
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "bytes": 1024
    }
  ]
}
```
- **`files` array**: Must include every file in the package, sorted deterministically by `path`.
- **`sha256`**: Lowercase hexadecimal SHA-256 hash of the file contents.
- **`bytes`**: Exact file size in bytes.

## Integrity Strategy
- **Per-File Hashing**: Every file in the package must have a SHA-256 hash recorded in `manifest.json`.
- **Deterministic Ordering**: The `files` array must be sorted lexicographically by `path` to ensure reproducible manifest generation.
- **Package Checksum**: A `checksums.sha256` file must be included at the root, containing the SHA-256 hash of the `manifest.json` file itself.
- **No Secrets**: The package must not contain any environment-specific secrets, credentials, or private keys.
- **Fail-Closed**: Mobile consumers must treat any checksum mismatch or missing file as a fatal error and refuse to load the payload.

## iOS Consumer Contract
`Fort-ios` should adopt the following consumption model:
1. **Acquisition**: Fetch the artifact by version/SHA (e.g., via GitHub Release asset or manifest-driven download).
2. **Verification**: Validate the `checksums.sha256` against the extracted `manifest.json`, then verify every file's SHA-256 hash.
3. **Extraction**: Extract the contents into the designated `WebPayload/` directory (or an agreed-upon payload directory).
4. **Validation**: Run the existing `validate-mobile-payload.mjs` script against the extracted payload.
5. **Loading**: Load the payload via the existing WKWebView strategy (custom scheme `app://local` or hardened loopback `http://127.0.0.1:<port>/_fortios/<nonce>`).
6. **Decoupling**: Once package support lands, iOS should not assume or rely on the source Git checkout structure.

## Android Consumer Contract
`fortoid-scaffold` should adopt the following consumption model:
1. **Acquisition**: Fetch the artifact by version/SHA.
2. **Verification**: Validate the `checksums.sha256` against the extracted `manifest.json`, then verify every file's SHA-256 hash.
3. **Extraction**: Extract the contents into the Android assets directory (e.g., `app/src/main/assets/payload/`).
4. **Validation**: Run the existing manifest validation logic.
5. **Loading**: Load the payload via the agreed-upon strategy (e.g., `file:///android_asset/payload/fortweb/app/index.html` or `WebViewAssetLoader`).
6. **Decoupling**: Once package support lands, Android should not assume or rely on the source Git checkout structure.

## Workflow Model Options
| Option | Pros | Cons | Risks | Best Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **PR Preview Artifact** | Fast feedback, no tag required, easy to validate packaging logic. | Artifacts expire (90 days), not suitable for permanent mobile builds. | Mobile builds may fail if artifact expires. | Short-term validation, PR review. |
| **GitHub Release Asset** | Permanent, versioned, immutable, supports checksums natively. | Requires tag creation, slightly more complex workflow. | None significant if tagging is disciplined. | Long-term production releases. |
| **Pull-by-Manifest** | Mobile repos declare dependency version, automated fetch at build time. | Requires mobile repo script changes, network dependency at build time. | Build failures if FortWeb release is deleted/unavailable. | Long-term, automated mobile CI/CD. |
| **Manual Vendoring** | Simple, no network dependency at build time. | High friction, easy to forget updates, no automated verification. | Drift between FortWeb and mobile payloads. | Legacy fallback, not recommended. |

## Recommended Approach
- **Short-term**: Implement a package script and a PR preview GitHub Actions artifact workflow to validate the packaging logic and manifest generation without committing to a release strategy.
- **Long-term**: Transition to tag-based GitHub Release assets combined with a pull-by-manifest strategy for mobile repos, ensuring immutable, versioned dependencies with automated verification.

## Open Questions
1. Should mobile apps vendor the extracted payload (commit to their repos) or fetch it dynamically during their build process?
2. Should FortWeb publish package artifacts on every PR, every main push, tags, or workflow dispatch only?
3. Should mobile wrappers verify checksums at build time, startup, or both?
4. Should package versioning be independent from mobile app versions, or tightly coupled?
5. Does the origin contract require specific hostnames or loopback ports that must be explicitly documented in the manifest?
6. Should the package include PyScript/vendor files, or should wrappers manage those dependencies separately?
7. What rollback strategy should mobile apps support if a newly fetched payload fails validation?

## Implementation Slices
- `FORTWEB-RUNTIME-PACKAGE-SCRIPT-PROTOTYPE-001`
- `FORTWEB-RUNTIME-PACKAGE-WORKFLOW-PROTOTYPE-001`
- `FORTWEB-MOBILE-PAYLOAD-CONSUMPTION-AUDIT-001`
- `FORTWEB-MOBILE-PAYLOAD-PULL-BY-MANIFEST-PLAN-001`