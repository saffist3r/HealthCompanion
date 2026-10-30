from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.core.database import SessionLocal
from app.models import Device, Meal, PumpLogEvent, SportMatch
from app.services import watchouts as w

PARIS = ZoneInfo("Europe/Paris")


def _device(db) -> str:
    device = f"wo-{uuid.uuid4().hex[:8]}"
    db.add(Device(id=device))
    return device


def test_sport_today_warns_for_tonight_with_the_users_pattern(client, monkeypatch) -> None:
    monkeypatch.setattr(w, "_patterns", lambda *a: {"sportNightHypo": {"hits": 7, "nights": 7, "otherHits": 0, "otherNights": 8}})
    now = datetime(2026, 10, 20, 17, 0, tzinfo=PARIS)
    db = SessionLocal()
    try:
        device = _device(db)
        db.add(SportMatch(id=str(uuid.uuid4()), device_id=device, date="2026-10-20", time="15:00",
                          sport="padel", result="completed", duration_min=70))
        db.commit()
        out = w.build_watchouts(db, [device], now=now.astimezone(timezone.utc))
    finally:
        db.close()
    sport = next(x for x in out if x["kind"] == "sport")
    assert sport["id"] == "sport-night-2026-10-20"
    assert "7 of 7" in sport["body"] or "7 nuits sur 7" in sport["body"]
    fire = datetime.fromtimestamp(sport["fireAt"] / 1000, tz=PARIS)
    assert (fire.hour, fire.minute) == (21, 30)


def test_meal_without_bolus_nudges_and_a_bolus_silences_it(client, monkeypatch) -> None:
    monkeypatch.setattr(w, "_patterns", lambda *a: {})
    now = datetime(2026, 10, 20, 13, 0, tzinfo=timezone.utc)
    db = SessionLocal()
    try:
        device = _device(db)
        meal_id = str(uuid.uuid4())
        db.add(Meal(id=meal_id, device_id=device, eaten_at=now - timedelta(minutes=20), meal_type="lunch",
                    macros_json='{"carbsG": 60}'))
        db.commit()
        out = w.build_watchouts(db, [device], now=now)
        assert [x["id"] for x in out] == [f"bolus-{meal_id}"]
        db.add(PumpLogEvent(id=str(uuid.uuid4()), device_id=device, kind="insulin_delivered", units=6,
                            timestamp=now - timedelta(minutes=5)))
        db.commit()
        assert w.build_watchouts(db, [device], now=now) == []
    finally:
        db.close()


def test_watchouts_endpoint_needs_auth(client, auth_headers) -> None:
    assert client.get("/api/insights/watchouts").status_code == 401
    res = client.get("/api/insights/watchouts", headers=auth_headers)
    assert res.status_code == 200 and "watchouts" in res.json()
