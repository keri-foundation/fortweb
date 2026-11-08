## PyScript 2025.11.2

These files were vendored from the pinned PyScript release at:

- `https://pyscript.net/releases/2025.11.2/core.css`
- `https://pyscript.net/releases/2025.11.2/core.js`
- the release-local hashed JS chunks that `core.js` and its imports reference

`core-DSF9czGY.js` contains a local, fail-closed worker-hook change generated
by `patch_pyscript` in `scripts/prepare_csp_runtime_source.py`. It preserves the
bundled default hook without JavaScript string evaluation and rejects other
worker hooks; custom worker-hook support requires a separately reviewed change.
The unmodified input must match SHA-256
`29d0aa103b85b8f17fb3ccaf5b1a2788bdb851378655ff9f39dd1c50270b171d`.

Fortweb does not vendor the release source maps. The vendored `.js` files have
their `sourceMappingURL` trailers stripped so the app does not request missing
`.map` files at runtime.

To bump this runtime safely later:

1. Download the new release's `core.css`, `core.js`, and every relative JS chunk that `core.js` imports into a new versioned directory next to this one.
2. Strip any trailing `sourceMappingURL=*.map` comments from the vendored `.js` files unless you also plan to commit the matching source maps.
3. Update `ci/fixtures/keripy-wasm/index.html` to point at that new pinned directory.
4. Re-run `npm run test:browser -- playwright/keripy-wasm.spec.ts` and confirm harness boot only fetches runtime assets from the local Fortweb server before Python execution begins.
