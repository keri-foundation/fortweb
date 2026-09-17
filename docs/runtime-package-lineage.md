# Runtime package lineage

FortWeb adapted selected ideas from three pull requests by Jay. The implementation was written in this branch. No donor commit was cherry-picked.

| Donor | Frozen donor commit | Adapted behavior |
| --- | --- | --- |
| [PR #27](https://github.com/keri-foundation/fortweb/pull/27) | [`e079701a337468acb1484a1c2cf86acc517d8464`](https://github.com/keri-foundation/fortweb/commit/e079701a337468acb1484a1c2cf86acc517d8464) | Runtime package contract, release metadata, package manifest and verifier structure, local server guidance, copy icon, and modular worker behavior. |
| [PR #32](https://github.com/keri-foundation/fortweb/pull/32) | [`2d7c0883798a75b074407a3e205391c7e4195ba2`](https://github.com/keri-foundation/fortweb/commit/2d7c0883798a75b074407a3e205391c7e4195ba2) | Empty-state, route, sidebar, runtime-origin, and browser-noise test cases. |
| [PR #35](https://github.com/keri-foundation/fortweb/pull/35) | [`b179e868c997d29479a61ecec8ad5834a00d1578`](https://github.com/keri-foundation/fortweb/commit/b179e868c997d29479a61ecec8ad5834a00d1578) | Pyodide boot canary, runtime configuration, and browser integration test structure. |

Jay authored the donor commits. His recorded commit email is `alexander.elliot.it@protonmail.com`.

## Adaptation boundary

FortWeb keeps the donor concepts only where they match the Pyodide 314 runtime design. It replaces the legacy Pyodide 0.29.3 and CPython 3.13 package set, old `hio_web` and `keri_web` wheels, `pychloride`, absolute runtime paths, the monolithic worker, hard-coded origin data, and drawer-only readiness checks.

The committed source boundary includes the runtime package schema and reusable manifest, metadata, deterministic ZIP, and verifier primitives. The public package entrypoint is tools/package-runtime.mjs. It captures current source and verifies the compiled runtime before packaging. Previous acceptance-run orchestration remains historical evidence. A later source change must rebuild the runtime and package before any extracted-package or consumer claim is valid.

The eventual pull request description must retain this attribution and the no-cherry-pick statement.

## Current producer inputs

The public producer captures FortWeb's current source, including working
changes. Use the published HIO 0.7.20 source archive, whose release tag points
to commit `92cd92e3c7dbf34577c2128c68eec75669ff833f`, and Keripy webbaser commit
`8ec740aec6dd349471056fea909828fbb6c3ea1b` with its direct `hio==0.7.20`
dependency. Both source inputs build without a patch. The compiled baseline remains the
accepted Pyodide 314 wheelhouse. See the build document for the input format
and commands.

`tools/package-runtime.mjs` verifies current source and runtime bytes before it
produces the ZIP, sidecar, and release metadata. A source, runtime, wheel,
harness, or package change requires fresh products and evidence. The
[runtime source archive](https://github.com/keri-foundation/fortweb/releases/tag/runtime-source-pyodide-314-hio-0.7.20-20260910)
is published. CI pins its URL and both archive and manifest digests.

## Mobile consumer handoff

The following source snapshots record the earlier importer/schema handoff.
They are historical evidence, not current mobile heads or acceptance of the
revised producer contract. Refresh each consumer branch and inspect its
importer before a new package handoff.

| Consumer | Historical validated source | Recorded import overlay | Handoff checks |
| --- | --- | --- | --- |
| Fort iOS PR #34 | `095663cec33745714a3bf22f15a5d0a8d4608d3c` | Adds wrapper-owned root `index.html` | Verify immutable package acquisition and ensure archive/export use the same imported package. |
| Fortoid PR #24 | `ac1e47fcd1d3f34cbb18482f205ac675b13fdad7` | None | Verify immutable package acquisition and the Pyodide 314 runtime/ABI assumptions. |

The package manifest contains the consumer snapshots that were frozen when the
producer ran. A later live importer gate is a separate record and can use a
newer consumer head. It does not rewrite or relabel the package manifest.

Both consumers must adopt manifest/release schema `2.0.0` and runtime
requirements `fort.runtime-requirements.v2`. The shared package has no fixed
document origin. Its contract prohibits remote runtime acquisition and
permits HTTPS wallet-service data. Each wrapper must enforce these rules and
record its own origin and storage configuration.

Fort iOS package-import checks do not prove its archive and export path. The
recorded snapshot used source synchronization in archive/export targets and
older runtime assumptions in its separate Pyodide lane. Recheck these paths
against the selected consumer head. The consumer
must import the final package, apply `index.html`, recompute the complete
post-overlay digest, build the final `.xcarchive`, verify the archived payload,
and then export and verify the IPA.

The recorded Fortoid snapshot contained `0.29.3` assumptions in its WebView
runtime and tests, including old `/vendor/pyodide/0.29.3/` paths and CPython
3.13 wheel names. Importer acceptance alone does not prove that those runtime
assumptions have been removed. The consumer must verify them, import the final
package, recompute its complete post-overlay digest, and prove the final APK
and AAB.

Importer and static validator success proves only package ingestion and schema
compatibility. It does not prove WKWebView or Android WebView execution,
publication, deployment, release, or shipping.
