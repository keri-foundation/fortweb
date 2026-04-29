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
