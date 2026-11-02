"""Exercise signed ACDC creation with independently verified issuer keys."""

import asyncio
import base64
from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

if importlib.util.find_spec("keri") is not None:
    from keri import db, kering
    from keri.acdc.messaging import acmSchemaDefault
    from keri.app import habbing, organizing
    from keri.core import coring, eventing, parsing, routing, scheming, signing, SerderACDC


@unittest.skipUnless(importlib.util.find_spec("keri") is not None, "native KERIpy is not installed")
class CredentialIssuanceTest(unittest.TestCase):
    @unittest.skipUnless(os.environ.get("FORTWEB_CREDENTIAL_INTEROP_DIR") and importlib.util.find_spec("locksmith"),
                         "requires browser test artifacts and native Locksmith")
    def test_browser_output_with_locksmith_issuer_authentication(self):
        from keri.acdc.ipexing import IpexHandler
        from locksmith.core import credentialing

        root = Path(os.environ["FORTWEB_CREDENTIAL_INTEROP_DIR"])
        public = json.loads((root / "public.json").read_text())
        with habbing.openHby(name="independent-recipient", temp=True, version=kering.Vrsn_2_0) as target:
            target.psr.parse(ims=bytearray((root / "issuer.cesr").read_bytes()), version=kering.Vrsn_2_0)
            target.kevers[public["issuer"]]
            schema = scheming.Schemer(raw=(root / "schema.json").read_bytes())
            target.db.schema.pin(keys=(schema.said,), val=schema)
            parser = parsing.Parser(version=kering.Vrsn_2_0)
            extraction = parser.groupParsator(ims=bytearray((root / "credential.cesr").read_bytes()),
                                              framed=True, version=kering.Vrsn_2_0, processive=False)
            with self.assertRaises(StopIteration) as done:
                next(extraction)
            nest, = done.exception.value
            handler = IpexHandler(resource="/ipex/grant", hby=target, notifier=None)
            vault = SimpleNamespace(hby=target, exc=SimpleNamespace(routes={"/ipex/grant": handler}))
            credentialing.validate_schema(vault, nest.serder)
            self.assertEqual(credentialing.authentication(vault, nest)["auth"], "signature")
            self.assertEqual(nest.serder.israid, public["issuer"])
            self.assertEqual(nest.serder.iseaid, public["holder"])
            bad = dict(nest.__dict__)
            prefix, number, diger, _ = nest.tsgs[0]
            bad["tsgs"] = [(prefix, number, diger, [signing.Signer().sign(b"wrong", index=0)])]
            self.assertFalse(handler._verifyIssuerAuthNode(nest.serder, bad))
            attacker = target.makeHab(name="wrong-issuer", version=kering.Vrsn_2_0)
            bad["tsgs"] = [(attacker.kever.prefixer, number, diger, attacker.sign(ser=nest.serder.raw))]
            self.assertFalse(handler._verifyIssuerAuthNode(nest.serder, bad))
            raw = (root / "credential.cesr").read_bytes()
            self.assertIn(b"Example", raw)
            with self.assertRaises((ValueError, kering.KeriError)):
                SerderACDC(raw=raw.replace(b"Example", b"Changed"))

    @unittest.skipUnless(importlib.util.find_spec("keri") is not None and importlib.util.find_spec("keri.db.webbasing") is not None,
                         "requires the browser-capable KERIpy revision")
    def test_signed_issuance_and_independent_verification(self):
        from keri.db import webbasing
        spec = importlib.util.spec_from_file_location(
            "vaulting_credential_test", Path(__file__).resolve().parent.parent / "app/runtime/vaulting.py")
        vaulting = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(vaulting)
        modules = {"coring": coring, "db": db, "eventing": eventing, "kering": kering,
                   "organizing": organizing, "parsing": parsing, "routing": routing,
                   "scheming": scheming, "webbasing": webbasing}
        with (habbing.openHby(name="credential-issuer", temp=True, version=kering.Vrsn_2_0) as issuer_store,
              habbing.openHby(name="credential-recipient", temp=True, version=kering.Vrsn_2_0) as recipient_store):
            issuer = issuer_store.makeHab(name="issuer", version=kering.Vrsn_2_0)
            recipient = recipient_store.makeHab(name="recipient", version=kering.Vrsn_2_0)
            issuer_org = organizing.Organizer(hby=issuer_store)
            introduction = vaulting._identifier_introduction(recipient, modules)
            asyncio.run(vaulting._import_identifier(issuer_store, issuer_org, modules,
                                                    base64.b64encode(introduction).decode("ascii"), "recipient"))
            recipient_store.psr.parse(ims=issuer.replay(gvrsn=kering.Vrsn_2_0), version=kering.Vrsn_2_0)
            _, definition = acmSchemaDefault()
            schema = scheming.Schemer(sed=definition)
            issuer_store.db.schema.pin(keys=(schema.said,), val=schema)
            params = {"issuerAid": issuer.pre, "recipientAid": recipient.pre, "schemaId": schema.said,
                      "attributes": {"name": "Example"}}

            for invalid in ({"issuerAid": recipient.pre}, {"recipientAid": issuer.pre},
                            {"schemaId": "wrong"}, {"attributes": {"i": issuer.pre}},
                            {"attributes": {"rd": "unsupported"}}):
                with self.subTest(invalid=invalid):
                    with self.assertRaises(vaulting.RuntimeFault):
                        vaulting._issue_signed_credential(issuer_store, issuer_org, modules, {**params, **invalid})
            for required in ("rd", "not-present"):
                altered = deepcopy(schema.sed)
                altered["$id"] = ""
                altered["required"].append(required)
                altered_schema = scheming.Schemer(sed=altered)
                issuer_store.db.schema.pin(keys=(altered_schema.said,), val=altered_schema)
                with self.assertRaises(vaulting.RuntimeFault):
                    vaulting._issue_signed_credential(issuer_store, issuer_org, modules,
                                                     {**params, "schemaId": altered_schema.said})

            external = deepcopy(schema.sed)
            external["$id"] = ""
            external["allOf"] = [{"$ref": "https://example.invalid/unavailable"}]
            external_schema = scheming.Schemer(sed=external)
            issuer_store.db.schema.pin(keys=(external_schema.said,), val=external_schema)
            with patch("urllib.request.urlopen") as network:
                with self.assertRaises(vaulting.RuntimeFault):
                    vaulting._issue_signed_credential(issuer_store, issuer_org, modules,
                                                     {**params, "schemaId": external_schema.said})
                network.assert_not_called()

            result = vaulting._issue_signed_credential(issuer_store, issuer_org, modules, params)
            self.assertEqual(result["authentication"], "signature")
            self.assertIsNone(result["registry"])
            parser = parsing.Parser(version=kering.Vrsn_2_0)
            extraction = parser.groupParsator(ims=bytearray(base64.b64decode(result["cesr"])), framed=True,
                                              version=kering.Vrsn_2_0, processive=False)
            with self.assertRaises(StopIteration) as done:
                next(extraction)
            message, = done.exception.value
            self.assertEqual(message.serder.israid, issuer.pre)
            self.assertEqual(message.serder.iseaid, recipient.pre)
            self.assertTrue(schema.verify(raw=json.dumps(message.serder.sad).encode()))
            prefix, number, diger, sigers = message.tsgs[0]
            self.assertEqual(prefix.qb64, issuer.pre)
            tholder, verfers = recipient_store.db.resolveVerifiers(pre=prefix.qb64, sn=number.sn, dig=diger.qb64)
            _, indices = eventing.verifySigs(message.serder.raw, sigers, verfers)
            self.assertTrue(tholder.satisfy(indices))
            _, indices = eventing.verifySigs(message.serder.raw + b"tampered", sigers, verfers)
            self.assertFalse(tholder.satisfy(indices))


if __name__ == "__main__":
    unittest.main()
