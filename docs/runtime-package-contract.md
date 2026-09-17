# FortWeb runtime package contract

## Status

FortWeb implements manifest and release schema version `2.0.0` and runtime
requirements `fort.runtime-requirements.v2`. The package bundles the complete
runtime and permits HTTPS wallet-service data traffic. Earlier importer proof
applies only to its recorded contract and bytes. Mobile consumers must adopt
this revision and run their own checks. No final runtime package has been
published, attested, deployed, or released. The runtime-source archive is a
separate published build input.

## Products

One package operation must produce exactly these three files:

```text
fortweb-runtime-0.0.0.zip
fortweb-runtime-0.0.0.zip.sha256
fortweb-release.json
```

The sidecar contains the ZIP SHA-256. `fortweb-release.json` records the
producer commit, package identity, artifact size and digest, workflow identity,
publication state, and attestation state. A local product must remain
`unpublished` and `not-produced` for attestation.

The ZIP uses one `fortweb-runtime/` prefix and contains:

```text
fortweb-runtime/
  manifest.json
  checksums.sha256
  app/
  contracts/runtime-requirements.json
  pyscript-ci.toml
  vendor/
  wheels/
```

The package stores regular files only. It rejects directory members,
symlinks, hard links, special files, duplicate or case-folded paths, path
escapes, undeclared files, and non-deterministic ZIP metadata.

## Manifest

`manifest.json` uses schema version `2.0.0`, package name
`fortweb-runtime`, producer `fortweb`, payload profile `offline-runtime`, and
entrypoint `app/index.html`.

The manifest must include:

- the exact FortWeb commit and source identity;
- the exact Pyodide, Python, Emscripten, PyEmscripten ABI, Rust, Node, and
  xbuild environment identities;
- the exact Keripy and HIO commits and wheel hashes;
- the runtime tree, runtime closure, wheelhouse manifest, and package input
  hashes;
- the frozen runtime requirements contract;
- one sorted `files` row for every payload file, with its relative path, byte
  count, and lowercase SHA-256.

`checksums.sha256` contains only the exact digest of `manifest.json`. The
portable verifier must validate the external product set, raw ZIP structure,
manifest schema, checksums, file inventory, provenance, release metadata, and
final bytes. Consumers must fail closed on any mismatch.

## Runtime requirements and network traffic

The `offline-runtime` profile means the executable runtime is complete in the
bundle. Startup and local vault recovery must work without remote runtime
acquisition. Network-dependent wallet operations still require service access.

- Load HTML, JavaScript, workers, Python, WASM, wheels, and other runtime assets
  only from the verified bundle. Remote runtime acquisition, executable
  content loading, and CDN fallback are prohibited.
- Allow HTTPS data requests for KF boot, witnesses, watchers, account
  operations, and OOBIs. These service URLs may come from wallet configuration
  or OOBI discovery. Service responses must remain data; they must not become
  scripts, modules, workers, or packages.
- Reject cleartext wallet-service requests and redirects. Configure the final
  HTTPS endpoint directly. Checking a response URL after a redirect cannot
  prevent a request to a cleartext target.

FortWeb enforces the service URL and redirect rules in its browser HTTP
adapter. The wrapper must enforce bundled asset loading, navigation, and
bridge provenance without blocking the allowed HTTPS data requests.

The development bridge enables `fort_wallet_service_http_local_dev` only for
a plain loopback browser location with no origin contract or an explicit
`browser-dev` contract. This setting permits HTTP to exact loopback hosts and
the local development proxy. Native wrapper contracts never enable it, even
when the wrapper serves bundled assets from a loopback origin. The production
default rejects HTTP service traffic.

The consumer selects the concrete document/runtime origin. Neither the
manifest nor release metadata contains `runtime_origin`. Each wrapper must
provide a secure execution context, a stable origin and storage partition,
and exact bridge provenance. Local bundle serving and remote wallet-service
traffic have separate rules. In `fortweb.runtime-origin.v1`, the existing
`capabilities.networkAllowed` flag controls remote runtime bootstrap only;
it remains false and does not prohibit HTTPS wallet-service data.

This revision removes `remote_network_prohibition`, `network_fetch`, and the
blanket loopback-origin prohibition. It adds
`remote_runtime_acquisition_prohibition`, `wallet_service_https`, and explicit
forbidden behaviors for remote runtime acquisition and cleartext service
traffic. Consumers must update their strict schema checks and frozen
requirements bytes together. Unsupported versions must be rejected before
import; the old contradictory contract must not be reinterpreted silently.

## Producer boundary

The producer must build the runtime and package twice from the same frozen
inputs. Both runtime trees and all three package products must be byte
identical. The producer must independently recapture its source and execution
inputs after verification and remove its scratch roots before it publishes an
acceptance pointer.

The required CI job runs `npm run test:build-idempotency`. This builds two
complete runtimes, packages each through the public producer and verifier,
and compares both runtime inventories and the exact bytes of the ZIP,
sidecar, and release JSON. Both passes use the same source, source manifest,
Node executable, and branch ref. Run-specific reports stay outside the three
products; no product fields are excluded from comparison.

Changing source, runtime, wheel, harness, package, or consumer-overlay bytes
invalidates the affected evidence. Do not relabel an older artifact or review.

See [Pyodide 314 wheel and runtime build](pyodide-314-wheel-build.md) for the
fixed toolchain and reproduction gates. See
[Runtime package lineage](runtime-package-lineage.md) for donor attribution and
the current artifact and consumer handoff.

## Consumer import

A consumer must acquire the ZIP by an immutable artifact identity and verify
its SHA-256 before import. The importer must verify the ZIP, manifest,
`checksums.sha256`, all declared payload rows, the runtime requirements
contract, and its platform configuration before it stages bytes.

The recorded Fort iOS importer adds one wrapper-owned root `index.html` after
import. Its producer tree and post-overlay tree therefore have different
digests. The recorded Fortoid importer adds no overlay. Refresh both importer
implementations at handoff, as described in the lineage document. Every consumer must
recompute and record its complete post-overlay digest after any import,
overlay, acquisition, or wrapper change.

Importer and static schema success do not prove execution in WKWebView or
Android WebView. They also do not prove an iOS archive or export, an Android
APK or AAB, publication, deployment, release, or shipping.

## Publication and release

Publication requires a clean source boundary, the exact accepted package
digest, a trusted workflow identity, a verified GitHub artifact attestation,
and an immutable acquisition location. Mobile release requires the final
post-overlay payload to run in each wrapper and requires proof from the final
`.xcarchive`, APK, and AAB. These are separate gates from producer and importer
proof.

The later immutable publisher must reject dirty producer state and pin
privileged Actions to full commit SHAs. Run the iOS App Store content gate
against the exact selected ZIP, then verify the final archive and exported
IPA after the wrapper overlay. Producer CI alone does not establish those
publication or release results.
