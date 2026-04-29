# Fortweb Wallet

Wallet for KERI. This is the universal web wallet based on Python running in the browser (Pyodide WASM).

## Local development (browser)

Pyodide and wheels are loaded from URLs like `/fortweb/vendor/...` and `/fortweb/wheels/...`. The HTTP **document root must be the parent of the `fortweb` directory** (in this workspace, that is usually `libs/`).

Do **not** open only `http://127.0.0.1:8765/` against a server rooted at `fortweb/app` — you will see MIME type errors (`core.js` blocked as `text/html`) because `/vendor/...` 404s and returns HTML.

From the `fortweb` repo:

```bash
python3 scripts/serve_local.py
```

Then use **`http://127.0.0.1:8765/fortweb/app/`** (the script redirects `/` there). Stop with Ctrl+C.

The **SharedArrayBuffer** / PyScript FAQ warning in the console is expected for a plain `http.server`; the app should still load. If wheel fetches fail, confirm nothing else is bound to the same port and that you are not mixing two different server roots in multiple tabs.

## Type checking

FortWeb now has an active TypeScript conversion lane for the runtime seam and the smallest adjacent app helpers.

This does **not** change the browser runtime path, bundling model, or local serve path. The browser still loads `.js` files from `app/`, but the first converted runtime files now use `.ts` as the source of truth and emit `.js` back into the same runtime path.

From the `fortweb` repo:

```bash
npm run build:runtime
npm run typecheck
npm run test:e2e
```

## Browser smoke tests

FortWeb now has a validation-first browser smoke harness using Playwright.

The smoke suite stays aligned with the current FortWeb runtime posture:

- it serves the app through `python3 scripts/serve_local.py`
- it keeps the browser entrypoint at `app/index.html`
- it checks one real app boot path plus deterministic fixture routes
- it does not introduce a bundler-first test runtime

From the `fortweb` repo:

```bash
npm run test:e2e
```

Current smoke coverage:

- app boot through `/fortweb/app/`
- fixture index route
- populated identifiers fixture
- hosted witnesses fixture

The fixture routes remain the most stable UI validation surface because they render deterministic states without depending on live wallet data.

Current scope:

- `app/runtime/messages.ts` -> emits `app/runtime/messages.js`
- `app/runtime/method-catalog.ts` -> emits `app/runtime/method-catalog.js`
- `app/runtime/logger.ts` -> emits `app/runtime/logger.js`
- `app/runtime/bridge.ts` -> emits `app/runtime/bridge.js`
- `app/app/router.ts` -> emits `app/app/router.js`
- `app/app/session.ts` -> emits `app/app/session.js`

The current conversion slice stays intentionally narrow so FortWeb can replace JavaScript source files with TypeScript without forcing a bundler-first rewrite across the whole app.
