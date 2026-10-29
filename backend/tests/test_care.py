from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.care_summary import glucose_metrics, hourly_profile


def _pts(values: list[float]) -> list[dict]:
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return [
        {"timestamp": int((t0 + timedelta(minutes=5 * i)).timestamp() * 1000), "mgDl": v}
        for i, v in enumerate(values)
    ]


def test_consensus_bands_split_every_reading() -> None:
    out = glucose_metrics(_pts([50, 60, 100, 180, 200, 300, 120, 140, 160, 181]))
    bands = out["bandsPct"]
    assert bands == {"veryLow": 10.0, "low": 10.0, "inRange": 50.0, "high": 20.0, "veryHigh": 10.0}
    assert out["meanMgDl"] == 149
    assert out["gmiPct"] == round(3.31 + 0.02392 * 149.1, 1)


def test_empty_glucose_has_no_metrics() -> None:
    assert glucose_metrics([])["bandsPct"] is None


def test_hourly_profile_has_24_hours() -> None:
    prof = hourly_profile(_pts([100] * 12))
    assert len(prof) == 24
    assert sum(h["n"] for h in prof) == 12


def test_share_lifecycle(client, auth_headers) -> None:
    res = client.post("/api/care/shares", json={"days": 14, "note": "Ask about nights"}, headers=auth_headers)
    assert res.status_code == 200, res.text
    share = res.json()
    assert share["url"].endswith(f"/care/{share['token']}")

    view = client.get(f"/api/care/view/{share['token']}")
    assert view.status_code == 200, view.text
    body = view.json()
    assert body["period"]["days"] == 14
    assert body["share"]["note"] == "Ask about nights"
    assert len(body["daily"]) >= 14

    assert client.get("/api/care/summary?days=30", headers=auth_headers).status_code == 200
    assert client.get("/api/care/summary?days=5", headers=auth_headers).status_code == 400
    assert client.get("/api/care/summary").status_code == 401

    assert client.delete(f"/api/care/shares/{share['token']}", headers=auth_headers).status_code == 200
    assert client.get(f"/api/care/view/{share['token']}").status_code == 404


def test_unknown_token_is_404(client) -> None:
    assert client.get("/api/care/view/nope").status_code == 404


def test_short_dips_are_not_hypo_events(client) -> None:
    from app.core.database import SessionLocal
    from app.models import GlucoseSample
    from app.services.care_summary import build_care_summary

    now = datetime.now(timezone.utc).replace(microsecond=0)
    db = SessionLocal()
    try:
        dev = "care-test-device"
        from app.models import Device

        db.merge(Device(id=dev))
        rows = [(-300, 65), (-200, 60), (-195, 58), (-190, 61), (-185, 90)]
        for i, (mins, v) in enumerate(rows):
            db.add(GlucoseSample(id=f"care-g-{i}", device_id=dev, value=v, unit="mg/dL", timestamp=now + timedelta(minutes=mins)))
        db.commit()
        out = build_care_summary(db, [dev], days=7, now=now)
        assert out["hypos"]["count"] == 1  # the lone 65 reading is noise, the 15-minute dip counts
        assert len(out["daily"]) == 7
    finally:
        db.close()
