from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone


def test_live_view_shows_current_reading_trend_and_today(client) -> None:
    from app.core.database import SessionLocal
    from app.models import Device, GlucoseSample, PumpLogEvent
    from app.services.live_view import build_live_view

    now = datetime.now(tz=timezone.utc)
    device = f"live-{uuid.uuid4().hex[:8]}"
    db = SessionLocal()
    try:
        db.add(Device(id=device))
        for i, v in enumerate([120, 132, 144, 156]):
            db.add(GlucoseSample(
                id=str(uuid.uuid4()), device_id=device, value=v, unit="mg/dL",
                timestamp=now - timedelta(minutes=5 * (3 - i)),
            ))
        db.add(PumpLogEvent(
            id=str(uuid.uuid4()), device_id=device, kind="insulin_delivered", units=4.5,
            timestamp=now - timedelta(minutes=20),
        ))
        db.commit()
        view = build_live_view(db, [device], now=now)
    finally:
        db.close()

    assert view["current"]["mgDl"] == 156
    assert view["insight"]["arrow"] in ("singleUp", "fortyFiveUp", "doubleUp")
    assert view["insight"]["isStale"] is False
    assert view["insight"]["minutesToHigh"] is not None
    assert [r["mgDl"] for r in view["readings"]] == [120, 132, 144, 156]
    assert view["lastInsulin"]["units"] == 4.5
    assert view["today"]["insulinU"] >= 4.5


def test_live_link_roundtrip(client, auth_headers) -> None:
    share = client.post("/api/live/shares", json={"label": "Wife"}, headers=auth_headers).json()
    assert share["url"].endswith(f"/live/{share['token']}")
    assert share["expiresAt"] is None

    res = client.get(f"/api/live/view/{share['token']}")
    assert res.status_code == 200
    assert res.headers["cache-control"] == "no-store"
    view = res.json()
    assert view["share"]["label"] == "Wife"
    assert "displayName" in view["patient"]
    assert {"current", "insight", "readings", "today", "targets"} <= view.keys()


def test_revoked_live_link_stops_working(client, auth_headers) -> None:
    share = client.post("/api/live/shares", json={}, headers=auth_headers).json()
    assert client.get(f"/api/live/view/{share['token']}").status_code == 200
    assert client.delete(f"/api/live/shares/{share['token']}", headers=auth_headers).status_code == 200
    assert client.get(f"/api/live/view/{share['token']}").status_code == 404


def test_unknown_live_link_is_404_and_shares_need_auth(client) -> None:
    assert client.get("/api/live/view/not-a-real-token").status_code == 404
    assert client.get("/api/live/shares").status_code == 401
    assert client.post("/api/live/shares", json={}).status_code == 401


def test_live_link_with_expiry(client, auth_headers) -> None:
    share = client.post("/api/live/shares", json={"ttlDays": 30}, headers=auth_headers).json()
    assert share["expiresAt"] is not None
    listed = client.get("/api/live/shares", headers=auth_headers).json()
    assert any(s["token"] == share["token"] for s in listed)
