"""Exercise failed vault closes with isolated browser-storage handles."""

import asyncio
import importlib.util
from pathlib import Path
import unittest


HAS_WEB_KERI = (importlib.util.find_spec("keri") is not None and
                importlib.util.find_spec("keri.db.webbasing") is not None)


@unittest.skipUnless(HAS_WEB_KERI, "requires the browser-capable KERIpy revision")
class KelPersistenceTest(unittest.IsolatedAsyncioTestCase):
    async def test_failed_sync_blocks_vault_until_original_state_is_saved(self):
        from keri import kering
        from keri.app import habbing, webkeeping
        from keri.core import coring, eventing, parsing, signing
        from keri.db import webbasing, webdbing

        spec = importlib.util.spec_from_file_location(
            "vaulting_kel_persistence_test", Path(__file__).resolve().parent.parent / "app/runtime/vaulting.py")
        vaulting = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(vaulting)

        class Handle:
            def __init__(self, backend, namespace):
                self.backend, self.namespace = backend, namespace
                self.local = dict(backend.persisted.get(namespace, {}))

            def get(self, key, default=None):
                return self.local.get(key, default)

            def __setitem__(self, key, value):
                self.local[key] = value

            async def sync(self):
                if self.backend.failure == (self.namespace, "before"):
                    raise RuntimeError("injected sync failure")
                self.backend.persisted[self.namespace] = dict(self.local)
                if self.backend.failure == (self.namespace, "after"):
                    raise RuntimeError("injected sync failure")

        class Backend:
            def __init__(self):
                self.persisted, self.failure = {}, None

            async def open(self, namespace):
                return Handle(self, namespace)

        backend = Backend()
        modules = {"webdbing": webdbing, "webbasing": webbasing, "eventing": eventing}
        name = "kel-failure-test"

        async def open_habery():
            keeper, baser = webkeeping.WebKeeper(name=name), webbasing.WebBaser(name=name)
            await keeper.reopen(storageOpener=backend.open)
            await baser.reopen(storageOpener=backend.open)
            return habbing.Habery(name=name, ks=keeper, db=baser, cf=vaulting.NullConfiger(),
                                  temp=False, version=kering.Vrsn_2_0)

        hby = await open_habery()
        issuer = hby.makeHab(name="issuer", version=kering.Vrsn_2_0)
        issuer.rotate(version=kering.Vrsn_2_0, gvrsn=kering.Vrsn_2_0)
        await vaulting.close_habery(hby)
        baseline = {key: dict(value) for key, value in backend.persisted.items()}
        boundaries = ("dtss.", "esrs.", "evts.", "fels.", "fons.", "kels.", "sigs.", "stts.")

        backend.persisted[f"{name}:stts."]["__records__"] = "{}"
        original_habs = dict(backend.persisted[f"{name}:habs."])
        orphaned = webbasing.WebBaser(name=name)
        await orphaned.reopen(storageOpener=backend.open)
        with self.assertRaises(vaulting.RuntimeFault) as error:
            await vaulting._validate_open_kels(orphaned, modules)
        self.assertEqual(error.exception.code, "BAD_STATE")
        await orphaned.aclose()
        self.assertEqual(backend.persisted[f"{name}:habs."], original_habs)

        for boundary in boundaries:
            for timing in ("before", "after"):
                with self.subTest(boundary=boundary, timing=timing):
                    backend.persisted = {key: dict(value) for key, value in baseline.items()}
                    hby = await open_habery()
                    issuer = hby.habByName("issuer")
                    issuer.interact(data=[{"d": issuer.pre}], version=kering.Vrsn_2_0,
                                    gvrsn=kering.Vrsn_2_0)
                    expected, prefix, sequence = issuer.kever.serder.said, issuer.pre, issuer.kever.sn
                    self.assertTrue(hby.db._stores[boundary].dirty)
                    vaulting._STATE = {"vault": {"id": name}, "hby": hby}
                    backend.failure = (f"{name}:{boundary}", timing)
                    with self.assertRaisesRegex(RuntimeError, "injected sync failure"):
                        await vaulting.close_state()
                    with self.assertRaises(vaulting.RuntimeFault) as error:
                        await vaulting.dispatch("identifiers.create", {"vaultId": name, "alias": "other"})
                    self.assertEqual(error.exception.code, "BAD_STATE")
                    self.assertEqual(len(hby.db.kels.get(keys=prefix, on=sequence)), 1)

                    backend.failure = None
                    snapshot = {key: dict(value) for key, value in backend.persisted.items()}
                    fresh = webbasing.WebBaser(name=name)
                    fresh_keeper = webkeeping.WebKeeper(name=name)
                    await fresh_keeper.reopen(storageOpener=backend.open)
                    await fresh.reopen(storageOpener=backend.open)
                    inconsistent = (boundary in ("fons.", "kels.", "sigs.", "stts.") or
                                    (boundary == "fels." and timing == "after"))
                    if boundary == "stts." and timing == "after":
                        inconsistent = False
                    if inconsistent:
                        with self.assertRaises(vaulting.RuntimeFault) as error:
                            await vaulting._validate_open_kels(fresh, modules, keeper=fresh_keeper)
                        self.assertEqual(error.exception.code, "BAD_STATE")
                    else:
                        await vaulting._validate_open_kels(fresh, modules, keeper=fresh_keeper)
                    self.assertEqual(backend.persisted, snapshot)
                    await vaulting.dispatch("vaults.close", {"vaultId": name})
                    reopened = await open_habery()
                    await vaulting._validate_open_kels(reopened.db, modules, keeper=reopened.ks)
                    issuer = reopened.habByName("issuer")
                    self.assertEqual(issuer.kever.serder.said, expected)
                    if boundary == "stts." and timing == "after":
                        sigers = reopened.db.sigs.get(keys=(prefix, expected))
                        reopened.db.sigs.rem(keys=(prefix, expected))
                        reopened.db.sigs.put(keys=(prefix, expected),
                                             vals=[signing.Signer().sign(b"wrong", index=0)])
                        with self.assertRaises(vaulting.RuntimeFault) as error:
                            await vaulting._validate_open_kels(reopened.db, modules, keeper=reopened.ks)
                        self.assertEqual(error.exception.code, "BAD_STATE")
                        reopened.db.sigs.rem(keys=(prefix, expected))
                        reopened.db.sigs.put(keys=(prefix, expected), vals=sigers)
                        verfers = issuer.kever.verfers
                        issuer.kever.verfers = [signing.Signer().verfer]
                        with self.assertRaises(vaulting.RuntimeFault) as error:
                            await vaulting._validate_open_kels(reopened.db, modules, keeper=reopened.ks)
                        self.assertEqual(error.exception.code, "BAD_STATE")
                        issuer.kever.verfers = verfers
                        conflicting = coring.Diger(ser=b"conflicting event").qb64
                        reopened.db.kels.add(keys=prefix, on=sequence, val=conflicting)
                        with self.assertRaises(vaulting.RuntimeFault) as error:
                            await vaulting._validate_open_kels(reopened.db, modules, keeper=reopened.ks)
                        self.assertEqual(error.exception.code, "BAD_STATE")
                        reopened.db.kels.rem(keys=prefix, on=sequence, val=conflicting)
                    with habbing.openHby(name="independent-kel-verifier", temp=True,
                                         version=kering.Vrsn_2_0) as verifier:
                        parsing.Parser(version=kering.Vrsn_2_0).parse(
                            ims=issuer.replay(gvrsn=kering.Vrsn_2_0), kvy=verifier.kvy,
                            version=kering.Vrsn_2_0)
                        self.assertEqual(verifier.kevers[prefix].serder.said, expected)
                    await vaulting.close_habery(reopened)

        for boundary in ("gbls.", "pris.", "sits.", "pubs."):
            for timing in ("before", "after"):
                with self.subTest(keeper=boundary, timing=timing):
                    backend.persisted = {key: dict(value) for key, value in baseline.items()}
                    hby = await open_habery()
                    issuer = hby.habByName("issuer")
                    issuer.rotate(version=kering.Vrsn_2_0, gvrsn=kering.Vrsn_2_0)
                    expected, prefix = issuer.kever.serder.said, issuer.pre
                    self.assertTrue(hby.ks._stores[boundary].dirty)
                    vaulting._STATE = {"vault": {"id": name}, "hby": hby}
                    backend.failure = (f"{name}:{boundary}", timing)
                    with self.assertRaisesRegex(RuntimeError, "injected sync failure"):
                        await vaulting.flush_open_state()
                    with self.assertRaises(vaulting.RuntimeFault) as error:
                        vaulting.require_open_state(name)
                    self.assertEqual(error.exception.code, "BAD_STATE")
                    backend.failure = None
                    snapshot = {key: dict(value) for key, value in backend.persisted.items()}
                    fresh, fresh_keeper = webbasing.WebBaser(name=name), webkeeping.WebKeeper(name=name)
                    await fresh_keeper.reopen(storageOpener=backend.open)
                    await fresh.reopen(storageOpener=backend.open)
                    inconsistent = boundary == "pubs." or (boundary == "sits." and timing == "after")
                    if inconsistent:
                        with self.assertRaises(vaulting.RuntimeFault) as error:
                            await vaulting._validate_open_kels(fresh, modules, keeper=fresh_keeper)
                        self.assertEqual(error.exception.code, "BAD_STATE")
                    else:
                        await vaulting._validate_open_kels(fresh, modules, keeper=fresh_keeper)
                    self.assertEqual(backend.persisted, snapshot)
                    await vaulting.dispatch("vaults.close", {"vaultId": name})
                    reopened = await open_habery()
                    await vaulting._validate_open_kels(reopened.db, modules, keeper=reopened.ks)
                    self.assertEqual(reopened.habByName("issuer").kever.serder.said, expected)
                    with habbing.openHby(name="independent-rotation-verifier", temp=True,
                                         version=kering.Vrsn_2_0) as verifier:
                        parsing.Parser(version=kering.Vrsn_2_0).parse(
                            ims=reopened.habByName("issuer").replay(gvrsn=kering.Vrsn_2_0),
                            kvy=verifier.kvy, version=kering.Vrsn_2_0)
                        self.assertEqual(verifier.kevers[prefix].serder.said, expected)
                    await vaulting.close_habery(reopened)


if __name__ == "__main__":
    unittest.main()
