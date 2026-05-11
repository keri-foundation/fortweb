import asyncio
import importlib
import json
import traceback
import warnings
from inspect import isawaitable
from types import SimpleNamespace

import js

try:
    from pyscript import sync
except ModuleNotFoundError:
    sync = SimpleNamespace()

warnings.filterwarnings("ignore", category=SyntaxWarning, module=r"^keri(\.|$)")
warnings.filterwarnings("ignore", category=SyntaxWarning, module=r"^hio(\.|$)")


WALLET_STORAGE_PREFIX = "fortweb-vault-"
REGISTRY_NAME = "fortweb-vault-registry"
REGISTRY_STORE = "vaults."
LEGACY_ROOT_SALT = "0AAwMTIzNDU2Nzg5YWJjZGVm"
REQUEST_KIND = "fortweb.runtime.request"
RESPONSE_KIND = "fortweb.runtime.response"
PASSCODE_KDF_DEFAULTS = {
    "algorithm": "argon2id13",
    "salt": "NHCtv3Actrddf8jC",
    "opslimit": 2,
    "memlimit": 67_108_864,
    "outlen": 16,
}
ALLOWED_METHODS = {
    "vaults.list",
    "vaults.create",
    "vaults.open",
    "vaults.close",
    "vaults.summary",
    "identifiers.list",
    "identifiers.get",
    "identifiers.create",
    "remotes.list",
    "remotes.get",
    "remotes.resolveOobi",
    "remotes.update",
    "settings.get",
    "kf.bootstrap.get",
    "kf.onboarding.start",
    "kf.account.witnesses.list",
    "kf.account.watchers.list",
    "kf.account.watchers.status",
}
DEFAULT_KF_BOOT_URL = "http://127.0.0.1:9723"
KF_STATE_KEY = "state"
KF_STATE_SUBDB = "kfst."
KF_PROXY_PREFIX = "/_fortweb_proxy"
KF_ONBOARDING_AUTH_NAMESPACE = "kf_onboarding"
KF_ONBOARDING_AUTH_ALIAS_PREFIX = "kf-onboarding"
KF_BOOTSTRAP_TIMEOUT_MS = 15_000
KF_ACCOUNT_QUERY_TIMEOUT_MS = 15_000
KF_WITNESS_REGISTRATION_TIMEOUT_MS = 30_000
KF_CESR_TIMEOUT_MS = 30_000
KF_CESR_REPLY_MESSAGE_LIMIT = 16
KF_CESR_REPLY_STEP_LIMIT = 4_096
DEFAULT_SETTINGS = {
    "tempDatastore": False,
    "storageBackend": "Browser IndexedDB via WebBaser and WebKeeper",
    "keyAlgorithm": "salty",
    "keyTier": "low",
    "witnessProfile": "Direct",
}
PYODIDE_PACKAGE_NAMES = [
    "cryptography",
    "jsonschema",
    "multidict",
    "packaging",
    "pyyaml",
    "setuptools",
    "sortedcontainers",
    "typing-extensions",
    "wcwidth",
]
LOCAL_WHEEL_PATHS = [
    "/fortweb/vendor/pyodide/0.29.3/wheels/apispec-6.9.0-py3-none-any.whl",
    "/fortweb/vendor/pyodide/0.29.3/wheels/cbor2-5.8.0-py3-none-any.whl",
    "/fortweb/vendor/pyodide/0.29.3/wheels/hjson-3.1.0-py3-none-any.whl",
    "/fortweb/vendor/pyodide/0.29.3/wheels/http_sfv-0.9.9-py3-none-any.whl",
    "/fortweb/vendor/pyodide/0.29.3/wheels/mnemonic-0.21-py3-none-any.whl",
    "/fortweb/vendor/pyodide/0.29.3/wheels/multicommand-1.0.0-py3-none-any.whl",
    "/fortweb/vendor/pyodide/0.29.3/wheels/ordered_set-4.1.0-py3-none-any.whl",
    "/fortweb/vendor/pyodide/0.29.3/wheels/prettytable-3.17.0-py3-none-any.whl",
    "/fortweb/vendor/pyodide/0.29.3/wheels/pyasn1-0.6.2-py3-none-any.whl",
    "/fortweb/vendor/pyodide/0.29.3/wheels/pyasn1_alt_modules-0.4.7-py3-none-any.whl",
    "/fortweb/vendor/pyodide/0.29.3/wheels/pypng-0.20220715.0-py3-none-any.whl",
    "/fortweb/vendor/pyodide/0.29.3/wheels/qrcode-7.4.2-py3-none-any.whl",
    "/fortweb/vendor/pyodide/0.29.3/wheels/semver-3.0.4-py3-none-any.whl",
    "/fortweb/vendor/pyodide/0.29.3/wheels/wheel-0.45.1-py3-none-any.whl",
    "/fortweb/wheels/blake3-1.0.8-cp313-cp313-pyodide_2025_0_wasm32.whl",
    "/fortweb/wheels/msgpack-1.1.2-py3-none-any.whl",
    "/fortweb/wheels/pychloride-0.7.18.2-py3-none-any.whl",
    "/fortweb/wheels/hio_web-0.7.20-py3-none-any.whl",
    "/fortweb/wheels/keri_web-2.0.0.dev6-py3-none-any.whl",
]


_MODULES = None
_REQUEST_LOCK = asyncio.Lock()
_RUNTIME_PACKAGES_READY = False


def _origin():
    try:
        return str(js.location.origin or "")
    except Exception:
        return ""


def _absolute_url(path: str):
    origin = _origin()
    if origin and path.startswith("/"):
        return f"{origin}{path}"
    return path


async def _load_package_batch(specs):
    if not specs:
        return

    from pyodide_js import loadPackage

    pending = loadPackage(specs)
    if isawaitable(pending):
        await pending


async def _ensure_runtime_packages():
    global _RUNTIME_PACKAGES_READY

    if _RUNTIME_PACKAGES_READY:
        return

    await _load_package_batch(PYODIDE_PACKAGE_NAMES)
    await _load_package_batch([_absolute_url(path) for path in LOCAL_WHEEL_PATHS])
    _RUNTIME_PACKAGES_READY = True


def _load_modules():
    global _MODULES
    if _MODULES is None:
        _MODULES = {
            "habbing": importlib.import_module("keri.app.habbing"),
            "httping": importlib.import_module("keri.app.httping"),
            "webkeeping": importlib.import_module("keri.app.webkeeping"),
            "webbasing": importlib.import_module("keri.db.webbasing"),
            "webdbing": importlib.import_module("keri.db.webdbing"),
            "koming": importlib.import_module("keri.db.koming"),
            "oobiing": importlib.import_module("keri.app.oobiing"),
            "organizing": importlib.import_module("keri.app.organizing"),
            "eventing": importlib.import_module("keri.core.eventing"),
            "parsing": importlib.import_module("keri.core.parsing"),
            "routing": importlib.import_module("keri.core.routing"),
            "recording": importlib.import_module("keri.recording"),
            "serdering": importlib.import_module("keri.core.serdering"),
            "kering": importlib.import_module("keri.kering"),
            "coring": importlib.import_module("keri.core.coring"),
            "exchanging": importlib.import_module("keri.peer.exchanging"),
            "signing": importlib.import_module("keri.core.signing"),
        }
    transporting.install_browser_clienter_proxy(_MODULES["httping"])
    return _MODULES


import onboarding
import transporting
import vaulting


vaulting.configure_runtime(
    ensure_runtime_packages=_ensure_runtime_packages,
    load_modules=_load_modules,
    wallet_storage_prefix=WALLET_STORAGE_PREFIX,
    registry_name=REGISTRY_NAME,
    registry_store=REGISTRY_STORE,
    legacy_root_salt=LEGACY_ROOT_SALT,
    passcode_kdf_defaults=PASSCODE_KDF_DEFAULTS,
    default_settings=DEFAULT_SETTINGS,
    kf_state_subdb=KF_STATE_SUBDB,
)
transporting.configure_runtime(
    origin=_origin,
    default_boot_url=DEFAULT_KF_BOOT_URL,
    kf_proxy_prefix=KF_PROXY_PREFIX,
    bootstrap_timeout_ms=KF_BOOTSTRAP_TIMEOUT_MS,
    cesr_timeout_ms=KF_CESR_TIMEOUT_MS,
    reply_message_limit=KF_CESR_REPLY_MESSAGE_LIMIT,
    reply_step_limit=KF_CESR_REPLY_STEP_LIMIT,
)
onboarding.configure_runtime(
    kf_state_key=KF_STATE_KEY,
    kf_state_subdb=KF_STATE_SUBDB,
    onboarding_auth_namespace=KF_ONBOARDING_AUTH_NAMESPACE,
    onboarding_auth_alias_prefix=KF_ONBOARDING_AUTH_ALIAS_PREFIX,
    account_query_timeout_ms=KF_ACCOUNT_QUERY_TIMEOUT_MS,
    witness_registration_timeout_ms=KF_WITNESS_REGISTRATION_TIMEOUT_MS,
    cesr_timeout_ms=KF_CESR_TIMEOUT_MS,
)


async def _dispatch(method: str, params: dict):
    if method.startswith("kf."):
        return await onboarding.dispatch(method, params)
    return await vaulting.dispatch(method, params)


def _error_payload(message_id: str, code: str, message: str):
    return json.dumps(
        {
            "id": message_id,
            "kind": RESPONSE_KIND,
            "ok": False,
            "error": {
                "code": code,
                "message": message,
            },
        }
    )


async def handle_request(raw_message):
    try:
        request = json.loads(raw_message)
    except Exception:
        return _error_payload("invalid", "BAD_REQUEST", "Runtime request payload was not valid JSON.")

    if not isinstance(request, dict):
        return _error_payload("invalid", "BAD_REQUEST", "Runtime request payload must be an object.")

    message_id = str(request.get("id") or "invalid")
    if request.get("kind") != REQUEST_KIND:
        return _error_payload(message_id, "BAD_REQUEST", "Runtime request kind was invalid.")

    method = request.get("method")
    if not isinstance(method, str) or not method:
        return _error_payload(message_id, "BAD_REQUEST", "Runtime request method was invalid.")
    if method not in ALLOWED_METHODS:
        return _error_payload(message_id, "BAD_REQUEST", f"Runtime method '{method}' is not allowed.")

    params = request.get("params")
    if params is None and "params" not in request:
        params = {}
    if not isinstance(params, dict):
        return _error_payload(message_id, "BAD_REQUEST", "Runtime request params must be an object.")

    try:
        async with _REQUEST_LOCK:
            result = await _dispatch(method, params)
        return json.dumps(
            {
                "id": message_id,
                "kind": RESPONSE_KIND,
                "ok": True,
                "result": result,
            }
        )
    except vaulting.RuntimeFault as exc:
        return _error_payload(message_id, exc.code, str(exc))
    except Exception:
        try:
            js.console.error(traceback.format_exc())
        except Exception:
            pass
        return _error_payload(message_id, "RUNTIME_ERROR", "Runtime request failed.")


sync.handle_request = handle_request
