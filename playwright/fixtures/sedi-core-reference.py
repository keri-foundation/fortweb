import base64
import json
import sys
from types import SimpleNamespace

from keri import Vrsn_2_0
from keri.acdc import Regery, Registrar
from keri.app.habbing import openHby
from keri.core import Salter
from tests.sedi.test_ipex_sedi import _anchor, _buildSediCredentials, _cacheSediSchemas, _openSediHaberies
from tests.sedi.test_sedi import AgentSchema, CoreSchema, CoreSchemaSaid, UnitSchema


def encoded(data):
    return base64.b64encode(data).decode('ascii')


holder_id, presentation_id = sys.argv[1:]
holder = SimpleNamespace(pre=holder_id, interact=lambda **_: b'')
presentation = SimpleNamespace(regk=presentation_id)
with _openSediHaberies('fortweb-core-fixture') as actors:
    root_hby, org_hby, _, issuer_hby, _, _, root, org, proofer, issuer, _, _ = actors
    registries = [Regery(hby=hby, name=f'core-fixture-{name}', temp=True)
                  for hby, name in ((root_hby, 'root'), (org_hby, 'org'), (issuer_hby, 'issuer'))]
    try:
        root_rgy, org_rgy, issuer_rgy = registries
        root_registrar, org_registrar, issuer_registrar = [Registrar(rgy=rgy) for rgy in registries]
        unit_reg = root_registrar.makeRegistry(name='unit', prefix=root.pre)
        agent_reg = org_registrar.makeRegistry(name='agent', prefix=org.pre)
        core_reg = issuer_registrar.makeRegistry(name='core', prefix=issuer.pre)
        residence_reg = issuer_registrar.makeRegistry(name='residence', prefix=issuer.pre)
        for hab, rgy, registry in ((root, root_rgy, unit_reg), (org, org_rgy, agent_reg),
                                   (issuer, issuer_rgy, core_reg), (issuer, issuer_rgy, residence_reg)):
            _anchor(hab, registry, rgy.store.event(registry.regk))
            _cacheSediSchemas(hab.db)
        _, unit, agent, core, _, _ = _buildSediCredentials(root, org, proofer, issuer, holder,
                                                            unit_reg, agent_reg, core_reg, residence_reg,
                                                            presentation)
        supporting = []
        for registrar, rgy, registry, credential, hab in ((root_registrar, root_rgy, unit_reg, unit, root),
                                                           (org_registrar, org_rgy, agent_reg, agent, org)):
            authority_blinder, authority_issued = registrar.issue(registry, acdc=credential)
            _anchor(hab, registry, authority_issued)
            authority_kel = b''.join(bytes(message) for message in hab.db.clonePreIter(pre=hab.pre))
            authority_rip = rgy.store.seqEvent(registry.regk, 0)
            supporting.append(dict(said=credential.said, issuerAid=hab.pre, recipientAid=credential.iseaid,
                                   schemaId=credential.sad['s'], cesr=encoded(hab.endorse(credential, gvrsn=Vrsn_2_0)),
                                   registryId=registry.regk, sequence=1, head=authority_issued.said,
                                   blinder=authority_blinder.qb64, status='issued', statusSequence=1,
                                   statusBlinder=authority_blinder.qb64,
                                   tel=[encoded(authority_rip.raw), encoded(authority_issued.raw)],
                                   kel=encoded(authority_kel)))
        blinder, issued = issuer_registrar.issue(core_reg, acdc=core)
        _anchor(issuer, core_reg, issued)
        kel = b''.join(bytes(message) for message in issuer.db.clonePreIter(pre=issuer.pre))
        rip = issuer_rgy.store.seqEvent(core_reg.regk, 0)
        evidence = dict(said=core.said, issuerAid=issuer.pre, recipientAid=holder_id,
                        schemaId=CoreSchemaSaid, cesr=encoded(issuer.endorse(core, gvrsn=Vrsn_2_0)),
                        registryId=core_reg.regk, sequence=1, head=issued.said, blinder=blinder.qb64,
                        status='issued', statusSequence=1, statusBlinder=blinder.qb64,
                        tel=[encoded(rip.raw), encoded(issued.raw)], kel=encoded(kel))
        with openHby(name='fortweb-native-verifier', temp=True,
                     salt=Salter(raw=b'fort-native-demo').qb64, version=Vrsn_2_0) as verifier_hby:
            verifier = verifier_hby.makeHab(name='verifier')
            verifier_kel = b''.join(bytes(message) for message in verifier.db.clonePreIter(pre=verifier.pre))
            print(json.dumps(dict(schema=CoreSchema, evidence=evidence, issuer=encoded(kel),
                                  authority_schemas=[AgentSchema, UnitSchema], supporting=list(reversed(supporting)),
                                  verifierAid=verifier.pre, verifierKel=encoded(verifier_kel))))
    finally:
        for rgy in registries:
            rgy.close()
