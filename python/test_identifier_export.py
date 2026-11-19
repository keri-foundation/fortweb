"""Verify exported identifier introductions using a separate KERI store."""

import asyncio
import base64
import importlib.util
from pathlib import Path
import unittest

if importlib.util.find_spec("keri") is not None:
    from keri import db, kering
    from keri.app import habbing, organizing
    from keri.core import eventing, signing


MODULE = Path(__file__).resolve().parent.parent / "app/runtime/vaulting.py"


@unittest.skipUnless(importlib.util.find_spec("keri") is not None, "native KERIpy is not installed")
class IdentifierExportTest(unittest.TestCase):
    def test_missing_event_signature_prevents_partial_export(self):
        spec = importlib.util.spec_from_file_location("vaulting_export_incomplete_test", MODULE)
        vaulting = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(vaulting)
        modules = {"db": db, "eventing": eventing, "kering": kering}
        with habbing.openHby(name="incomplete-export", temp=True, version=kering.Vrsn_2_0) as source:
            owner = source.makeHab(name="owner", version=kering.Vrsn_2_0)
            owner.rotate()
            source.db.sigs.rem(keys=(owner.pre, owner.kever.serder.said))
            with self.assertRaises(vaulting.RuntimeFault) as error:
                vaulting._identifier_introduction(owner, modules)
            self.assertEqual(error.exception.code, "BAD_STATE")

    def test_public_introduction_includes_signed_routes_and_revocations(self):
        spec = importlib.util.spec_from_file_location("vaulting_export_test", MODULE)
        vaulting = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(vaulting)
        modules = {"db": db, "eventing": eventing, "kering": kering, "organizing": organizing}
        root_salt = signing.Salter(raw=b"0123456789abcdef").qb64
        with (habbing.openHby(name="export-owner", temp=True, salt=root_salt, version=kering.Vrsn_2_0) as source,
              habbing.openHby(name="export-service", temp=True, version=kering.Vrsn_2_0) as service,
              habbing.openHby(name="export-recipient", temp=True, version=kering.Vrsn_2_0) as target):
            owner = source.makeHab(name="owner", version=kering.Vrsn_2_0)
            unrelated = source.makeHab(name="unrelated", version=kering.Vrsn_2_0)
            mailbox = service.makeHab(name="mailbox", version=kering.Vrsn_2_0)
            source.psr.parse(ims=mailbox.replay(gvrsn=kering.Vrsn_2_0), version=kering.Vrsn_2_0)
            source.psr.parse(ims=mailbox.makeLocScheme(url="http://127.0.0.1:9999", version=kering.Vrsn_2_0),
                             version=kering.Vrsn_2_0)
            source.psr.parse(ims=owner.makeEndRole(eid=mailbox.pre, role=kering.Roles.mailbox,
                                                  stamp="2026-10-09T00:00:00.000000+00:00",
                                                  version=kering.Vrsn_2_0), version=kering.Vrsn_2_0)
            vaulting._STATE = {"vault": {"id": "vault"}, "hby": source, "modules": modules}

            def export():
                result = asyncio.run(vaulting.dispatch("identifiers.export", {"vaultId": "vault", "aid": owner.pre}))
                return base64.b64decode(result["cesr"], validate=True)

            introduction = export()
            self.assertNotIn(root_salt.encode(), introduction)
            target.psr.parse(ims=bytearray(introduction), version=kering.Vrsn_2_0)
            self.assertIn(owner.pre, target.kevers)
            self.assertIn(mailbox.pre, target.kevers)
            self.assertNotIn(unrelated.pre, target.kevers)
            self.assertTrue(target.db.ends.get(keys=(owner.pre, "mailbox", mailbox.pre)).allowed)
            self.assertEqual(target.db.locs.get(keys=(mailbox.pre, "http")).url, "http://127.0.0.1:9999")

            source.psr.parse(ims=owner.makeEndRole(eid=mailbox.pre, role=kering.Roles.mailbox,
                                                  stamp="2026-10-09T00:00:01.000000+00:00", allow=False,
                                                  version=kering.Vrsn_2_0), version=kering.Vrsn_2_0)
            target.psr.parse(ims=bytearray(export()), version=kering.Vrsn_2_0)
            self.assertFalse(target.db.ends.get(keys=(owner.pre, "mailbox", mailbox.pre)).allowed)

            with self.assertRaises(vaulting.RuntimeFault):
                asyncio.run(vaulting.dispatch("identifiers.export", {"vaultId": "other", "aid": owner.pre}))


if __name__ == "__main__":
    unittest.main()
