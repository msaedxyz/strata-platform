"""Identifiers and hashes."""

from __future__ import annotations

import hashlib

from ulid import ULID


def new_id() -> str:
    return str(ULID())


def sha256_hex(text: str | bytes) -> str:
    data = text.encode("utf-8") if isinstance(text, str) else text
    return hashlib.sha256(data).hexdigest()
