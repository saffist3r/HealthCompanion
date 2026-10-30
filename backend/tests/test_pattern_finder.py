from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.core.database import SessionLocal
from app.models import Device, GlucoseSample, SportMatch
from app.services.pattern_finder import find_patterns

PARIS = ZoneInfo("Europe/Paris")
DAYS = 21


def _seed(night_hypo_after_sport: bool) -> tuple[str, datetime]:
    """Three weeks of 5-minute readings around 130; padel every other evening."""
    device = f"pat-{uuid.uuid4().hex[:8]}"
    first = datetime(2026, 9, 1, tzinfo=PARIS)
    end = first + timedelta(days=DAYS)
    db = SessionLocal()
    try:
        db.add(Device(id=device))
        sport_days = set()
        for d in range(DAYS):
            day = first + timedelta(days=d)
            if d % 2 == 0:
                sport_days.add(day.date())
                db.add(SportMatch(id=str(uuid.uuid4()), device_id=device, date=day.strftime("%Y-%m-%d"),
                                  time="18:00", sport="padel", result="completed", duration_min=70))
        t = first
        while t < end:
            local = t.astimezone(PARIS)
            value = 130.0
            prev_day = (local - timedelta(days=1)).date()
            if night_hypo_after_sport and prev_day in sport_days and local.hour == 3 and local.minute < 30:
                value = 60.0
            db.add(GlucoseSample(id=str(uuid.uuid4()), device_id=device, value=value, unit="mg/dL",
                                 timestamp=t.astimezone(timezone.utc)))
            t += timedelta(minutes=5)
        db.commit()
    finally:
        db.close()
    return device, end.astimezone(timezone.utc)


def test_spots_night_hypos_after_sport(client) -> None:
    device, end = _seed(night_hypo_after_sport=True)
    db = SessionLocal()
    try:
        out = find_patterns(db, [device], now=end, days=DAYS)
    finally:
        db.close()
    codes = [p["code"] for p in out["patterns"]]
    assert "sportNightHypo" in codes
    p = next(p for p in out["patterns"] if p["code"] == "sportNightHypo")
    assert p["params"]["hits"] == p["params"]["nights"] >= 9
    assert p["params"]["otherHits"] == 0


def test_steady_data_reports_no_patterns(client) -> None:
    device, end = _seed(night_hypo_after_sport=False)
    db = SessionLocal()
    try:
        out = find_patterns(db, [device], now=end, days=DAYS)
    finally:
        db.close()
    assert out["patterns"] == []
    assert out["daysWithData"] >= 20
