from __future__ import annotations

import asyncio
import base64
import importlib
import json
import re
from dataclasses import asdict
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse


class NullConfiger:
    def __init__(self):
        self.opened = True
        self.temp = False

    def get(self, human=None):
        return {}

    def close(self, clear=False):
        self.opened = False
        return True


class RuntimeFault(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class _TransientStorage(dict):
    async def sync(self):
        pass


async def _open_transient_storage(_namespace):
    return _TransientStorage()


_CONFIG: dict = {}
_STATE = None
_REGISTRY = None


def configure_runtime(
    *,
    ensure_runtime_packages,
    load_modules,
    clienter_factory,
    storage_opener,
    wallet_storage_prefix: str,
    registry_name: str,
    registry_store: str,
    passcode_kdf_defaults: dict,
    default_settings: dict,
    kf_state_subdb: str,
):
    _CONFIG.clear()
    _CONFIG.update(
        ensure_runtime_packages=ensure_runtime_packages,
        load_modules=load_modules,
        clienter_factory=clienter_factory,
        storage_opener=storage_opener,
        wallet_storage_prefix=wallet_storage_prefix,
        registry_name=registry_name,
        registry_store=registry_store,
        passcode_kdf_defaults=dict(passcode_kdf_defaults),
        default_settings=dict(default_settings),
        kf_state_subdb=kf_state_subdb,
    )


def load_modules():
    return _CONFIG["load_modules"]()


async def _ensure_runtime_packages():
    await _CONFIG["ensure_runtime_packages"]()


def default_settings():
    return dict(_CONFIG["default_settings"])


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _sort_key(value):
    return (value or "").lower()


def _storage_name_for(vault_id: str):
    return f"{_CONFIG['wallet_storage_prefix']}{vault_id}"


def _generate_root_salt():
    return load_modules()["signing"].Salter().qb64


def dg_key(pre, dig):
    if hasattr(pre, "encode"):
        pre = pre.encode("utf-8")
    if hasattr(dig, "encode"):
        dig = dig.encode("utf-8")
    return b"%s.%s" % (pre, dig)


def _coerce_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _normalize_passcode_kdf(raw_value=None):
    defaults = _CONFIG["passcode_kdf_defaults"]
    raw_value = raw_value if isinstance(raw_value, dict) else {}
    return {
        "algorithm": str(raw_value.get("algorithm") or defaults["algorithm"]),
        "salt": str(raw_value.get("salt") or defaults["salt"]),
        "opslimit": _coerce_int(raw_value.get("opslimit"), defaults["opslimit"]),
        "memlimit": _coerce_int(raw_value.get("memlimit"), defaults["memlimit"]),
        "outlen": _coerce_int(raw_value.get("outlen"), defaults["outlen"]),
    }


def _vault_record(
    *,
    vault_id: str,
    alias: str,
    encrypted: bool,
    root_salt: str,
    passcode_kdf: dict | None = None,
    created_at: str | None = None,
):
    return {
        "id": vault_id,
        "alias": alias,
        "storageName": _storage_name_for(vault_id),
        "description": "Browser-safe KERI vault backed by IndexedDB and a PyScript worker.",
        "runtimeMode": "pyodide-worker",
        "encrypted": bool(encrypted),
        "otpConfigured": False,
        "createdAt": created_at or now_iso(),
        "rootSalt": root_salt,
        "passcodeKdf": _normalize_passcode_kdf(passcode_kdf),
    }


def _registry_payload(record, existing=None):
    payload = dict(existing) if isinstance(existing, dict) else {}
    payload.update(
        {
            "id": record["id"],
            "alias": record["alias"],
            "storageName": record["storageName"],
            "description": record["description"],
            "runtimeMode": record["runtimeMode"],
            "encrypted": record["encrypted"],
            "otpConfigured": record["otpConfigured"],
            "createdAt": record["createdAt"],
            "rootSalt": record["rootSalt"],
            "passcodeKdf": record["passcodeKdf"],
        }
    )
    return payload


def _coerce_vault_record(record):
    vault_id = str(record.get("id") or "").strip()
    alias = str(record.get("alias") or "").strip() or vault_id
    encrypted = bool(record.get("encrypted", False))
    created_at = str(record.get("createdAt") or "").strip() or now_iso()
    root_salt = str(record.get("rootSalt") or "").strip()
    if not root_salt:
        raise RuntimeFault("BAD_STATE", "Protected vault is missing its root salt.")
    coerced = _vault_record(
        vault_id=vault_id,
        alias=alias,
        encrypted=encrypted,
        root_salt=root_salt,
        passcode_kdf=record.get("passcodeKdf"),
        created_at=created_at,
    )
    coerced["description"] = str(record.get("description") or coerced["description"])
    coerced["runtimeMode"] = str(record.get("runtimeMode") or coerced["runtimeMode"])
    coerced["otpConfigured"] = bool(record.get("otpConfigured", record.get("hasOtp", False)))
    storage_name = str(record.get("storageName") or "").strip()
    if storage_name != coerced["storageName"]:
        raise RuntimeFault("BAD_STATE", "Protected vault storage name is invalid.")
    return coerced


def _vault_view(record):
    return {
        "id": record["id"],
        "alias": record["alias"],
        "storageName": record["storageName"],
        "description": record["description"],
        "runtimeMode": record["runtimeMode"],
        "encrypted": record["encrypted"],
        "otpConfigured": record["otpConfigured"],
        "createdAt": record["createdAt"],
        "opened": _STATE is not None and _STATE["vault"]["id"] == record["id"],
    }


def _json_bytes(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _json_from_bytes(raw_value):
    if raw_value is None:
        return None
    return json.loads(raw_value.decode("utf-8"))


def _registry_records(registry):
    records = []
    for raw_key, raw_value in registry["store"].items.items():
        raw_record = _json_from_bytes(raw_value)
        if raw_record is None:
            continue
        record = _coerce_vault_record(raw_record)
        if not record["id"]:
            continue
        migrated = _registry_payload(record, existing=raw_record)
        if migrated != raw_record:
            registry["db"].setVal(registry["store"], raw_key, _json_bytes(migrated))
        records.append(record)
    records.sort(key=lambda item: (_sort_key(item["alias"]), item["id"]))
    return records


def _registry_record_by_id(registry, vault_id: str):
    raw_key = vault_id.encode("utf-8")
    raw_value = registry["db"].getVal(registry["store"], raw_key)
    record = _json_from_bytes(raw_value)
    if record is None:
        return None

    coerced = _coerce_vault_record(record)
    migrated = _registry_payload(coerced, existing=record)
    if migrated != record:
        registry["db"].setVal(registry["store"], raw_key, _json_bytes(migrated))
    return coerced


def _registry_record_by_alias(registry, alias: str):
    target = _sort_key(alias)
    for record in _registry_records(registry):
        if _sort_key(record["alias"]) == target:
            return record
    return None


def _set_registry_record(registry, record):
    registry["db"].setVal(
        registry["store"],
        record["id"].encode("utf-8"),
        _json_bytes(_registry_payload(_coerce_vault_record(record))),
    )


async def ensure_registry():
    global _REGISTRY

    if _REGISTRY is not None:
        return _REGISTRY

    await _ensure_runtime_packages()
    modules = load_modules()
    db = await modules["webdbing"].WebDBer.open(
        name=_CONFIG["registry_name"],
        stores=[_CONFIG["registry_store"]],
        storageOpener=_CONFIG["storage_opener"],
    )
    store = db.env.open_db(_CONFIG["registry_store"])
    _REGISTRY = {"db": db, "store": store}
    return _REGISTRY


async def close_idle_registry():
    global _REGISTRY
    if _STATE is not None:
        return False
    if _REGISTRY is not None:
        await _REGISTRY["db"].flush()
        _REGISTRY["db"].close()
        _REGISTRY = None
    return True


def _format_bran(passcode: str):
    return passcode.replace("-", "")


def _stretch_password_to_bran(password: str, passcode_kdf: dict):
    import pysodium

    fixed_salt = str(passcode_kdf["salt"]).encode("utf-8")
    stretched = pysodium.crypto_pwhash(
        outlen=passcode_kdf["outlen"],
        passwd=password,
        salt=fixed_salt,
        opslimit=passcode_kdf["opslimit"],
        memlimit=passcode_kdf["memlimit"],
        alg=pysodium.crypto_pwhash_ALG_ARGON2ID13,
    )
    return base64.urlsafe_b64encode(stretched).decode("utf-8").rstrip("=")


def _prepare_bran(passcode, passcode_kdf=None):
    password = _format_bran(str(passcode or "").strip())
    if not password:
        return ""
    return _stretch_password_to_bran(password, _normalize_passcode_kdf(passcode_kdf))


def _vault_id_for_alias(alias: str, existing_ids: set[str]):
    base = re.sub(r"[^a-z0-9]+", "-", alias.lower()).strip("-") or "vault"
    candidate = base
    counter = 2
    while candidate in existing_ids:
        candidate = f"{base}-{counter}"
        counter += 1
    return candidate


async def _validate_open_kels(baser, modules, *, keeper=None):
    """Reject incomplete local histories before making a vault available."""
    habs = baser._stores["habs."]
    persisted_habs = modules["webdbing"]._deserialize_records(habs.handle.get("__records__"))
    if dict(habs.items) != persisted_habs:
        # Browser reload removes orphaned habitat records; preserve them for recovery.
        habs.items.clear()
        habs.items.update(persisted_habs)
        habs.dirty = False
        raise RuntimeFault("BAD_STATE", "Vault contains incomplete identifier state and requires recovery.")
    if any(record.hid not in baser.prefixes for _, record in baser.habs.getTopItemIter()):
        raise RuntimeFault("BAD_STATE", "Vault contains an identifier without a verified key state.")

    staging = modules["webbasing"].WebBaser(name="kel-validation", temp=True)
    try:
        await staging.reopen(storageOpener=_open_transient_storage)
        staging.prefixes.update(baser.prefixes)
        staging.groups.update(baser.groups)
        kevery = modules["eventing"].Kevery(db=staging, lax=False, local=True)
        for pre in baser.prefixes:
            kever = baser.kevers[pre]
            if keeper is not None and pre not in baser.groups:
                situation = keeper.sits.get(keys=(pre,))
                if (situation is None or situation.new.pubs != [verfer.qb64 for verfer in kever.verfers] or
                        len(situation.nxt.pubs) != len(kever.ndigers) or
                        any(not diger.verify(ser=pub.encode("utf-8"))
                            for diger, pub in zip(kever.ndigers, situation.nxt.pubs))):
                    raise RuntimeFault("BAD_STATE", "Vault signing keys do not match its identifier history.")
            events = list(baser.kels.getAllItemIter(keys=pre, on=0))
            if len(events) != kever.sn + 1:
                raise RuntimeFault("BAD_STATE", "Vault contains incomplete or conflicting identifier history.")
            digests = []
            for expected_sn, (_, sn, dig) in enumerate(events):
                if sn != expected_sn:
                    raise RuntimeFault("BAD_STATE", "Vault contains incomplete or conflicting identifier history.")
                event = baser.evts.get(keys=(pre, dig))
                if event is None or event.said != dig or event.pre != pre or event.sn != sn or not event.verify():
                    raise RuntimeFault("BAD_STATE", "Vault contains an invalid identifier event.")
                sigers = baser.sigs.get(keys=(pre, dig))
                if not sigers:
                    raise RuntimeFault("BAD_STATE", "Vault contains an identifier event without signatures.")
                try:
                    kevery.processEvent(serder=event, sigers=sigers, local=True)
                except Exception as exc:
                    raise RuntimeFault("BAD_STATE", "Vault contains an unverifiable identifier history.") from exc
                if pre not in staging.kevers or staging.kevers[pre].serder.said != dig:
                    raise RuntimeFault("BAD_STATE", "Vault contains an unverifiable identifier history.")
                digests.append(dig)
            first_seen = [dig for _, _, dig in baser.fels.getAllItemIter(keys=pre, on=0)]
            if digests != first_seen or not digests or digests[-1] != kever.serder.said:
                raise RuntimeFault("BAD_STATE", "Vault contains incomplete or conflicting identifier history.")
            stored_state = asdict(kever.state())
            replayed_state = asdict(staging.kevers[pre].state())
            for field in ("dt", "f"):
                stored_state.pop(field, None)
                replayed_state.pop(field, None)
            if stored_state != replayed_state:
                raise RuntimeFault("BAD_STATE", "Vault key state does not match its verified identifier history.")
    finally:
        await staging.aclose(clear=True)


async def _build_vault_state(record, *, bran: str = ""):
    await _ensure_runtime_packages()
    modules = load_modules()
    keeper = modules["webkeeping"].WebKeeper(name=record["storageName"])
    baser = modules["webbasing"].WebBaser(name=record["storageName"])
    kf_state_subdb = _CONFIG["kf_state_subdb"]
    if kf_state_subdb not in baser.SubDbNames:
        baser.SubDbNames = [*baser.SubDbNames, kf_state_subdb]
    cf = NullConfiger()
    try:
        await keeper.reopen(storageOpener=_CONFIG["storage_opener"])
        await baser.reopen(storageOpener=_CONFIG["storage_opener"])
        await _validate_open_kels(baser, modules, keeper=keeper)
        hby = modules["habbing"].Habery(
            name=record["storageName"],
            ks=keeper,
            db=baser,
            cf=cf,
            temp=False,
            salt=record["rootSalt"],
            bran=bran or None,
        )
    except BaseException as error:
        for store in (baser, keeper):
            try:
                await store.aclose(clear=False)
            except BaseException as close_error:
                error.add_note(f"{type(store).__name__} cleanup failed: {close_error!r}")
        cf.close()
        raise

    return {
        "modules": modules,
        "vault": record,
        "hby": hby,
        "bran": bran,
        "kfSurfaceKeyState": {},
    }


async def close_habery(hby, *, clear: bool = False):
    """Close FortWeb browser stores and wait for persistence."""
    first_error = None
    if hby.ks:
        try:
            await hby.ks.aclose(clear=hby.ks.temp or clear)
        except Exception as error:
            first_error = error
    if hby.db:
        try:
            await hby.db.aclose(clear=hby.db.temp or clear)
        except Exception as error:
            if first_error is None:
                first_error = error
    if hby.cf:
        try:
            hby.cf.close(clear=hby.cf.temp)
        except Exception as error:
            if first_error is None:
                first_error = error

    if first_error is not None:
        raise first_error


async def open_vault_state(record, *, passcode=None, bran: str | None = None):
    global _STATE

    if _STATE is not None and _STATE["vault"]["id"] == record["id"]:
        return require_open_state(record["id"])

    await close_state(clear=False)

    derived_bran = bran or ""
    if record.get("encrypted"):
        if not derived_bran and not str(passcode or "").strip():
            raise RuntimeFault("VALIDATION", "Passcode is required to open this vault.")
        if not derived_bran:
            derived_bran = _prepare_bran(passcode, record.get("passcodeKdf"))

    modules = load_modules()
    try:
        _STATE = await _build_vault_state(record, bran=derived_bran)
    except modules["kering"].AuthError as exc:
        raise RuntimeFault("AUTH_FAILED", str(exc) or "Passcode incorrect for this vault.") from exc
    except ValueError as exc:
        raise RuntimeFault("VALIDATION", str(exc)) from exc

    return _STATE


def require_open_state(vault_id: str | None = None, *, allow_failed_close: bool = False):
    if _STATE is None:
        raise RuntimeFault("LOCKED", "Open a vault before calling vault operations.")
    if vault_id and _STATE["vault"]["id"] != vault_id:
        raise RuntimeFault("LOCKED", f"Vault '{vault_id}' is not open.")
    if _STATE.get("persistence_failed") and not allow_failed_close:
        raise RuntimeFault("BAD_STATE", "Vault persistence failed. Close the vault to retry saving before further use.")
    return _STATE


async def close_state(*, clear: bool = False):
    global _STATE
    if _STATE is None:
        return

    state = _STATE
    try:
        await close_habery(state["hby"], clear=clear)
    except BaseException:
        state["persistence_failed"] = True
        raise
    if _STATE is state:
        _STATE = None


async def flush_open_state():
    state = require_open_state()
    try:
        await state["hby"].ks.flush()
        await state["hby"].db.flush()
    except BaseException:
        state["persistence_failed"] = True
        raise


async def persist_and_reload():
    state = require_open_state()
    vault = state["vault"]
    bran = state["bran"]
    await close_state(clear=False)
    return await open_vault_state(vault, bran=bran)


def require_text(value, *, field: str):
    text = str(value or "").strip()
    if not text:
        raise RuntimeFault("VALIDATION", f"{field} is required.")
    return text


def require_oobi_url(value):
    url = require_text(value, field="OOBI URL")
    parsed = urlparse(url)

    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeFault(
            "VALIDATION",
            "OOBI URL must be an absolute http(s) URL.",
        )

    if parsed.fragment:
        raise RuntimeFault(
            "VALIDATION",
            "OOBI URL must not include a fragment.",
        )

    oobiing = load_modules()["oobiing"]
    if (parsed.path != "/oobi"
            and oobiing.OOBI_RE.fullmatch(parsed.path) is None
            and oobiing.WOOBI_RE.fullmatch(parsed.path) is None):
        raise RuntimeFault("VALIDATION", "URL must use a supported identifier OOBI route.")

    return url


def _require_vault_id(params):
    return require_text(params.get("vaultId"), field="Vault")


def _identifier_record(hab):
    witness_count = len(hab.kever.wits)
    if witness_count == 0:
        witness_summary = "No witnesses"
        status = "Local"
        status_tone = "info"
    elif witness_count == 1:
        witness_summary = "1 witness"
        status = "Witnessed"
        status_tone = "success"
    else:
        witness_summary = f"{witness_count} witnesses"
        status = "Witnessed"
        status_tone = "success"

    return {
        "aid": hab.pre,
        "alias": hab.name,
        "prefix": hab.pre,
        "sequenceNumber": hab.kever.sn,
        "witnessCount": witness_count,
        "witnessSummary": witness_summary,
        "status": status,
        "statusTone": status_tone,
        "kelEvents": hab.kever.sn + 1,
        "lastEventDigest": hab.kever.serder.said,
        "oobi": "",
        "witnesses": [{"alias": wit, "status": "Configured"} for wit in hab.kever.wits],
    }


def _list_identifier_records(hby):
    records = []
    for pre in hby.prefixes:
        hab = hby.habByPre(pre)
        if hab is None or hby.habByName(hab.name) is not hab:
            continue
        records.append(_identifier_record(hab))

    records.sort(key=lambda item: (_sort_key(item["alias"]), item["aid"]))
    return records


def _get_identifier_record(hby, aid: str):
    hab = hby.habByPre(aid)
    if hab is None or hby.habByName(hab.name) is not hab:
        raise RuntimeFault("NOT_FOUND", f"Identifier '{aid}' was not found.")
    return _identifier_record(hab)


def _identifier_introduction(hab, modules):
    """Export public event history and the latest signed delivery information."""
    version = modules["kering"].Vrsn_2_0
    stream = bytearray()
    def append_history(pre):
        count = 0
        try:
            for _, fn, dig in hab.db.fels.getAllItemIter(keys=pre, on=0):
                stream.extend(hab.db.cloneEvtMsg(pre=pre, fn=fn, dig=dig, gvrsn=version))
                count += 1
        except (modules["kering"].MissingEntryError, modules["kering"].SerializeError) as exc:
            raise RuntimeFault("BAD_STATE", "Identifier event history is incomplete.") from exc
        if count < hab.kevers[pre].sn + 1:
            raise RuntimeFault("BAD_STATE", "Identifier event history is incomplete.")

    append_history(hab.pre)
    roles = [(role, eid) for (_, role, eid), end in hab.db.ends.getTopItemIter(keys=(hab.pre,))
             if end.allowed or end.enabled]
    for eid in dict.fromkeys([*hab.kever.wits, *(eid for _, eid in roles)]):
        if eid != hab.pre and eid in hab.kevers:
            append_history(eid)
        stream.extend(hab.loadLocScheme(eid=eid, gvrsn=version))
    for _, said in hab.db.eans.getTopItemIter(keys=(hab.pre,)):
        serder = hab.db.rpys.get(keys=(said.qb64,))
        cigars = []
        for verfer, cigar in hab.db.scgs.get(keys=(said.qb64,)):
            cigar.verfer = verfer
            cigars.append(cigar)
        tsgs = modules["db"].fetchTsgs(db=hab.db.tsgs, diger=said)
        stream.extend(modules["eventing"].messagize(serder=serder, cigars=cigars, tsgs=tsgs, gvrsn=version))
    return bytes(stream)


async def _import_identifier(hby, organizer, modules, encoded, alias):
    if not isinstance(encoded, str) or len(encoded) > 4 * 1024 * 1024:
        raise RuntimeFault("VALIDATION", "Identifier file is missing or too large.")
    try:
        stream = bytearray(base64.b64decode(encoded, validate=True))
        parser = modules["parsing"].Parser(local=False, version=modules["kering"].Vrsn_2_0)
        # Parser.parse tolerates message errors; process extracted messages explicitly before touching the vault.
        extraction = parser.groupParsator(ims=stream, framed=True, local=False,
                                         version=modules["kering"].Vrsn_2_0, processive=False)
        try:
            next(extraction)
            raise ValueError("Incomplete stream")
        except StopIteration as done:
            messages = done.value
        ilks = modules["kering"].Ilks
        if not messages or messages[0].serder.ilk not in (ilks.icp, ilks.dip):
            raise ValueError("Missing inception event")
        aid = messages[0].serder.pre
        if _is_local_identifier(hby, aid):
            raise RuntimeFault("CONFLICT", "A local identifier cannot be imported as a remote.")
        if any(message.serder.pvrsn != modules["kering"].Vrsn_2_0 or
               message.serder.ilk not in (ilks.icp, ilks.dip, ilks.rot, ilks.drt, ilks.ixn, ilks.rpy)
               for message in messages):
            raise ValueError("Unsupported message")

        staging = modules["webbasing"].WebBaser(name="identifier-import", temp=True)
        try:
            await staging.reopen(storageOpener=_open_transient_storage)
            router = modules["routing"].Router()
            revery = modules["routing"].Revery(db=staging, rtr=router)
            kevery = modules["eventing"].Kevery(db=staging, rvy=revery, lax=False, local=False)
            kevery.registerReplyRoutes(router=router)
            for message in messages:
                parser.msgProcess(asdict(message), kvy=kevery, rvy=revery, tvy=None, exc=None, vry=None)
            if aid not in staging.kevers:
                raise ValueError("Missing verified key state")
            endpoints = {aid, *staging.kevers[aid].wits}
            endpoints.update(eid for (_, _, eid), _ in staging.ends.getTopItemIter(keys=(aid,)))
            for message in messages:
                serder = message.serder
                if serder.pre not in endpoints:
                    raise ValueError("Unrelated identifier")
                if serder.ilk == ilks.rpy and serder.route not in (
                    "/loc/scheme", "/end/role/add", "/end/role/cut"
                ):
                    raise ValueError("Unsupported reply")
                if serder.ilk == ilks.rpy and serder.route.startswith("/end/role/") and serder.pre != aid:
                    raise ValueError("Unrelated endpoint role")
                if serder.ilk != ilks.rpy:
                    existing = hby.db.kels.getLast(keys=serder.pre, on=serder.sn)
                    if isinstance(existing, (bytes, bytearray, memoryview)):
                        existing = bytes(existing).decode("utf-8")
                    if existing is not None and existing != serder.said:
                        raise RuntimeFault("CONFLICT", "Identifier history conflicts with this vault.")
        finally:
            await staging.aclose(clear=True)

    except RuntimeFault:
        raise
    except Exception as exc:
        raise RuntimeFault("VALIDATION", "Identifier file is invalid or unsupported.") from exc

    kevery = modules["eventing"].Kevery(db=hby.db, rvy=hby.rvy, lax=False, local=False)
    for message in messages:
        serder = message.serder
        previous = None
        if serder.ilk == ilks.rpy:
            data = serder.ked["a"]
            if serder.route == "/loc/scheme":
                previous = hby.db.lans.get(keys=(data["eid"], data["scheme"]))
            else:
                previous = hby.db.eans.get(keys=(data["cid"], data["role"], data["eid"]))
            if previous is not None and previous.qb64 == serder.said:
                continue
        try:
            parser.msgProcess(asdict(message), kvy=kevery, rvy=hby.rvy, tvy=None, exc=None, vry=None)
        except modules["kering"].UnverifiedReplyError:
            # Staging verified the reply; KERI's freshness rules retain an accepted newer reply.
            if previous is None:
                raise
    organizer.update(aid, {"alias": alias, "cesrImported": "true"})
    return aid


def _issue_signed_credential(hby, organizer, modules, params):
    issuer = require_text(params.get("issuerAid"), field="Issuer")
    recipient = require_text(params.get("recipientAid"), field="Recipient")
    schema_id = require_text(params.get("schemaId"), field="Schema ID")
    attributes = params.get("attributes")
    if not isinstance(attributes, dict) or len(_json_bytes(attributes)) > 1024 * 1024:
        raise RuntimeFault("VALIDATION", "Credential attributes must be a JSON object of at most 1 MiB.")
    _get_identifier_record(hby, issuer)
    _require_remote_contact(hby, organizer, recipient, require_oobi=True)
    if recipient not in hby.kevers:
        raise RuntimeFault("VALIDATION", "Recipient key state is unavailable.")
    if attributes.get("i", recipient) != recipient or attributes.get("d", "") != "" or attributes.get("rd"):
        raise RuntimeFault("VALIDATION", "Attributes must match the recipient and cannot declare a registry.")
    schemer = hby.db.schema.get(keys=(schema_id,))
    if schemer is None:
        raise RuntimeFault("NOT_FOUND", "Schema was not found in this vault.")
    if "rd" in schemer.sed.get("required", []):
        raise RuntimeFault("UNSUPPORTED", "This schema requires registry-backed issuance.")
    try:
        messaging = importlib.import_module("keri.acdc.messaging")
    except ImportError as exc:
        raise RuntimeFault("UNSUPPORTED", "This runtime does not support ACDC issuance.") from exc
    try:
        credential = messaging.acdcmap(israid=issuer, uuid=modules["coring"].Noncer().qb64,
                                       schema=schema_id, attribute={"d": "", **attributes},
                                       iseaid=recipient)
        schemer.typ.resolver = modules["scheming"].CacheResolver(hby.db)
        schemer.verify(raw=json.dumps(credential.sad).encode("utf-8"))
    except Exception as exc:
        raise RuntimeFault("VALIDATION", "Credential does not match the selected schema.") from exc
    proof = hby.habByPre(issuer).endorse(credential, gvrsn=modules["kering"].Vrsn_2_0)
    return {"said": credential.said, "issuerAid": issuer, "recipientAid": recipient,
            "schemaId": schema_id, "authentication": "signature", "registry": None,
            "cesr": base64.b64encode(proof).decode("ascii")}


def _dedupe(values):
    seen = set()
    ordered = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def _remote_roles(hby, aid: str, oobi: str):
    roles = []

    if oobi:
        try:
            query_roles = parse_qs(urlparse(oobi).query).get("tag", [])
            roles.extend(str(tag).strip().replace("-", " ").title() for tag in query_roles)
        except Exception:
            pass

    ends = getattr(hby.db, "ends", None)
    if ends is not None:
        try:
            for (cid, role, eid), end in ends.getItemIter():
                if eid != aid or not getattr(end, "allowed", False):
                    continue
                roles.append(str(role).strip().replace("-", " ").title())
        except Exception:
            pass

    return _dedupe(roles)


def _remote_mailboxes(hby, aid: str):
    mailboxes = []
    ends = getattr(hby.db, "ends", None)
    if ends is None:
        return mailboxes

    try:
        for (cid, role, eid), end in ends.getItemIter():
            if eid != aid or not getattr(end, "allowed", False):
                continue
            if str(role).strip().lower() == "mailbox":
                mailboxes.append(cid)
    except Exception:
        return []

    return _dedupe(mailboxes)


def _remote_verification_count(hby, aid: str):
    reps = getattr(hby.db, "reps", None)
    if reps is None:
        return 0

    try:
        return reps.cnt(keys=(aid,))
    except Exception:
        return 0


def _remote_keystate_updated_at(hby, oobi: str):
    if not oobi:
        return ""

    try:
        roobi = hby.db.roobi.get(keys=(oobi,))
    except Exception:
        return ""

    return str(getattr(roobi, "date", "") or "")


def _remote_record(hby, contact):
    aid = contact["id"]
    kever = hby.kevers[aid] if aid in hby.kevers else None
    alias = contact.get("alias") or aid[:12]
    oobi = contact.get("oobi", "")
    roles = _remote_roles(hby, aid, oobi)
    transferable = bool(kever.transferable) if kever is not None else False

    return {
        "aid": aid,
        "id": aid,
        "alias": alias,
        "prefix": aid,
        "oobi": oobi,
        "company": contact.get("company", ""),
        "org": contact.get("org", ""),
        "note": contact.get("note", ""),
        "sequenceNumber": kever.sn if kever is not None else None,
        "transferable": transferable,
        "transferability": "Transferable" if transferable else "Non-transferable",
        "roles": roles,
        "rolesLabel": ", ".join(roles) if roles else "No roles",
        "status": "Resolved" if kever is not None else "Stored",
        "statusTone": "success" if kever is not None else "info",
    }


def _is_local_identifier(hby, aid: str):
    return hby.habByPre(aid) is not None


def _has_remote_connection(contact):
    return bool(str(contact.get("oobi") or "").strip()) or contact.get("cesrImported") == "true"


def _list_remote_contacts(hby, organizer):
    contacts = []
    for contact in organizer.list():
        aid = str(contact.get("id") or "").strip()
        if not aid or _is_local_identifier(hby, aid) or not _has_remote_connection(contact):
            continue
        contacts.append(contact)
    return contacts


def remote_contacts_by_aid(hby, organizer):
    return {contact["id"]: dict(contact) for contact in _list_remote_contacts(hby, organizer)}


def find_remote_contact_by_oobi(hby, organizer, url: str):
    for contact in _list_remote_contacts(hby, organizer):
        if str(contact.get("oobi") or "").strip() == url:
            return dict(contact)
    return None


def restore_contact(organizer, aid: str, snapshot):
    if snapshot is None:
        organizer.rem(aid)
        return

    organizer.replace(
        aid,
        {field: value for field, value in snapshot.items() if field != "id"},
    )


def clear_oobi_tracking(hby, url: str):
    for store_name in ("oobis", "coobi", "eoobi", "roobi", "moobi"):
        store = getattr(hby.db, store_name, None)
        if store is None:
            continue
        try:
            store.rem(keys=(url,))
        except Exception:
            continue


def _require_remote_contact(
    hby,
    organizer,
    aid: str,
    *,
    require_oobi: bool = False,
    local_code: str = "NOT_FOUND",
    missing_oobi_code: str = "NOT_FOUND",
):
    if _is_local_identifier(hby, aid):
        if local_code == "CONFLICT":
            raise RuntimeFault(
                "CONFLICT",
                "Local identifiers cannot be managed through remotes.",
            )
        raise RuntimeFault("NOT_FOUND", f"Remote identifier '{aid}' was not found.")

    contact = organizer.get(aid)
    if contact is None:
        raise RuntimeFault("NOT_FOUND", f"Remote identifier '{aid}' was not found.")

    if require_oobi and not _has_remote_connection(contact):
        if missing_oobi_code == "CONFLICT":
            raise RuntimeFault(
                "CONFLICT",
                "Connect the remote identifier by OOBI before editing its metadata.",
            )
        raise RuntimeFault(
            "NOT_FOUND",
            f"Remote identifier '{aid}' was not found.",
        )

    return contact


def _remote_detail_record(hby, organizer, aid: str):
    contact = _require_remote_contact(hby, organizer, aid, require_oobi=True)
    record = _remote_record(hby, contact)
    kever = hby.kevers[aid] if aid in hby.kevers else None
    record.update(
        {
            "lastEventDigest": kever.serder.said if kever is not None else "",
            "kelEvents": (kever.sn + 1) if kever is not None else 0,
            "keystateUpdatedAt": _remote_keystate_updated_at(hby, record["oobi"]),
            "mailboxes": _remote_mailboxes(hby, aid),
            "verificationCount": _remote_verification_count(hby, aid),
            "verifications": [],
        }
    )
    return record


def _list_remote_records(hby, organizer):
    records = [_remote_record(hby, contact) for contact in _list_remote_contacts(hby, organizer)]
    records.sort(key=lambda item: (_sort_key(item["alias"]), item["aid"]))
    return records


def _get_remote_record(hby, organizer, aid: str):
    return _remote_detail_record(hby, organizer, aid)


async def await_resolution(hby, oobiery, url: str, *, expected_aid: str = ""):
    modules = load_modules()
    oobiing = modules["oobiing"]
    loop = asyncio.get_running_loop()
    deadline = loop.time() + 10.0

    while loop.time() < deadline:
        oobiery.processFlows()
        if (roobi := hby.db.roobi.get(keys=(url,))) is not None:
            if roobi.state != oobiing.Result.resolved:
                raise RuntimeFault("RUNTIME_ERROR", f"OOBI resolution failed for {url}.")
            return roobi
        if expected_aid and expected_aid in hby.kevers:
            roobi = modules["recording"].OobiRecord(
                cid=expected_aid,
                date=oobiing.nowIso8601(),
                state=oobiing.Result.resolved,
            )
            hby.db.roobi.put(keys=(url,), val=roobi)
            return roobi
        await asyncio.sleep(0.05)

    roobi = hby.db.roobi.get(keys=(url,))
    coobi = hby.db.coobi.get(keys=(url,))
    eoobi = hby.db.eoobi.get(keys=(url,))
    moobi = hby.db.moobi.get(keys=(url,))
    detail = (
        f"roobi={getattr(roobi, 'state', '-')}"
        f" coobi={coobi is not None}"
        f" eoobi={eoobi is not None}"
        f" moobi={moobi is not None}"
        f" expected_aid_known={bool(expected_aid and expected_aid in hby.kevers)}"
    )
    if moobi is not None and getattr(moobi, "urls", None):
        detail = f"{detail} moobi_urls={list(moobi.urls)}"

    raise RuntimeFault("TIMEOUT", f"Timed out resolving OOBI '{url}'. {detail}")


def pick_oobi(raw: dict):
    oobis = raw.get("oobis")
    if isinstance(oobis, list):
        for item in oobis:
            if isinstance(item, str) and item:
                return item
    value = raw.get("oobi", "")
    return str(value or "").strip()


def _vault_summary(state):
    hby = state["hby"]
    organizer = state["modules"]["organizing"].Organizer(hby=hby)
    vault = state["vault"]
    remote_count = len(_list_remote_records(hby, organizer))
    return {
        "vault": {
            **_vault_view(vault),
            "opened": True,
            "identifierCount": len(_list_identifier_records(hby)),
            "remoteCount": remote_count,
            "contactCount": remote_count,
            "storageBackend": _CONFIG["default_settings"]["storageBackend"],
            "runtimeStatus": "Browser vault worker open over WebBaser and WebKeeper.",
        }
    }


async def _registry_operation(method, params, state):
    try:
        from keri.acdc import registering, registraring, regeventing, webregbasing
    except ImportError as exc:
        raise RuntimeFault("UNSUPPORTED", "This runtime does not support browser registries.") from exc

    name = require_text(params.get("name"), field="Registry name")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", name) or name == "_fortweb_pending":
        raise RuntimeFault("VALIDATION", "Registry name must contain only letters, numbers, hyphens, and underscores.")
    baser = webregbasing.WebRegBaser(name=state["vault"]["storageName"])
    await baser.reopen(storageOpener=_CONFIG["storage_opener"])
    try:
        store = registering.RegistryStore(baser)
        if store.records.get(keys="_fortweb_pending") is not None:
            raise RuntimeFault("BAD_STATE", "Registry operation is incomplete and requires recovery.")
        try:
            manager = registraring.Regery(hby=state["hby"], baser=baser)
        except Exception as exc:
            raise RuntimeFault("BAD_STATE", "Registry storage is invalid or incomplete.") from exc

        def validate():
            count = len(manager.names)
            for key in ("evts.", "ancs.", "tels.", "heds."):
                if len(baser.db._stores[key].items) != count:
                    raise RuntimeFault("BAD_STATE", "Registry storage is incomplete or conflicting.")
            if baser.db._stores["maes."].items or baser.db._stores["ooes."].items:
                raise RuntimeFault("BAD_STATE", "Registry storage contains unresolved events.")
            if len(manager.regs) != count:
                raise RuntimeFault("BAD_STATE", "Registry aliases conflict.")
            for reg in manager.names.values():
                rip = store.seqEvent(reg.regk, 0)
                head = store.head(reg.regk)
                anchor = store.anchor(reg.regk)
                if rip is None or rip.said != reg.regk or head is None or head.qb64 != reg.regk or anchor is None:
                    raise RuntimeFault("BAD_STATE", "Registry inception evidence is incomplete.")
                try:
                    verified = regeventing.vet(rip, db=state["hby"].db)
                except Exception as exc:
                    raise RuntimeFault("BAD_STATE", "Registry anchoring evidence is invalid.") from exc
                if verified.issuer != reg.hab.pre or verified.regid != reg.regk or verified.anchors[0] != (anchor[0].sn, anchor[1].qb64):
                    raise RuntimeFault("BAD_STATE", "Registry anchoring evidence conflicts.")

        validate()
        if method == "registries.create":
            if name in manager.names:
                raise RuntimeFault("CONFLICT", "Registry name already exists.")
            issuer = require_text(params.get("issuerAid"), field="Issuer")
            _get_identifier_record(state["hby"], issuer)
            hab = state["hby"].habByPre(issuer)
            # shortcut: incomplete operations stay blocked until verified recovery exists.
            if not store.records.pin(keys="_fortweb_pending", val=registering.RegistryRecord(registryKey="pending")):
                raise RuntimeFault("BAD_STATE", "Unable to record the pending registry operation.")
            try:
                await baser.db.flush()
                reg = manager.makeRegistry(name=name, prefix=issuer)
                rip = store.event(reg.regk)
                hab.interact(data=[dict(i=reg.regk, s=rip.sad["n"], d=rip.said)],
                             version=state["modules"]["kering"].Vrsn_2_0,
                             gvrsn=state["modules"]["kering"].Vrsn_2_0)
                if not reg.anchorMsg(rip.said) or reg.sn != 0:
                    raise RuntimeFault("BAD_STATE", "Registry inception was not accepted.")
                await flush_open_state()
                await _validate_open_kels(state["hby"].db, state["modules"], keeper=state["hby"].ks)
                await baser.db.flush()
                validate()
                if not store.records.rem(keys="_fortweb_pending"):
                    raise RuntimeFault("BAD_STATE", "Unable to complete the pending registry operation.")
                await baser.db.flush()
            except BaseException:
                state["persistence_failed"] = True
                raise
        else:
            reg = manager.registryByName(name)
            if reg is None:
                raise RuntimeFault("NOT_FOUND", "Registry was not found.")
            rip = store.seqEvent(reg.regk, 0)
        return {"registry": {"name": name, "registryId": reg.regk, "issuerAid": reg.hab.pre,
                             "inception": base64.b64encode(rip.raw).decode("ascii"),
                             "kel": base64.b64encode(_identifier_introduction(reg.hab, state["modules"])).decode("ascii")}}
    finally:
        await baser.aclose()


async def dispatch(method: str, params: dict):
    if method == "vaults.list":
        registry = await ensure_registry()
        return {"vaults": [_vault_view(record) for record in _registry_records(registry)]}

    if method == "vaults.create":
        registry = await ensure_registry()
        alias = require_text(params.get("name"), field="Vault name")

        if _registry_record_by_alias(registry, alias) is not None:
            raise RuntimeFault("CONFLICT", f"Vault '{alias}' already exists.")

        vault_id = _vault_id_for_alias(alias, {record["id"] for record in _registry_records(registry)})
        passcode = str(params.get("passcode") or "")
        encrypted = bool(passcode.strip())
        record = _vault_record(
            vault_id=vault_id,
            alias=alias,
            encrypted=encrypted,
            root_salt=_generate_root_salt(),
            passcode_kdf=_normalize_passcode_kdf(),
        )
        bran = _prepare_bran(passcode, record["passcodeKdf"]) if encrypted else ""

        temp_state = await _build_vault_state(record, bran=bran)
        await close_habery(temp_state["hby"], clear=False)

        _set_registry_record(registry, record)
        await registry["db"].flush()
        return {"vault": _vault_view(record)}

    if method == "vaults.open":
        registry = await ensure_registry()
        vault_id = _require_vault_id(params)
        record = _registry_record_by_id(registry, vault_id)
        if record is None:
            raise RuntimeFault("NOT_FOUND", f"Vault '{vault_id}' was not found.")
        state = await open_vault_state(record, passcode=params.get("passcode"))
        return _vault_summary(state)

    if method == "vaults.close":
        vault_id = _require_vault_id(params)
        require_open_state(vault_id, allow_failed_close=True)
        await close_state(clear=False)
        return {"vault": {"id": vault_id, "opened": False}}

    if method == "vaults.summary":
        state = require_open_state(_require_vault_id(params))
        return _vault_summary(state)

    if method == "settings.get":
        vault_id = params.get("vaultId")
        if vault_id is None or not str(vault_id).strip():
            return {
                "settings": {
                    **default_settings(),
                    "runtimeStatus": "Browser vault worker open over WebBaser and WebKeeper.",
                }
            }

    state = require_open_state(_require_vault_id(params))
    if method.startswith("registries."):
        return await _registry_operation(method, params, state)
    if method == "settings.get":
        return {
            "settings": {
                **default_settings(),
                "runtimeStatus": "Browser vault worker open over WebBaser and WebKeeper.",
            }
        }

    modules = state["modules"]
    hby = state["hby"]
    organizer = modules["organizing"].Organizer(hby=hby)

    if method == "identifiers.list":
        return {"identifiers": _list_identifier_records(hby)}

    if method == "identifiers.get":
        aid = require_text(params.get("aid"), field="Identifier")
        return {"identifier": _get_identifier_record(hby, aid)}

    if method == "identifiers.export":
        aid = require_text(params.get("aid"), field="Identifier")
        _get_identifier_record(hby, aid)
        introduction = _identifier_introduction(hby.habByPre(aid), modules)
        return {"cesr": base64.b64encode(introduction).decode("ascii")}

    if method == "identifiers.create":
        alias = require_text(params.get("alias"), field="Identifier alias")
        if hby.habByName(alias) is not None:
            raise RuntimeFault("CONFLICT", f"Identifier alias '{alias}' already exists.")

        hby.makeHab(name=alias, icount=1, isith="1", ncount=1, nsith="1")
        reopened = await persist_and_reload()
        return {
            "identifier": _get_identifier_record(reopened["hby"], reopened["hby"].habByName(alias).pre),
        }

    if method == "schemas.import":
        schema_id = require_text(params.get("schemaId"), field="Schema ID")
        schema = params.get("schema")
        if not isinstance(schema, str) or not schema or len(schema.encode("utf-8")) > 1024 * 1024:
            raise RuntimeFault("VALIDATION", "A JSON schema of at most 1 MiB is required.")
        try:
            schemer = modules["scheming"].Schemer(raw=schema.encode("utf-8"))
            if schemer.said != schema_id:
                raise ValueError("Schema ID mismatch")
        except Exception as exc:
            raise RuntimeFault("VALIDATION", "Schema is invalid or does not match its expected ID.") from exc
        if hby.db.schema.get(keys=(schema_id,)) is None:
            hby.db.schema.pin(keys=(schema_id,), val=schemer)
            reopened = await persist_and_reload()
            schemer = reopened["hby"].db.schema.get(keys=(schema_id,))
        return {"schema": {"said": schemer.said, "title": schemer.sed.get("title", ""), "raw": schemer.raw.decode("utf-8")}}

    if method == "schemas.get":
        schema_id = require_text(params.get("schemaId"), field="Schema ID")
        schemer = hby.db.schema.get(keys=(schema_id,))
        if schemer is None:
            raise RuntimeFault("NOT_FOUND", "Schema was not found in this vault.")
        return {"schema": {"said": schemer.said, "title": schemer.sed.get("title", ""), "raw": schemer.raw.decode("utf-8")}}

    if method == "credentials.issueSigned":
        return {"credential": _issue_signed_credential(hby, organizer, modules, params)}

    if method == "remotes.list":
        return {"remotes": _list_remote_records(hby, organizer)}

    if method == "remotes.get":
        aid = require_text(params.get("aid"), field="Remote identifier")
        return {"remote": _get_remote_record(hby, organizer, aid)}

    if method == "remotes.import":
        alias = require_text(params.get("alias"), field="Alias")
        aid = await _import_identifier(hby, organizer, modules, params.get("cesr"), alias)
        reopened = await persist_and_reload()
        reopened_organizer = reopened["modules"]["organizing"].Organizer(hby=reopened["hby"])
        return {"remote": _get_remote_record(reopened["hby"], reopened_organizer, aid)}

    if method == "remotes.update":
        aid = require_text(params.get("aid"), field="Remote identifier")
        patch = params.get("patch") or {}
        if not isinstance(patch, dict):
            raise RuntimeFault("BAD_REQUEST", "Remote update patch must be an object.")
        if "oobi" in patch:
            raise RuntimeFault(
                "BAD_REQUEST",
                "Remote OOBI changes must go through remotes.resolveOobi.",
            )

        disallowed_fields = sorted(set(patch.keys()) - {"alias", "company", "org", "note"})
        if disallowed_fields:
            raise RuntimeFault(
                "BAD_REQUEST",
                "Only remote metadata fields alias, company, org, and note can be updated.",
            )

        _require_remote_contact(
            hby,
            organizer,
            aid,
            require_oobi=True,
            local_code="CONFLICT",
            missing_oobi_code="CONFLICT",
        )
        current_remote = _get_remote_record(hby, organizer, aid)

        cleaned = {}
        for field in ("alias", "company", "org", "note"):
            if field not in patch:
                continue
            value = str(patch[field] or "").strip()
            if field == "alias" and not value:
                raise RuntimeFault("VALIDATION", "Remote alias is required.")
            cleaned[field] = value

        if not cleaned:
            raise RuntimeFault("VALIDATION", "No remote fields were provided.")

        organizer.update(aid, cleaned)
        reopened = await persist_and_reload()
        reopened_organizer = reopened["modules"]["organizing"].Organizer(hby=reopened["hby"])
        remote = _get_remote_record(reopened["hby"], reopened_organizer, aid)
        if remote["aid"] != current_remote["aid"] or remote["oobi"] != current_remote["oobi"]:
            raise RuntimeFault("CONFLICT", "Remote identity state changed during metadata update.")
        return {"remote": remote}

    if method == "remotes.resolveOobi":
        url = require_oobi_url(params.get("url"))
        alias = str(params.get("alias") or "").strip()
        existing_remote = find_remote_contact_by_oobi(hby, organizer, url)
        if existing_remote is not None:
            raise RuntimeFault(
                "CONFLICT",
                "OOBI is already connected. Use remote edit for metadata changes.",
            )

        remote_contacts_before = remote_contacts_by_aid(hby, organizer)
        clear_oobi_tracking(hby, url)

        oobi_record = modules["recording"].OobiRecord(date=modules["oobiing"].nowIso8601())
        if alias:
            oobi_record.oobialias = alias

        resolved_aid = None
        hby.db.oobis.pin(keys=(url,), val=oobi_record)
        try:
            roobi = await await_resolution(
                hby,
                modules["oobiing"].Oobiery(
                    hby=hby,
                    clienter=_CONFIG["clienter_factory"](),
                ),
                url,
            )
            resolved_aid = roobi.cid
            if _is_local_identifier(hby, resolved_aid):
                raise RuntimeFault(
                    "CONFLICT",
                    "OOBI connect cannot add a local identifier to remotes.",
                )
            if resolved_aid in remote_contacts_before:
                raise RuntimeFault(
                    "CONFLICT",
                    "OOBI is already connected to a stored remote identifier.",
                )

            update = {"oobi": url}
            if alias:
                update["alias"] = alias
            organizer.update(resolved_aid, update)

            reopened = await persist_and_reload()
            reopened_organizer = reopened["modules"]["organizing"].Organizer(hby=reopened["hby"])
            return {
                "remote": _get_remote_record(reopened["hby"], reopened_organizer, resolved_aid),
            }
        except RuntimeFault:
            if resolved_aid is not None:
                restore_contact(organizer, resolved_aid, remote_contacts_before.get(resolved_aid))
            clear_oobi_tracking(hby, url)
            raise

    raise RuntimeFault("BAD_REQUEST", f"Runtime method '{method}' is not allowed.")
