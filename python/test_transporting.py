"""Test wallet-service HTTPS and explicit local development routing."""

import importlib.util
import sys
import types
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parent.parent / "app/runtime/transporting.py"


class RuntimeFault(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _load_module():
    name = "fortweb_transporting_test"
    original = {key: sys.modules.get(key) for key in (name, "js", "vaulting")}
    sys.modules["js"] = types.SimpleNamespace()
    sys.modules["vaulting"] = types.SimpleNamespace(RuntimeFault=RuntimeFault)
    spec = importlib.util.spec_from_file_location(name, MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
        return module
    finally:
        for key, value in original.items():
            if value is None:
                sys.modules.pop(key, None)
            else:
                sys.modules[key] = value


class ProxyUrlTest(unittest.TestCase):
    def test_only_explicit_loopback_services_use_development_proxy(self):
        transporting = _load_module()
        transporting._CONFIG.update(
            origin=lambda: "http://127.0.0.1:8040",
            kf_proxy_prefix="/_fortweb_proxy",
            allow_local_http=True,
        )
        for url in ("https://keri.example/oobi/aid", "http://127.0.0.1:8040/local",
                    "/relative", "", "http://localhost/oobi", "wss://localhost:9723/"):
            with self.subTest(url=url):
                self.assertEqual(transporting.proxy_url(url), url)
        for host in ("127.0.0.1", "localhost", "[::1]"):
            with self.subTest(host=host):
                self.assertEqual(
                    transporting.proxy_url(f"http://{host}:9723/bootstrap/config?region=local"),
                    f"http://127.0.0.1:8040/_fortweb_proxy/http/{host}:9723/bootstrap/config?region=local",
                )


class WalletServiceTrafficTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.transporting = _load_module()
        self.transporting.configure_runtime(
            origin=lambda: "http://127.0.0.1:8040",
            default_boot_url="https://boot.example",
            kf_proxy_prefix="/_fortweb_proxy",
            bootstrap_timeout_ms=1_000,
            cesr_timeout_ms=1_000,
            reply_message_limit=16,
            reply_step_limit=4_096,
        )
        self.calls = []
        self.response = types.SimpleNamespace(status=200)

        async def fetch(url, options):
            self.calls.append((url, options))
            return self.response

        self.transporting.js = types.SimpleNamespace(
            Headers=types.SimpleNamespace(new=dict),
            Object=types.SimpleNamespace(new=types.SimpleNamespace),
            fetch=fetch,
        )

    async def test_https_wallet_data_uses_fetch_without_redirects_or_proxy_downgrade(self):
        for url in ("https://boot.example/bootstrap/config", "https://witness.example/",
                    "https://watcher.example/query", "https://new-contact.example/oobi/aid",
                    "https://localhost:9723/oobi"):
            with self.subTest(url=url):
                result = await self.transporting.fetch_response(url)
                self.assertIs(result, self.response)
                target, options = self.calls[-1]
                self.assertEqual(target, url)
                self.assertEqual(options.redirect, "error")

    async def test_production_rejects_cleartext_and_invalid_urls_before_fetch(self):
        for url in ("http://service.example/oobi", "http://localhost:9723/oobi",
                    "http://127.0.0.1:9723/oobi", "/oobi", "", "data:text/plain,data",
                    "javascript:alert(1)", "wss://service.example/", "https://",
                    "https://service.example:bad/", "https://service.example:65536/",
                    "https://user:password@service.example/", "https://service.example/\npath"):
            with self.subTest(url=url):
                with self.assertRaises(RuntimeFault) as raised:
                    await self.transporting.fetch_response(url)
                self.assertEqual(raised.exception.code, "VALIDATION")
        self.assertEqual(self.calls, [])

    async def test_development_allows_only_loopback_http(self):
        self.transporting._CONFIG["allow_local_http"] = True
        for host in ("127.0.0.1", "localhost", "[::1]"):
            with self.subTest(host=host):
                await self.transporting.fetch_response(f"http://{host}:9723/oobi")
                self.assertEqual(
                    self.calls[-1][0],
                    f"http://127.0.0.1:8040/_fortweb_proxy/http/{host}:9723/oobi",
                )
        self.calls.clear()
        for url in ("http://service.example/oobi", "http://192.168.1.10/oobi",
                    "http://localhost.example/oobi", "http://evil.example\\@localhost:9723/oobi",
                    "http://user@localhost:9723/oobi", "http://local\nhost:9723/oobi"):
            with self.subTest(url=url):
                with self.assertRaises(RuntimeFault):
                    await self.transporting.fetch_response(url)
        self.assertEqual(self.calls, [])

    async def test_fetch_redirect_failure_is_a_network_error(self):
        async def redirect(url, options):
            self.assertEqual(options.redirect, "error")
            raise TypeError("Fetch refused redirect")

        self.transporting.js.fetch = redirect
        with self.assertRaises(RuntimeFault) as raised:
            await self.transporting.fetch_response("https://service.example/redirect")
        self.assertEqual(raised.exception.code, "NETWORK_ERROR")


if __name__ == "__main__":
    unittest.main()
