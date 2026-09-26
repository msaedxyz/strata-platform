"""docs/09 scenario 12: a SQL check counts canonical facts without verified evidence. The count is zero.

1. SQL (psql, read only, as postgres): count_facts_without_verified_evidence() from migration 0200. It finds fact
   events with no evidence, with evidence that does not exist or is not verified, with a wrong quote hash, or with a
   quote whose length differs from its span.
2. scripts/check_evidence.py in the api container adds the text check: each quote is the text at its offsets.
"""

from __future__ import annotations

import json


def test_s12_sql_check_counts_zero_canonical_facts_without_verified_evidence(compose, acceptance):
    facts = int(compose.scalar("SELECT count(*) FROM strata.event WHERE strata.event_needs_evidence(event_type)"))
    assert facts > 50, f"too few fact events to prove the check: {facts}"
    assert compose.scalar("SELECT strata.count_facts_without_verified_evidence()") == "0"
    result = compose.exec("api", "python", "scripts/check_evidence.py", check=False, timeout=900)
    report = json.loads(result.stdout[result.stdout.index("{"):])
    assert result.returncode == 0, report.get("problems", [])[:5]
    assert report["facts_without_verified_evidence"] == 0 and report["sql_count"] == 0
