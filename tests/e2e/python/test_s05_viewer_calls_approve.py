"""docs/09 scenario 5: a Viewer calls the approve endpoint. HTTP 403."""

from __future__ import annotations

from .stack import wait_proposals, wait_signal


def test_s05_a_viewer_calls_the_approve_endpoint_and_gets_403(api, acceptance):
    signal = wait_signal(api, "business/2026/09/kcm-plan-konkola-deep", q="Konkola Deep")
    proposals = wait_proposals(api, signal["source_id"], lambda ps: any(p["status"] == "pending" for p in ps),
                               what="a pending proposal of the Konkola Deep article")
    pending = next(p for p in proposals if p["status"] == "pending")
    for path, body in ((f"/api/proposals/{pending['id']}/approve", None),
                       (f"/api/proposals/{pending['id']}/edit-approve", {"events": [{"certainty": "stated"}]}),
                       (f"/api/proposals/{pending['id']}/reject", {"reason": "viewer"})):
        r = api.post(path, "viewer", body)
        assert r.status_code == 403, (path, r.status_code, r.text)
    assert api.ok(f"/api/proposals/{pending['id']}")["status"] == "pending"
