"""Load the fixture data into a running stack. `make fixtures` runs this in the api container.

1. Store and activate the fixture brief (tests/fixtures/brief-fixture.yaml) as a new brief version.
2. Run every collector once against the fixture server (STRATA_FIXTURE_BASE_URL, default http://localhost:8765).
3. Activate the previous brief again.
"""

from __future__ import annotations

import json
import sys

from services.collectors.brief import activate, active_brief, create_version_from_yaml
from services.collectors.runner import run_all
from services.common.db import connect
from services.common.logging import setup_logging
from services.common.settings import get_settings
from tests.fixtures.server import fixture_brief_text

ACTOR = "scripts.load_fixtures"


def main() -> int:
    setup_logging()
    base_url = get_settings().fixture_base_url.rstrip("/")
    with connect() as conn:
        previous = active_brief(conn)
        fixture, _created = create_version_from_yaml(
            conn, fixture_brief_text(base_url), created_by=ACTOR, change_note=f"Fixture brief for {base_url}"
        )
        activate(conn, fixture["id"], actor_type="system", actor_id=ACTOR)
        conn.commit()
        try:
            results = run_all(conn, google_news_base_url=f"{base_url}/rss/search")
        finally:
            if previous is not None:
                activate(conn, previous["id"], actor_type="system", actor_id=ACTOR)
                conn.commit()
    summary = [{"source": r.brief_source_id, "status": r.status, "found": r.found, "new": r.new,
                "error": r.error} for r in results]
    print(json.dumps({"fixture_brief_version": fixture["version"], "runs": summary}, indent=2))
    return 0 if all(r.status == "success" for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
