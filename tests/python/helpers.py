"""Helpers to create sources and verified evidence for tests."""

from __future__ import annotations

from services.common.ids import new_id, sha256_hex


def make_source(conn, text: str = "Kansanshi Mining plc started the S3 expansion.", **kw) -> dict:
    sid = new_id()
    row = conn.execute(
        "INSERT INTO source (id, type, url, title, publisher, licence_code, retention_policy, content_hash, metadata) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, jsonb_build_object('text', %s::text)) RETURNING *",
        (sid, kw.get("type", "manual"), kw.get("url", f"https://example.test/{sid}"), kw.get("title", text[:80]),
         kw.get("publisher", "Test"), kw.get("licence_code", "full"), kw.get("retention_policy", "full"),
         sha256_hex(text + sid), text),
    ).fetchone()
    return row


def make_evidence(conn, source: dict, text: str, quote: str, verified: bool = True) -> str:
    start = text.index(quote)
    eid = new_id()
    conn.execute(
        "INSERT INTO evidence (id, source_id, char_start, char_end, quote, quote_hash, verified, verified_at) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, CASE WHEN %s THEN now() END)",
        (eid, source["id"], start, start + len(quote), quote, sha256_hex(quote), verified, verified),
    )
    return eid
