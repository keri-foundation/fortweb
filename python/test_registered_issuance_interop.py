"""Verify browser issuance evidence in an independent native KERIpy store."""

import base64
from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest


@unittest.skipUnless(os.environ.get("FORTWEB_ISSUANCE_INTEROP_DIR") and importlib.util.find_spec("keri"),
                     "requires browser issuance evidence and native KERIpy")
class RegisteredIssuanceInteropTest(unittest.TestCase):
    def test_browser_issuance_evidence(self):
        from keri import kering
        from keri.acdc import messaging, regeventing, registering, registraring
        from keri.app import habbing
        from keri.core import Blinder, Diger, eventing, parsing, scheming, serdering, signing

        root = Path(os.environ["FORTWEB_ISSUANCE_INTEROP_DIR"])
        schema = scheming.Schemer(raw=(root / "schema.json").read_bytes())
        expected = json.loads((root / "expected.json").read_text())
        for filename in ("issuance-initial.json", "issuance-restored.json", "issuance-later.json"):
            with self.subTest(evidence=filename):
                evidence = json.loads((root / filename).read_text())
                events = [serdering.SerderACDC(raw=base64.b64decode(item, validate=True)) for item in evidence["tel"]]
                proof = bytearray(base64.b64decode(evidence["cesr"], validate=True))
                extractor = parsing.Parser(version=kering.Vrsn_2_0).groupParsator(
                    ims=proof, framed=True, version=kering.Vrsn_2_0, processive=False)
                with self.assertRaises(StopIteration) as done:
                    next(extractor)
                message, = done.exception.value
                self.assertFalse(proof)
                self.assertEqual(schema.said, evidence["schemaId"])
                self.assertEqual(message.serder.sad["s"], schema.said)
                self.assertTrue(schema.verify(raw=json.dumps(message.serder.sad).encode()))
                wrong_schema = deepcopy(schema.sed)
                wrong_schema["$id"] = ""
                wrong_schema["required"].append("notPresent")
                wrong_schema = scheming.Schemer(sed=wrong_schema)
                self.assertNotEqual(wrong_schema.said, message.serder.sad["s"])
                with self.assertRaises(kering.ValidationError):
                    wrong_schema.verify(raw=json.dumps(message.serder.sad).encode())
                self.assertEqual((message.serder.said, message.serder.israid, message.serder.iseaid, message.serder.regid),
                                 (evidence["said"], expected["issuerAid"], expected["recipientAid"], expected["registryId"]))
                self.assertEqual(schema.said, expected["schemaId"])
                with habbing.openHby(name="issuance-verifier", temp=True, version=kering.Vrsn_2_0) as verifier:
                    with self.assertRaises(kering.MissingAnchorError):
                        regeventing.vet(events[0], events[1:], db=verifier.db,
                                        acdc=message.serder, blinder=evidence["blinder"])
                    verifier.psr.parse(ims=bytearray(base64.b64decode(evidence["kel"], validate=True)), version=kering.Vrsn_2_0)
                    prefix, number, diger, sigers = message.tsgs[0]
                    self.assertEqual(prefix.qb64, evidence["issuerAid"])
                    tholder, verfers = verifier.db.resolveVerifiers(pre=prefix.qb64, sn=number.sn, dig=diger.qb64)
                    _, indices = eventing.verifySigs(message.serder.raw, sigers, verfers)
                    self.assertTrue(tholder.satisfy(indices))
                    _, indices = eventing.verifySigs(message.serder.raw, [signing.Signer().sign(b"wrong", index=0)], verfers)
                    self.assertFalse(tholder.satisfy(indices))
                    issuance = events[:evidence["sequence"] + 1]
                    result = regeventing.vet(issuance[0], issuance[1:], db=verifier.db,
                                             acdc=message.serder, blinder=evidence["blinder"])
                    self.assertEqual((result.issuer, result.regid, result.sn, result.acdc, result.state, result.binding),
                                     (evidence["issuerAid"], evidence["registryId"], evidence["sequence"],
                                      evidence["said"], "issued", "mutual"))
                    with self.assertRaises(kering.UnverifiedBlindError):
                        regeventing.vet(events[0], events[1:], db=verifier.db, acdc=message.serder)
                    with self.assertRaises(kering.UnverifiedBlindError):
                        regeventing.vet(events[0], events[1:], db=verifier.db, acdc=message.serder, blinder="invalid")
                    wrong_blinder = Blinder.blind(sn=evidence["sequence"], acdc=message.serder.said, state="issued")
                    with self.assertRaises(kering.UnverifiedBlindError):
                        regeventing.vet(issuance[0], issuance[1:], db=verifier.db,
                                        acdc=message.serder, blinder=wrong_blinder.qb64)
                    attacker = verifier.makeHab(name="attacker", version=kering.Vrsn_2_0)
                    with self.assertRaises((kering.MissingAnchorError, kering.ValidationError)):
                        regeventing.vetAnchor(events[-1], db=verifier.db, issuer=attacker.pre)
                    with self.assertRaises(kering.MisbindingError):
                        regeventing.vetBindings(message.serder, regid=evidence["registryId"],
                                                issuer=attacker.pre, td=message.serder.said)
                    with self.assertRaises(kering.MisbindingError):
                        regeventing.vetBindings(message.serder, regid=Diger(ser=b"wrong registry").qb64,
                                                issuer=evidence["issuerAid"], td=message.serder.said)
                    for issuer, regid in ((attacker.pre, evidence["registryId"]),
                                          (evidence["issuerAid"], Diger(ser=b"wrong registry").qb64)):
                        other = messaging.acdcmap(israid=issuer, regid=regid, schema=schema.said,
                                                  attribute={"d": "", "name": "Example"}, iseaid=evidence["recipientAid"])
                        with self.assertRaises(kering.MisbindingError):
                            regeventing.vet(issuance[0], issuance[1:], db=verifier.db,
                                            acdc=other, blinder=evidence["blinder"])
                    conflict = messaging.blindate(regid=evidence["registryId"], prior=Diger(ser=b"wrong prior").qb64,
                                                 blid=events[1].sad["b"], sn=1)
                    with self.assertRaises(kering.MisdigestError):
                        regeventing.vet(events[0], [conflict], db=verifier.db)
                    full = regeventing.vet(events[0], events[1:], db=verifier.db)
                    self.assertEqual((full.said, full.sn), (evidence["head"], len(events) - 1))
                    altered = bytearray(message.serder.raw)
                    altered[-2] = 0 if altered[-2] else 1
                    with self.assertRaises((ValueError, kering.KeriError)):
                        serdering.SerderACDC(raw=altered)
                    altered = bytearray(events[-1].raw)
                    altered[-2] = 0 if altered[-2] else 1
                    with self.assertRaises((ValueError, kering.KeriError)):
                        serdering.SerderACDC(raw=altered)
                    baser = registering.openRegistry(name="issuance-verifier", temp=True)
                    try:
                        store = registering.RegistryStore(baser)
                        registry = registraring.Registry(
                            hab=SimpleNamespace(pre=evidence["issuerAid"], db=verifier.db), store=store)
                        for event in events:
                            self.assertTrue(registry.processEvent(event))
                        self.assertEqual((registry.sn, store.headEvent(registry.regk).said),
                                         (len(events) - 1, events[-1].said))
                    finally:
                        baser.close(clear=True)


if __name__ == "__main__":
    unittest.main()
