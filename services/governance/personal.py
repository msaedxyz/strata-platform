"""Personal data of person entities. Source: docs/06-governance.md, personal data.

1. Each person entity has its own data key: 256 random bits. The master key (STRATA_MASTER_KEY, 32 bytes in
   base64 or hex) wraps the data key with AES-256-GCM. The row in person_key holds the wrapped key.
2. The personal fields (config/personal-data.yaml: name, business email, business phone) are encrypted with
   the data key (AES-256-GCM, the entity id is the associated data). Events hold the encrypted blob only.
3. To erase a person, erase() deletes the key row and writes a record to security_log and a PersonErased
   event. The events stay intact. The personal fields become unreadable.

A blind index (HMAC-SHA256 with a key derived from the master key) finds an existing person by the business
email, else by the name and the organisation. It lives in the key row, so an erasure removes it too.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
from functools import lru_cache

import psycopg
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from psycopg.types.json import Jsonb

from services.common.config import load_yaml
from services.common.ids import new_id
from services.common.settings import get_settings

from .event_store import append_event

ALG = "AES-256-GCM"
_WRAP_VERSION = b"\x01"


class PersonalDataError(ValueError):
    pass


class PersonalDataUnavailable(RuntimeError):
    """The master key is not set or not valid. The API maps this error to HTTP 503."""


@lru_cache
def policy() -> dict:
    return load_yaml("personal-data.yaml")


def encrypted_fields() -> list[str]:
    return list(policy()["encrypted_fields"])


def master_key() -> bytes:
    raw = (get_settings().master_key or "").strip()
    if not raw:
        raise PersonalDataUnavailable("STRATA_MASTER_KEY is not set")
    candidates = []
    if len(raw) == 64:
        try:
            candidates.append(binascii.unhexlify(raw))
        except binascii.Error:
            pass
    for decode in (base64.urlsafe_b64decode, base64.b64decode):
        try:
            candidates.append(decode(raw + "=" * (-len(raw) % 4)))
        except (binascii.Error, ValueError):
            pass
    for key in candidates:
        if len(key) == 32:
            return key
    raise PersonalDataUnavailable("STRATA_MASTER_KEY must be 32 bytes in base64 or hex")


def _aad(entity_id: str, purpose: str) -> bytes:
    return f"strata:{purpose}:{entity_id}".encode()


def _wrap(data_key: bytes, entity_id: str) -> bytes:
    nonce = os.urandom(12)
    return _WRAP_VERSION + nonce + AESGCM(master_key()).encrypt(nonce, data_key, _aad(entity_id, "person-key"))


def _unwrap(blob: bytes, entity_id: str) -> bytes:
    blob = bytes(blob)
    if blob[:1] != _WRAP_VERSION:
        raise PersonalDataError("unknown key wrap version")
    try:
        return AESGCM(master_key()).decrypt(blob[1:13], blob[13:], _aad(entity_id, "person-key"))
    except InvalidTag as exc:
        raise PersonalDataError("the key of the person does not match the master key") from exc


def _normal(value: str | None) -> str:
    return " ".join((value or "").lower().split())


def lookup_hash(fields: dict) -> str | None:
    """The blind index of a person: HMAC of the business email, else of the name and the organisation."""
    index_key = hmac.new(master_key(), b"strata:person-lookup", hashlib.sha256).digest()
    if fields.get("email"):
        message = "email:" + _normal(fields["email"])
    elif fields.get("name"):
        message = "name:" + _normal(fields["name"]) + "|org:" + (fields.get("organisation_id") or "")
    else:
        return None
    return hmac.new(index_key, message.encode(), hashlib.sha256).hexdigest()


# ---------- keys ----------


def find_person(conn: psycopg.Connection, fields: dict) -> str | None:
    """The id of an existing person with the same business email (or name and organisation), or None."""
    h = lookup_hash(fields)
    if h is None:
        return None
    row = conn.execute(
        "SELECT k.entity_id FROM person_key k JOIN entity e ON e.id = k.entity_id AND e.type = 'person' "
        "WHERE k.lookup_hash = %s ORDER BY k.created_at LIMIT 1", (h,),
    ).fetchone()
    return row["entity_id"] if row else None


def create_person(conn: psycopg.Connection, fields: dict) -> str:
    """A new person entity: the registry row and the wrapped data key. The caller writes the events."""
    entity_id = new_id()
    data_key = AESGCM.generate_key(bit_length=256)
    conn.execute("INSERT INTO entity (id, type) VALUES (%s, 'person')", (entity_id,))
    conn.execute(
        "INSERT INTO person_key (entity_id, wrapped_key, lookup_hash) VALUES (%s, %s, %s)",
        (entity_id, _wrap(data_key, entity_id), lookup_hash(fields)),
    )
    return entity_id


def data_key(conn: psycopg.Connection, entity_id: str) -> bytes | None:
    """The data key of a person, or None after erasure."""
    row = conn.execute("SELECT wrapped_key FROM person_key WHERE entity_id = %s", (entity_id,)).fetchone()
    if row is None:
        return None
    return _unwrap(row["wrapped_key"], entity_id)


def is_person(conn: psycopg.Connection, entity_id: str) -> bool:
    return conn.execute("SELECT 1 FROM entity WHERE id = %s AND type = 'person'", (entity_id,)).fetchone() is not None


def is_erased(conn: psycopg.Connection, entity_id: str) -> bool:
    return conn.execute("SELECT 1 FROM person_key WHERE entity_id = %s", (entity_id,)).fetchone() is None


# ---------- fields ----------


def encrypt(conn: psycopg.Connection, entity_id: str, fields: dict) -> dict:
    """The encrypted blob of the personal fields. Only the fields of config/personal-data.yaml go in."""
    key = data_key(conn, entity_id)
    if key is None:
        raise PersonalDataError(f"person {entity_id} is erased")
    clear = {f: fields.get(f) for f in encrypted_fields()}
    nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, json.dumps(clear, sort_keys=True).encode(), _aad(entity_id, "person-fields"))
    return {"v": 1, "alg": ALG, "entity_id": entity_id, "nonce": base64.b64encode(nonce).decode(),
            "ct": base64.b64encode(ct).decode()}


def decrypt(conn: psycopg.Connection, entity_id: str, blob: dict | None, key: bytes | None = None) -> dict | None:
    """The personal fields, or None when the person is erased (the key is gone) or the blob is missing."""
    if not blob:
        return None
    key = key if key is not None else data_key(conn, entity_id)
    if key is None:
        return None
    try:
        clear = AESGCM(key).decrypt(base64.b64decode(blob["nonce"]), base64.b64decode(blob["ct"]),
                                    _aad(entity_id, "person-fields"))
    except (InvalidTag, KeyError, ValueError) as exc:
        raise PersonalDataError(f"the personal fields of {entity_id} do not decrypt") from exc
    return json.loads(clear)


def reader_view(conn: psycopg.Connection, entity_id: str, blob: dict | None) -> dict:
    """The personal fields for a reader: the clear values, or the erased placeholders."""
    fields = decrypt(conn, entity_id, blob) if blob else None
    if fields is None:
        erased = is_erased(conn, entity_id)
        out = {f: None for f in encrypted_fields()}
        if erased:
            out["name"] = policy()["erased_name"]
        return {**out, "erased": erased}
    return {**{f: fields.get(f) for f in encrypted_fields()}, "erased": False}


# ---------- erasure ----------


def erase(conn: psycopg.Connection, entity_id: str, *, user_id: str, reason: str) -> dict:
    """Delete the key of a person. Writes a security_log record and a PersonErased event. The caller commits."""
    if not is_person(conn, entity_id):
        raise LookupError(f"no person {entity_id}")
    if not reason or not reason.strip():
        raise PersonalDataError("an erasure needs a reason")
    deleted = conn.execute("DELETE FROM person_key WHERE entity_id = %s RETURNING entity_id", (entity_id,)).fetchone()
    if deleted is None:
        raise PersonalDataError(f"person {entity_id} is already erased")
    log_id = new_id()
    conn.execute(
        "INSERT INTO security_log (id, user_id, action, detail) VALUES (%s, %s, 'erasure', %s)",
        (log_id, user_id, Jsonb({"entity_id": entity_id, "reason": reason.strip(), "method": "key_deleted"})),
    )
    event = append_event(
        conn, stream_type="entity", stream_id=entity_id, event_type="PersonErased",
        payload={"security_log_id": log_id, "method": "key_deleted"}, actor_type="human", actor_id=user_id,
    )
    return {"entity_id": entity_id, "security_log_id": log_id, "event_id": event["id"], "status": "erased"}
