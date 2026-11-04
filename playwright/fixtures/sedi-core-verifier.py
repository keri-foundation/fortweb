import base64
import json
import os
import sys
from pathlib import Path

from keri import Vrsn_2_0
from keri.acdc import Regery, loadHandlers, regeventing
from keri.app import openCF, openHby
from keri.core import BlindState, Blinder, Kevery, Kramer, Parser, Salter, SealEvent, SealSource, SerderACDC, eventing
from keri.acdc.ipexing import IpexHandler, _normalizeNodeStream
from keri.help import helping
from keri.peer import Exchanger
from keri.peer.exchanging import loadParsedNestedSubstreams
from tests.sedi.test_ipex_sedi import Recorder, _KRAM_CONFIG, _cacheSediSchemas


root = Path(sys.argv[1])
mode = sys.argv[2] if len(sys.argv) > 2 else 'valid'
fixture = json.loads((root / 'core-public-fixture.json').read_text())
decode = lambda text: base64.b64decode(text, validate=True)

with openHby(name='fortweb-native-verifier', temp=True,
             salt=Salter(raw=b'fort-native-demo').qb64, version=Vrsn_2_0) as hby:
    hab = hby.makeHab(name='verifier')
    assert hab.pre == fixture['verifierAid']
    _cacheSediSchemas(hby.db)
    rgy = Regery(hby=hby, name='fortweb-core-independent', temp=True)
    try:
        recorder = Recorder()
        exchanger = Exchanger(hby=hby, handlers=[])
        loadHandlers(hby=hby, exc=exchanger, notifier=recorder, rgy=rgy)
        with openCF(name='fortweb-core-independent', base='test', temp=True) as cf:
            cf.put(_KRAM_CONFIG)
            kvy = Kevery(db=hby.db, lax=False, local=False, kramer=Kramer(db=hby.db, cf=cf), exc=exchanger)
            parser = Parser(version=Vrsn_2_0)
            for evidence in [fixture['evidence'], *fixture['supporting']]:
                kel = bytearray(decode(evidence['kel']))
                parser.parse(ims=kel, kvy=kvy)
                assert not kel
                signed = bytearray(decode(evidence['cesr']))
                extraction = parser.groupParsator(ims=signed, framed=True, version=Vrsn_2_0, processive=False)
                try:
                    next(extraction)
                except StopIteration as done:
                    message, = done.value
                else:
                    raise AssertionError('incomplete credential proof')
                assert not signed
                credential = message.serder
                assert credential.said == evidence['said'] and credential.sad['s'] == evidence['schemaId']
                assert hby.db.schema.get(keys=credential.sad['s']).verify(raw=json.dumps(credential.sad).encode())
                prefix, number, diger, sigers = message.tsgs[0]
                tholder, verfers = hby.db.resolveVerifiers(pre=prefix.qb64, sn=number.sn, dig=diger.qb64)
                _, indices = eventing.verifySigs(credential.raw, sigers, verfers)
                assert prefix.qb64 == evidence['issuerAid'] and tholder.satisfy(indices)
                events = [SerderACDC(raw=decode(item)) for item in evidence['tel']]
                result = regeventing.vet(events[0], events[1:], db=hby.db,
                                         acdc=credential, blinder=evidence['blinder'])
                assert result.state == 'issued' and result.binding == 'mutual'
                for sn, event in enumerate(events):
                    rgy.store.accept(evidence['registryId'], sn, event)
            if os.environ.get('FORTWEB_NATIVE_WAIT') == '1':
                print('READY', flush=True)
                assert sys.stdin.readline().strip() == 'go'
            presentation = json.loads((root / 'fortweb-presentation.json').read_text())
            assert hab.pre == presentation['exchange']['recipientAid']
            holder_kel = bytearray(decode(presentation['presentation']['kel']))
            parser.parse(ims=holder_kel, kvy=kvy)
            assert not holder_kel
            for sn, raw in enumerate(presentation['presentation']['tel']):
                rgy.store.accept(presentation['presentation']['registryId'], sn, SerderACDC(raw=decode(raw)))
            grant = bytearray(decode(presentation['exchange']['cesr']))
            if mode != 'valid':
                parsed, = parser.parse(ims=bytearray(grant), framed=False, processive=False)
                nests = []
                for index, node in enumerate(parsed.nests):
                    if ((mode == 'missing' and index == 2) or
                            (mode == 'missing-agent' and index == 1)):
                        continue
                    if mode == 'missing-proof' and index == 1:
                        nests.append(_normalizeNodeStream(node.serder.raw))
                        continue
                    proofs = IpexHandler._blindProofs(node)
                    if mode == 'wrong' and index == 0:
                        current = presentation['presentation']['blinder']
                        other = presentation['otherPresentation']['blinder']
                        assert current != other
                        assert sum(proof.qb64 == current for proof in proofs) == 1
                        proofs = [Blinder(clan=BlindState, qb64=other) if proof.qb64 == current else proof
                                  for proof in proofs]
                    bonds = [proof.data for proof in proofs]
                    bonds.extend(SealEvent(i=pre.qb64, s=num.snh, d=dig.qb64) for pre, num, dig in node.ssts)
                    nests.append(_normalizeNodeStream(eventing.messagize(serder=node.serder, bonds=bonds,
                                                                        framed=False, gvrsn=Vrsn_2_0)))
                seals = [SealSource(s=num.snh, d=dig.qb64) for num, dig in parsed.sscs]
                grant = eventing.messagize(serder=parsed.serder, tsgs=parsed.tsgs, bonds=seals,
                                           nests=nests, framed=False, gvrsn=Vrsn_2_0)
            original_intake = kvy.kramer.intake
            def traced_intake(serder, kwa=None):
                try:
                    outcome = original_intake(serder, kwa)
                except Exception as error:
                    import traceback
                    traceback.print_exc()
                    print('diagnostic: kram exception=', type(error).__name__, str(error))
                    raise
                age = (helping.fromIso8601(helping.nowIso8601()) - helping.fromIso8601(serder.stamp)).total_seconds()
                print('diagnostic: kram intake accepted=', outcome is not None, 'age_seconds=', round(age, 2))
                return outcome
            kvy.kramer.intake = traced_intake
            parser.parse(ims=grant, kvy=kvy, exc=exchanger)
            assert not grant
            said = presentation['exchange']['said']
            stored = hby.db.exns.get(keys=(said,))
            if mode != 'valid':
                from keri.core import SerderKERI
                envelope = SerderKERI(raw=decode(presentation['exchange']['cesr']))
                cache = hby.db.kramTMSC.get(keys=(envelope.pre, envelope.ked['x'], said))
                assert cache is not None and cache.rdt, 'negative test did not pass KRAM authentication'
                assert stored is None, 'invalid Grant was accepted'
                assert hby.db.epse.get(keys=(said,)) is None, 'permanently invalid Grant was escrowed'
                assert not recorder.items
                print(f'Native verifier rejected {mode} evidence after KRAM authentication.')
                sys.exit(0)
            if stored is None:
                from keri.acdc.ipexing import IpexHandler
                diagnostic = bytearray(decode(presentation['exchange']['cesr']))
                message, = parser.parse(ims=diagnostic, framed=False, processive=False)
                handler = IpexHandler(resource='/ipex/grant', hby=hby, notifier=recorder, rgy=rgy)
                plan = handler._resolveDisclosurePlan(message.serder)
                walked = handler._walkGraph(origin=message.serder.ked['a']['o'][0], nests=message.nests, closed=True)
                cache = hby.db.kramTMSC.get(keys=(message.serder.pre, message.serder.ked.get('x', ''), said))
                print('diagnostic: plan=', bool(plan), 'nodes=', len(message.nests), 'walk=', walked is not None,
                      'escrow=', hby.db.epse.get(keys=(said,)) is not None, 'kram=', cache is not None,
                      'accepted_timestamp=', bool(cache and cache.rdt))
                if walked is not None:
                    nodes, order = walked
                    print('diagnostic: disclosure=', handler._verifyDisclosurePlan(plan=plan,
                          origin=message.serder.ked['a']['o'][0], nodes=nodes, order=order),
                          'schemas=', handler._verifyNodeSchemas(nodes=nodes, order=order))
                    verdict = handler._evaluateNode(message.serder.ked['a']['o'][0], nodes=nodes, memo={}, records={})
                    print('diagnostic: graph verdict=', getattr(verdict, 'verdict', None),
                          'reason=', getattr(verdict, 'reason', None))
                    print('diagnostic: presentation=', handler._verifyPresentationAuthGraph(
                        serder=message.serder, nodes=nodes, order=order) is not None)
            assert stored is not None and stored.route == '/ipex/grant'
            nodes = loadParsedNestedSubstreams(hby, said)
            assert [n.serder.said for n in nodes] == [fixture['evidence']['said'],
                                                       *[item['said'] for item in fixture['supporting']]]
            assert any(item.get('d') == said for item in recorder.items)
            print('Native verifier accepted Core Grant and all three authority nodes.')
            if os.environ.get('FORTWEB_NATIVE_RECHECK') == '1':
                print('ACCEPTED', flush=True)
                assert sys.stdin.readline().strip() == 'recheck'
                from keri.core import Prefixer
                from keri.peer.exchanging import verify, verifyAttachments

                tsgs, cigars = verify(hby, stored)
                seals = [(Prefixer(qb64=keys[1]), number, diger)
                         for keys, (number, diger) in hby.db.ests.getTopItemIter(keys=(said, ''))]
                tsgs, cigars, seals, invalid, missing = verifyAttachments(
                    hby=hby, serder=stored, tsgs=tsgs, cigars=cigars, sourceSeals=seals)
                assert not invalid and not missing
                sscs = [(number, diger) for prefix, number, diger in seals if prefix.qb64 == stored.pre]
                handler = IpexHandler(resource='/ipex/grant', hby=hby, notifier=recorder, rgy=rgy)
                assert handler.verify(serder=stored, nests=nodes, sscs=sscs, evidence=(tsgs, cigars, seals))
                print('Native verifier rechecked the original accepted Core Grant after holder restart.')
    finally:
        rgy.close()
