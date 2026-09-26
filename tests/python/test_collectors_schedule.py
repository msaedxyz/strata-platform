"""docs/04-ingestion.md criterion 12: daily sources run each day and weekly sources run each Monday,
in the Africa/Lusaka time zone. Fixed times, no real clock."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from services.collectors.schedule import cron_for, is_due, next_fire, previous_fire

LUSAKA = ZoneInfo("Africa/Lusaka")
UTC = ZoneInfo("UTC")


def lusaka(*args) -> datetime:
    return datetime(*args, tzinfo=LUSAKA)


def test_c04_12_schedule_mapping_comes_from_configuration():
    from services.collectors.text import collectors_config

    cfg = collectors_config()
    assert cfg["timezone"] == "Africa/Lusaka"
    assert cron_for("daily") == cfg["schedules"]["daily"]
    assert cron_for("weekly") == cfg["schedules"]["weekly"]
    assert cron_for("30 7 * * 3") == "30 7 * * 3"


def test_c04_12_daily_sources_run_each_day_in_lusaka():
    # 2026-09-28 is a Monday. Each day of one week has exactly one due point for a daily source.
    last = lusaka(2026, 9, 27, 23, 0)
    runs = []
    t = lusaka(2026, 9, 28, 0, 0)
    while t < lusaka(2026, 10, 5, 0, 0):
        if is_due("daily", last, t):
            runs.append(t)
            last = t
        t += timedelta(minutes=1)
    assert [r.date().isoformat() for r in runs] == [f"2026-{d}" for d in
                                                     ("09-28", "09-29", "09-30", "10-01", "10-02", "10-03", "10-04")]
    assert all(r.hour == 5 and r.minute == 0 for r in runs)


def test_c04_12_weekly_sources_run_each_monday_in_lusaka():
    last = lusaka(2026, 9, 21, 5, 0)  # Monday
    runs = []
    t = lusaka(2026, 9, 21, 5, 1)
    while t < lusaka(2026, 10, 13, 0, 0):
        if is_due("weekly", last, t):
            runs.append(t)
            last = t
        t += timedelta(minutes=15)
    assert [r.date().isoformat() for r in runs] == ["2026-09-28", "2026-10-05", "2026-10-12"]
    assert all(r.weekday() == 0 for r in runs)


def test_c04_12_weekly_uses_the_lusaka_monday_not_the_utc_monday():
    """Monday 00:30 in Lusaka is Sunday 22:30 UTC. A cron at 00:30 Monday runs then, not 24 hours later."""
    cron = "30 0 * * 1"
    last = datetime(2026, 9, 21, 0, 0, tzinfo=UTC)
    sunday_utc = datetime(2026, 9, 27, 22, 31, tzinfo=UTC)  # Monday 00:31 in Lusaka
    assert sunday_utc.astimezone(LUSAKA).weekday() == 0
    assert is_due(cron, last, sunday_utc)
    assert not is_due(cron, last, datetime(2026, 9, 27, 22, 29, tzinfo=UTC))
    assert previous_fire(cron, sunday_utc) == lusaka(2026, 9, 28, 0, 30)


def test_c04_12_daily_is_not_due_twice_on_the_same_day():
    ran = lusaka(2026, 9, 28, 5, 0, 20)
    assert not is_due("daily", ran, lusaka(2026, 9, 28, 23, 59))
    assert is_due("daily", ran, lusaka(2026, 9, 29, 5, 0))
    assert next_fire("daily", ran) == lusaka(2026, 9, 29, 5, 0)
    assert next_fire("weekly", ran) == lusaka(2026, 10, 5, 5, 0)


def test_c04_12_a_source_that_never_ran_is_due_now():
    assert is_due("weekly", None, lusaka(2026, 9, 30, 12, 0))


@pytest.mark.db
def test_c04_12_dispatcher_defers_one_job_for_each_due_source(fresh_db, cdb, fixture_server):
    from services.collectors.brief import active_brief, brief_sources
    from services.collectors.schedule import dispatch_due, due_sources
    from services.common.ids import new_id
    from services.queue import defer_collect

    from .collector_support import activate_fixture_brief

    activate_fixture_brief(cdb, fixture_server)
    brief = active_brief(cdb)
    all_ids = {s.id for s in brief_sources(brief["content"])}
    tuesday = lusaka(2026, 9, 29, 6, 0)
    assert set(due_sources(cdb, tuesday)) == all_ids  # nothing ran yet
    # Every source ran on Monday after 05:00. On Tuesday 06:00 the daily sources are due, the weekly source is not.
    for sid in all_ids:
        cdb.execute("INSERT INTO collector_run (id, brief_version_id, brief_source_id, status, started_at) "
                    "VALUES (%s, %s, %s, 'success', %s)", (new_id(), brief["id"], sid, lusaka(2026, 9, 28, 5, 1)))
    cdb.commit()
    due = set(due_sources(cdb, tuesday))
    assert "fx_web_lumwana" not in due
    assert due == all_ids - {"fx_web_lumwana"}
    deferred = dispatch_due(cdb, tuesday, lambda sid, delay: defer_collect(sid, delay) is not None)
    assert set(deferred) == due
    # A second dispatch in the next minute does not defer the waiting jobs again (queueing lock).
    assert dispatch_due(cdb, tuesday + timedelta(minutes=1), lambda sid, d: defer_collect(sid, d) is not None) == []
    jobs = cdb.execute("SELECT task_name, args, scheduled_at FROM public.procrastinate_jobs "
                       "WHERE task_name = 'collect_source'").fetchall()
    assert {j["args"]["brief_source_id"] for j in jobs} == due
    for j in jobs:  # jitter of up to 60 seconds
        if j["scheduled_at"] is not None:
            assert j["scheduled_at"] <= datetime.now(UTC) + timedelta(seconds=61)
