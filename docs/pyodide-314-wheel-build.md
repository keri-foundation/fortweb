# Pyodide 314 wheel and runtime build

Build the runtime from an explicit source manifest and SHA-256 digest. The
manifest selects every runtime file and wheel. Builds do not resolve Python
packages from a CDN or a developer checkout in the browser.

## Runtime contract

The browser uses Pyodide 314.0.5, Python 3.14.2, Emscripten 5.0.3, and ABI
`pyemscripten_2026_0_wasm32`. The selected set has 34 normal distributions.
Only the declared HIO and Keripy LMDB requirements are excluded in the browser.

The compiled-wheel baseline is the earlier accepted wheelhouse manifest with
SHA-256 `226411ef256e54c3382f5f845863a032eb13b61ace952b89a6aac04585900af9`.
Its compiled artifacts remain unchanged when normal HIO and Keripy source
wheels are replaced. Building those compiled artifacts from scratch remains a
separate toolchain procedure. The public source producer below verifies and
reuses the selected baseline bytes.

## Strict CSP candidate

For the pinned IPEX candidate only, `scripts/prepare_csp_runtime_source.py`
derives a new source tree from the exact baseline manifest identified in the
script. It verifies every copied file, the Pyodide loader, and the `pysodium`
wheel. It replaces one dynamic side-module callback loader with static functions
generated from the two exact callbacks in that wheel. Other callbacks fail
closed. The derived manifest records the original manifest, loader, wheel,
and producer digests; the baseline is not modified.

```sh
python3 scripts/prepare_csp_runtime_source.py \
  --baseline build/verified-ipex-runtime-source \
  --output build/runtime-source-csp
```

Use the printed digest as `FORTWEB_RUNTIME_SOURCE_MANIFEST_SHA256` and the new
manifest as `FORTWEB_RUNTIME_SOURCE_MANIFEST` for the normal build and package
steps below. The vendored PyScript worker-hook change accepts only the pinned
default hook. These changes do not themselves enforce a content-security policy;
each host must enforce and test its own policy before declaring v2 compatible.
Other Pyodide code paths may still require dynamic evaluation and fail under a
strict policy. The original runtime remains a separate artifact.

## Build normal source wheels

`scripts/build_runtime_source.py` accepts a verified baseline, a source
declaration, and package provenance. It builds each HIO and Keripy wheel twice,
checks byte equality and wheel RECORD entries, and composes a new runtime
source. Every source archive and patch must have an explicit SHA-256 digest.
Archive and patch paths are relative to the source declaration file.

Use the [published HIO 0.7.20 source archive](https://files.pythonhosted.org/packages/ce/71/1abecf7fcc42bf84c81b35ca9cfcee84f63b81b72bd0115577ebc18d31cb/hio-0.7.20.tar.gz).
Its SHA-256 is `f88bd74fa5d680697f24b565cdfbc543224607222720687e2fc0d2cd67ccd70f`.
The `v0.7.20` tag points to commit `92cd92e3c7dbf34577c2128c68eec75669ff833f`.

Create the Keripy archive with `git archive --format=tar <commit>`, using
`8ec740aec6dd349471056fea909828fbb6c3ea1b`, which pins `hio==0.7.20` in setup.py.
Archives can have setup.py at the
root or inside one top-level directory, as in a published source distribution.
Record working changes as a separate binary Git diff. The producer records
each applied patch in the wheel's `origin.patches` list. It does not require
a HIO metadata patch. Older package manifests can retain their recorded
`metadata_patch_sha256`; new builds omit that field.

A declaration for these committed sources is:

```json
{
  "schema": 1,
  "sources": [
    {
      "distribution": "hio",
      "repository": "https://github.com/ioflo/hio",
      "commit": "92cd92e3c7dbf34577c2128c68eec75669ff833f",
      "archive": "hio-0.7.20.tar.gz",
      "sha256": "f88bd74fa5d680697f24b565cdfbc543224607222720687e2fc0d2cd67ccd70f",
      "patches": []
    },
    {
      "distribution": "keri",
      "repository": "https://github.com/evanja57/keripy",
      "commit": "8ec740aec6dd349471056fea909828fbb6c3ea1b",
      "archive": "keri.tar",
      "sha256": "65902f2d73b16fb4287d8a6e1d81fd4adf564c382181dafbaa9954642e59bea6",
      "patches": []
    }
  ]
}
```

Use an environment with setuptools and wheel installed. Package provenance
records the baseline, package commits, compiled toolchain, and historical
consumer snapshots; it does not assert that those consumers ran this build.

```bash
python3 scripts/build_runtime_source.py \
  --baseline "$BASELINE" --baseline-sha256 "$BASELINE_SHA256" \
  --sources "$SOURCES_JSON" --sources-sha256 "$SOURCES_SHA256" \
  --package-inputs "$PACKAGE_INPUTS" --package-inputs-sha256 "$PACKAGE_INPUTS_SHA256" \
  --output build/runtime-source \
  --archive-output build/runtime-source.tar.gz
```

Outputs must be new. The command prints the new manifest path and digest.
Retain the source declaration and patches with the build evidence. Compare
packaged source modules and dependency metadata with the patched source before
promoting a changed wheel.

### Browser ACDC import patch

The optional [`keripy-pyodide-acdc-imports.patch`](../scripts/patches/keripy-pyodide-acdc-imports.patch)
allows ACDC message construction in Pyodide without importing the native LMDB
registry classes. Native Python keeps those imports. Copy the patch beside the
source declaration and include it in the Keripy source entry:

```json
"patches": [{
  "path": "keripy-pyodide-acdc-imports.patch",
  "sha256": "8de46e856d6fc68f7096a4e25ca169cbf3caaf92037b0f71e79c5ee09e4c1177"
}]
```

Build a new runtime source and use its manifest and digest when running the
runtime builder. The published default source remains unpatched until a new
reviewed source archive is published and pinned. Set
`FORTWEB_EXPECT_BROWSER_ACDC=1` when running the WebBaser lifecycle browser test
against a runtime built with this patch; the unpatched runtime must reject the
operation without interrupting the vault worker.

The `credentials.issueSigned` worker method creates a schema-validated signed
ACDC for a known remote identifier and returns its CESR bytes. It does not store
or deliver the credential, create a registry, track revocation, or verify receipt.
The caller must retain the returned bytes and the recipient must verify issuer
authentication independently. This patch does not enable V2 browser registry
management or change the pinned KERIpy issuer-authentication implementation.
The patched-runtime browser test writes a synthetic credential, issuer history,
and schema to its Playwright output directory. In an environment with Locksmith
installed, set `FORTWEB_CREDENTIAL_INTEROP_DIR` to that directory and run
`python -m unittest python.test_credential_issuance.CredentialIssuanceTest.test_browser_output_with_locksmith_issuer_authentication`
to verify the result independently.

### Browser registry backend patch

The optional [`keripy-pyodide-registry.patch`](../scripts/patches/keripy-pyodide-registry.patch)
avoids the native registry import in Pyodide, adds the browser alias store, and supplies
the ordered KEL iterator used by registry anchor discovery. Apply it after the
ACDC import patch and record its digest in the source declaration. Browser
registry management requires a pre-opened WebRegBaser with alias storage; the
native backend keeps its existing behavior. FortWeb validates persisted TEL
indexes and KEL anchors when looking up a registry; the underlying manager
does not provide these browser recovery checks on its own. FortWeb records an incomplete
operation before signing, and refuses further registry operations if a failure
leaves that marker behind. Automatic recovery of such operations is not yet
available; do not clear the marker or discard evidence without verified recovery.
Set `FORTWEB_EXPECT_REGISTRY_BACKEND=1` to run
`playwright/registry-backend.spec.ts` against this patch.

The worker exposes `registries.create` with `vaultId`, `issuerAid`, and `name`,
and `registries.get` with `vaultId` and `name`. Each returns the registry ID,
issuer, base64-encoded inception event, and public issuer KEL. A registry with
unresolved or incomplete evidence is rejected without deleting that evidence.

`credentials.issueRegistered` accepts `vaultId`, registry `name`, `requestId`,
`issuerAid`, `recipientAid`, `schemaId`, and `attributes`. It signs the ACDC,
anchors and accepts its KERIpy blindable update, and persists the credential
and disclosure before returning. Reusing a request ID with the same input
returns the existing issuance; conflicting input is rejected.
`credentials.getIssued` retrieves the stored evidence using `vaultId`, registry
`name`, and `requestId`. Both return the signed CESR, issuance sequence,
disclosed blinder, registry TEL and public issuer KEL. Treat the blinder and
credential as private disclosure material. The vault substore uses plain-value
browser IndexedDB and does not separately encrypt this material; same-origin
code with storage access can read it. Browser test artifacts contain synthetic
disclosure material and should be handled accordingly.

The TEL may contain later blinded updates. A verifier can bind the credential
to the chain through its issuance sequence and independently validate the full
chain; later blinded events do not by themselves reveal the credential's current
status. Revocation, credential delivery, and automatic recovery of interrupted
operations are not implemented.

The experimental `credentials.receive` and `credentials.getReceived` methods
are disabled unless the local runtime configuration explicitly sets
`fort_synthetic_recipient_testing` to `true`. Both require `syntheticOnly: true`
and a passcode-protected recipient vault. This is an explicit test-data
acknowledgment, not a way to detect whether supplied data is actually synthetic.
Do not use real personal data with this experimental path.

Receipt accepts the existing issuance result as an evidence object, alongside
the expected issuer, local recipient, and an already imported schema ID. It
verifies the signed KEL, signature, schema, TEL chain, anchors and blinded
issuance binding in temporary KERI storage. It reports the verified supplied
head separately from current status, which is always unknown without fresh
authoritative evidence. The local object wraps CESR and TEL events; it is not
an IPEX message. The current verifier supports non-delegated issuer histories
without endpoint reply messages and rejects unsupported evidence.

Received evidence is encrypted using the existing passcode-backed KERI key
manager before storage in the recipient vault; the storage key still reveals
the credential SAID and that a record exists. An interrupted write can leave a
pending marker that blocks receipt operations; automatic recovery is not
implemented. The issuer's existing issuance records remain plaintext.
More seriously, current vault registry records also contain a plaintext root
used for deterministic signing-key derivation. A party able to read that
browser storage can reconstruct signing authority even while a passcode vault
is closed. Recipient-record encryption does not fix this signing-root exposure,
protect the unlocked vault against same-origin code, or establish that any
existing identity is safe for sensitive use.

The browser registry test writes initial and recovered public evidence to its
Playwright output directory. Set `FORTWEB_REGISTRY_INTEROP_DIR` to that
directory and run `python -m unittest python.test_registry_interop` with a
compatible native KERIpy to verify both KEL anchors and the inception event.
Run `playwright/registry-issuance.spec.ts` with
`FORTWEB_EXPECT_REGISTRY_BACKEND=1`; it writes synthetic evidence. Set
`FORTWEB_ISSUANCE_INTEROP_DIR` to its output directory and run
`python -m unittest python.test_registered_issuance_interop` with compatible
native KERIpy to verify issuance and disclosure independently.

### Presentation-registry candidate patch

The optional [presentation-registry patch](../scripts/patches/keripy-pyodide-presentation-registry.patch)
is the minimal candidate that applies after the ACDC import and registry backend
patches. Its SHA-256 is
`40df4696a7211c14669b8dcaf7f0d36df46ba1069ec8eac917de63b38c2b573c`.
It adds browser-runtime `Registry.present` and `Registrar.present` support so
`registries.present` can bind an already-created Grant SAID, anchor the TEL
event in the holder KEL, and persist the verified binding. Run the focused
[registry receipt test](../playwright/registry-receipt.spec.ts) with both
`FORTWEB_EXPECT_REGISTRY_BACKEND=1` and
`FORTWEB_EXPECT_PRESENTATION_REGISTRY=1` against a runtime built with this
patch.

This is a source-build candidate, not part of the published source archive or
the default runtime pin. Use the full IPEX V2 patch below for final-Grant proof
assembly and verifier acceptance. This smaller patch proves binding creation,
persistence, idempotence, and invalid-SAID rejection only.

### Full IPEX V2 candidate patch

The [IPEX V2 patch](../scripts/patches/keripy-pyodide-ipex-v2.patch) backports
the seven coupled Keripy modules from upstream commit
`790797bcdef8322adb86eeb762f4610f481a3ce7`; its SHA-256 is
`73eee9ad3465d4a47ebb84d21ee3231d4aa180026d29a7d86d5e2dd9642f55f2`.
It includes upstream presentation-registry support, strict exchange evidence
verification, and KRAM storage. Apply it after the ACDC import and registry
backend patches, instead of the smaller presentation-registry patch above, and
then apply the exchange-storage patch below.

The combined candidate has focused Chromium evidence for a synthetic
registry-bound presentation: the holder creates a Grant, binds its SAID in the
declared presentation registry, attaches issuer and holder TEL proofs plus the
holder KEL anchor, and the independent verifier accepts that exact Grant.
Run [registry receipt](../playwright/registry-receipt.spec.ts) with
`FORTWEB_EXPECT_REGISTRY_BACKEND=1` and
`FORTWEB_EXPECT_PRESENTATION_REGISTRY=1` for that route, and without
`FORTWEB_EXPECT_PRESENTATION_REGISTRY` for the retained evidence-only
Grant/Admit route.

It remains a synthetic, source-build candidate. This evidence does not make it
a published runtime or establish SEDI interoperability with external agents,
real credentials, or mobile clients.

### IPEX exchange-storage candidate patch

The optional [IPEX exchange-storage patch](../scripts/patches/keripy-pyodide-ipex-exchange-storage.patch)
adds the `ests.` source-seal store and `eidx.` accepted-endorser index required
by the newer exchange verifier. Its SHA-256 is
`8e2d4b09a1a822358fa0cfb036cd7efad7b69c912c579dd2bd7441cacba93437`.
Apply it after the full IPEX V2 patch; the focused presentation verification
above depends on both patches. This patch only makes the browser store surface
compatible with the upstream verifier; it does not by itself supply the full
IPEX V2 backport or prove native verifier acceptance.

### Promoting a patched source archive

The source archive is a separate release input from the runtime package. After
reviewing and publishing a source archive, update the source URL, archive
SHA-256, and manifest SHA-256 together in
`.github/actions/produce-runtime-package/action.yml`. Do not point the default
pin at an unpublished archive. Retain the prior three values for rollback.

The shared browser acceptance action runs the lifecycle suite without
`FORTWEB_EXPECT_BROWSER_ACDC`. When promoting this patch, set that variable to
`1` for its lifecycle step in the same reviewed pin change; otherwise the suite
expects the unpatched runtime to reject credential construction. Supporting
both patched and unpatched branch overrides requires passing the matching
expectation through the workflow; the current workflow has no such input.
Verify the produced runtime and its complete browser acceptance sequence before
using it as a release candidate. Tag-based releases reject source overrides and
consume the reviewed default pin.

## Acquire, build, and verify

For a published runtime-source archive, supply both archive and manifest
identities. The CI workflow pins the public URL and both digests in Git so
fork PRs can use the same input. Update all three values together when the
runtime source changes. Manual workflow runs can supply a different URL and
both matching digests.

```bash
python3 scripts/acquire_runtime_source.py \
  --url "$FORTWEB_RUNTIME_SOURCE_URL" \
  --sha256 "$FORTWEB_RUNTIME_SOURCE_ARCHIVE_SHA256" \
  --manifest-sha256 "$FORTWEB_RUNTIME_SOURCE_MANIFEST_SHA256" \
  --output build/runtime-source

export FORTWEB_RUNTIME_SOURCE_MANIFEST=build/runtime-source/manifest.json
export FORTWEB_RUNTIME_SOURCE_MANIFEST_SHA256=<manifest-sha256>
npm ci
npm run typecheck
npm run build:runtime
npm run check:runtime-js
python3 scripts/verify_runtime_tree.py \
  --runtime-dir dist/runtime \
  --source-manifest "$FORTWEB_RUNTIME_SOURCE_MANIFEST" \
  --inventory-output test-results/runtime-inventory.json \
  --report-output test-results/runtime-verification.json
```

The builder generates the closure digest in the packaged PyScript config.
The independent verifier checks the complete inventory, selected input bytes,
and a fresh compilation of current TypeScript. File counts and runtime hashes
come from the generated inventory, not a previous acceptance run.

## Browser and package proof

Vault opening checks local identifier histories and signing-key state, and
refuses incomplete or conflicting state. A failed flush blocks further use of
the open vault until its close is retried. These checks do not repair persisted
data. Cooperating wallet workers use an exclusive browser Web Lock while a
vault is open and reject access when the lock is unavailable or busy.

New vaults use the `@fortweb-v2/` storage namespace, separate from the legacy
`@fortweb/` namespace. Their keys are generated in the new vault; legacy keys
and identities are not migrated. Older vaults remain in legacy storage and are
not available in the new vault list. Copying legacy signing authority into the
new namespace would not make that identity safe from a legacy writer.

Web Locks cannot prevent code that ignores the lock from writing the same
IndexedDB data. The namespace boundary protects against the normal paths of
legacy FortWeb workers, not arbitrary same-origin code or copies of signing
keys outside this storage. Different browser origins and application containers
are separate lock and storage scopes. Web Lock availability and storage scope
in the target iOS and Android WebViews remain unverified.

The mixed-version lifecycle test requires `FORTWEB_LEGACY_RUNTIME_DIR` to point
to a verified legacy runtime tree; without it the test is skipped. Existing
legacy signing identities are not eligible for protected use until a separate
safe migration procedure has been established.

Run the wheelhouse, WebBaser lifecycle, runtime canary, and application suites.
The lifecycle suite uses new workers for persistence and recovery. It checks
multi-witness receipt validation, invalid and repeated receipts, nested EXN
storage, OOBI resolution, and absence after clear.

Build two runtimes from frozen inputs. Package each into a new product folder:

```bash
npm run package:runtime -- --python python3 --output-dir dist/package
npm run verify:runtime-package -- --product-dir dist/package
python3 scripts/serve_local.py \
  --runtime-dir /absolute/extracted/fortweb-runtime --port 8765 --no-open
```

Require identical ZIP, sidecar, and release metadata bytes. The package command
records current source, complete runtime inventory, and package provenance.
The extracted-runtime server serves only that tree. Its optional local API
proxy accepts explicit loopback HTTP(S) destinations for local service tests.

Test hosted onboarding with both 1-of-1 and 3-of-4 profiles. Verify service key
state, receipt signatures, enabled watcher observation, and account queries.
Lock and reload the browser, then confirm the same persisted account state.
This proves the local producer and browser flow. Publication and mobile wrapper
execution require their own source and artifact evidence.
