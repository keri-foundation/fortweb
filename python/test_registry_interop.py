"""Independently verify browser registry evidence in a native KERIpy store."""

import base64
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest


@unittest.skipUnless(os.environ.get("FORTWEB_REGISTRY_INTEROP_DIR") and importlib.util.find_spec("keri"),
                     "requires browser registry evidence and native KERIpy")
class RegistryInteropTest(unittest.TestCase):
    def test_browser_registry_anchor_and_evidence(self):
        from keri import kering
        from keri.acdc import regeventing, registering, registraring
        from keri.app import habbing
        from keri.core import parsing, serdering

        root = Path(os.environ["FORTWEB_REGISTRY_INTEROP_DIR"])
        for filename in ("registry-initial.json", "registry-recovered.json"):
            with self.subTest(evidence=filename):
                evidence = json.loads((root / filename).read_text())
                rip = serdering.SerderACDC(raw=base64.b64decode(evidence["inception"], validate=True))
                kel = base64.b64decode(evidence["kel"], validate=True)
                with habbing.openHby(name="registry-interop", temp=True, version=kering.Vrsn_2_0) as verifier:
                    with self.assertRaises(kering.MissingAnchorError):
                        regeventing.vet(rip, db=verifier.db)
                    baser = registering.openRegistry(name="registry-interop", temp=True)
                    try:
                        store = registering.RegistryStore(baser)
                        registry = registraring.Registry(
                            hab=SimpleNamespace(pre=evidence["issuerAid"], db=verifier.db), store=store)
                        self.assertFalse(registry.processEvent(rip))
                        self.assertIsNone(store.seqEvent(evidence["registryId"], 0))
                        parsing.Parser(version=kering.Vrsn_2_0).parse(
                            ims=bytearray(kel), kvy=verifier.kvy, version=kering.Vrsn_2_0)
                        verified = regeventing.vet(rip, db=verifier.db)
                        self.assertEqual((verified.issuer, verified.regid, verified.sn),
                                         (evidence["issuerAid"], evidence["registryId"], 0))
                        self.assertTrue(registry.processEvent(rip))
                        self.assertEqual((registry.sn, registry.regser.said, store.headEvent(registry.regk).said),
                                         (0, evidence["registryId"], evidence["registryId"]))
                        wrong = verifier.makeHab(name="wrong-issuer", version=kering.Vrsn_2_0)
                        with self.assertRaises((kering.MissingAnchorError, kering.ValidationError)):
                            regeventing.vetAnchor(rip, db=verifier.db, issuer=wrong.pre)
                        altered = bytearray(rip.raw)
                        altered[-2] = 0 if altered[-2] != 0 else 1
                        with self.assertRaises((ValueError, kering.KeriError)):
                            serdering.SerderACDC(raw=altered)
                    finally:
                        baser.close(clear=True)


if __name__ == "__main__":
    unittest.main()
