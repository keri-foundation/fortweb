"""Exercise public CESR import against isolated KERI stores."""

import asyncio
import base64
import importlib.util
from pathlib import Path
import unittest

if importlib.util.find_spec("keri") is not None:
    from keri import db, kering
    from keri.app import habbing, organizing
    from keri.core import eventing, parsing, routing, signing
    from keri.db import webbasing


@unittest.skipUnless(importlib.util.find_spec("keri") is not None, "native KERIpy is not installed")
class IdentifierImportTest(unittest.TestCase):
    def test_conflicting_existing_history_is_not_modified(self):
        module = Path(__file__).resolve().parent.parent / "app/runtime/vaulting.py"
        spec = importlib.util.spec_from_file_location("vaulting_import_conflict_test", module)
        vaulting = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(vaulting)
        modules = {"db": db, "kering": kering, "eventing": eventing, "parsing": parsing,
                   "routing": routing, "webbasing": webbasing}
        salt = signing.Salter(raw=b"0123456789abcdef").qb64
        with (habbing.openHby(name="conflict-source", temp=True, salt=salt, version=kering.Vrsn_2_0) as source,
              habbing.openHby(name="conflict-other", temp=True, salt=salt, version=kering.Vrsn_2_0) as other,
              habbing.openHby(name="conflict-target", temp=True, version=kering.Vrsn_2_0) as target):
            owner = source.makeHab(name="owner", version=kering.Vrsn_2_0)
            peer = other.makeHab(name="owner", version=kering.Vrsn_2_0)
            self.assertEqual(owner.pre, peer.pre)
            owner.interact(data=[{"branch": "one"}])
            peer.interact(data=[{"branch": "two"}])
            target.psr.parse(ims=peer.replay(gvrsn=kering.Vrsn_2_0), version=kering.Vrsn_2_0)
            existing = target.kevers[peer.pre].serder.said
            organizer = organizing.Organizer(hby=target)
            encoded = base64.b64encode(vaulting._identifier_introduction(owner, modules)).decode("ascii")
            with self.assertRaises(vaulting.RuntimeFault) as error:
                asyncio.run(vaulting._import_identifier(target, organizer, modules, encoded, "owner"))
            self.assertEqual(error.exception.code, "CONFLICT", repr(error.exception.__cause__))
            self.assertEqual(target.kevers[peer.pre].serder.said, existing)
            self.assertIsNone(organizer.get(peer.pre))

    def test_import_validates_before_mutating_the_target(self):
        module = Path(__file__).resolve().parent.parent / "app/runtime/vaulting.py"
        spec = importlib.util.spec_from_file_location("vaulting_import_test", module)
        vaulting = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(vaulting)
        modules = {"db": db, "kering": kering, "eventing": eventing, "parsing": parsing,
                   "routing": routing, "webbasing": webbasing}
        with (habbing.openHby(name="import-owner", temp=True, version=kering.Vrsn_2_0) as source,
              habbing.openHby(name="import-mailbox", temp=True, version=kering.Vrsn_2_0) as service,
              habbing.openHby(name="import-target", temp=True, version=kering.Vrsn_2_0) as target):
            owner = source.makeHab(name="owner", version=kering.Vrsn_2_0)
            owner.rotate()
            other = source.makeHab(name="other", version=kering.Vrsn_2_0)
            mailbox = service.makeHab(name="mailbox", version=kering.Vrsn_2_0)
            source.psr.parse(ims=mailbox.replay(gvrsn=kering.Vrsn_2_0), version=kering.Vrsn_2_0)
            source.psr.parse(ims=mailbox.makeLocScheme(url="http://127.0.0.1:9999", version=kering.Vrsn_2_0),
                             version=kering.Vrsn_2_0)
            source.psr.parse(ims=owner.makeEndRole(eid=mailbox.pre, role=kering.Roles.mailbox,
                                                  stamp="2026-10-09T00:00:00.000000+00:00",
                                                  version=kering.Vrsn_2_0), version=kering.Vrsn_2_0)
            valid = vaulting._identifier_introduction(owner, modules)
            corrupt = eventing.messagize(serder=owner.iserder, sigers=owner.sign(ser=b"wrong"),
                                         gvrsn=kering.Vrsn_2_0)
            inception = next(owner.db.clonePreIter(pre=owner.pre, gvrsn=kering.Vrsn_2_0))
            corrupt_rotation = eventing.messagize(serder=owner.kever.serder, sigers=owner.sign(ser=b"wrong"),
                                                  gvrsn=kering.Vrsn_2_0)
            unrelated = vaulting._identifier_introduction(other, modules)
            organizer = organizing.Organizer(hby=target)

            def import_file(raw):
                encoded = base64.b64encode(raw).decode("ascii")
                return asyncio.run(vaulting._import_identifier(target, organizer, modules, encoded, "owner"))

            for invalid in (b"", b"not CESR", owner.iserder.raw, corrupt, inception + corrupt_rotation,
                            valid + b"broken", valid + unrelated):
                with self.subTest(invalid=invalid[:16]):
                    with self.assertRaises(vaulting.RuntimeFault) as error:
                        import_file(invalid)
                    self.assertEqual(error.exception.code, "VALIDATION")
                    self.assertNotIn(owner.pre, target.kevers)
                    self.assertIsNone(organizer.get(owner.pre))

            self.assertEqual(import_file(valid), owner.pre)
            self.assertIn(owner.pre, target.kevers)
            self.assertEqual(target.kevers[owner.pre].sn, 1)
            self.assertTrue(target.db.ends.get(keys=(owner.pre, "mailbox", mailbox.pre)).allowed)
            self.assertEqual(target.db.locs.get(keys=(mailbox.pre, "http")).url, "http://127.0.0.1:9999")
            self.assertEqual(organizer.get(owner.pre)["alias"], "owner")
            self.assertEqual(vaulting._get_remote_record(target, organizer, owner.pre)["aid"], owner.pre)
            self.assertEqual(import_file(valid), owner.pre)
            source.psr.parse(ims=owner.makeEndRole(eid=mailbox.pre, role=kering.Roles.mailbox,
                                                  stamp="2026-11-02T00:00:00.000000+00:00", allow=False,
                                                  version=kering.Vrsn_2_0), version=kering.Vrsn_2_0)
            self.assertEqual(import_file(vaulting._identifier_introduction(owner, modules)), owner.pre)
            self.assertFalse(target.db.ends.get(keys=(owner.pre, "mailbox", mailbox.pre)).allowed)
            self.assertEqual(import_file(valid), owner.pre)
            self.assertFalse(target.db.ends.get(keys=(owner.pre, "mailbox", mailbox.pre)).allowed)
            source.psr.parse(ims=owner.makeEndRole(eid=mailbox.pre, role=kering.Roles.mailbox,
                                                  stamp="2026-11-02T00:00:01.000000+00:00",
                                                  version=kering.Vrsn_2_0), version=kering.Vrsn_2_0)
            self.assertEqual(import_file(vaulting._identifier_introduction(owner, modules)), owner.pre)
            self.assertTrue(target.db.ends.get(keys=(owner.pre, "mailbox", mailbox.pre)).allowed)


if __name__ == "__main__":
    unittest.main()
