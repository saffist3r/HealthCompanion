"""Integration-key auth and data minimisation for /integrations/evening-brief.

Run from backend/: python -m pytest tests/test_integrations.py
"""

from __future__ import annotations

import os
import unittest
import uuid
from datetime import datetime, timezone

# conftest.py sets DATABASE_URL, API_DOCS_ENABLED=false and INTEGRATION_KEYS from this key.
_KEY = os.environ["TEST_INTEGRATION_KEY"]

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Device, GlucoseSample, Injury, InjuryPainLog, Meal, PumpLogEvent  # noqa: E402

DAY = "2026-03-10"
URL = f"/integrations/evening-brief?date={DAY}"


def _utc(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 3, 10, hour, minute, tzinfo=timezone.utc)


def _keys(obj) -> set[str]:
    if isinstance(obj, dict):
        return set(obj) | {k for v in obj.values() for k in _keys(v)}
    if isinstance(obj, list):
        return {k for v in obj for k in _keys(v)}
    return set()


class EveningBriefTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        try:
            db.add(Device(id="dev-1"))
            db.flush()
            # Overnight + a hypo episode at 10:00 UTC.
            for h, m, v in (
                [(1, 0, 120), (2, 0, 110), (3, 0, 105), (8, 0, 150), (10, 0, 62), (10, 5, 58), (12, 0, 140)]
            ):
                db.add(GlucoseSample(id=str(uuid.uuid4()), device_id="dev-1", value=v, unit="mg/dL", timestamp=_utc(h, m)))
            db.add(
                Meal(
                    id=str(uuid.uuid4()),
                    device_id="dev-1",
                    eaten_at=_utc(12),
                    macros_json='{"caloriesKcal": 600, "carbsG": 70}',
                    notes="private meal note",
                )
            )
            db.add(
                PumpLogEvent(
                    id=str(uuid.uuid4()),
                    device_id="dev-1",
                    kind="insulin_delivered",
                    units=4.5,
                    timestamp=_utc(12, 5),
                )
            )
            injury_id = str(uuid.uuid4())
            db.add(
                Injury(
                    id=injury_id,
                    device_id="dev-1",
                    title="Padel knee",
                    injury_type="tendinitis",
                    body_area="knee_left",
                    started_on="2026-03-01",
                    status="active",
                    related_activity_kinds_json='["sport"]',
                    notes="private injury note",
                )
            )
            db.flush()
            db.add(InjuryPainLog(id=str(uuid.uuid4()), injury_id=injury_id, device_id="dev-1", date=DAY, pain_score=6))
            db.commit()
        finally:
            db.close()
        cls.client = TestClient(app)

    def test_missing_key_is_401(self) -> None:
        self.assertEqual(self.client.get(URL).status_code, 401)

    def test_wrong_key_is_401(self) -> None:
        for header in ("Bearer hc_wrong", "Bearer ", _KEY, f"Basic {_KEY}"):
            res = self.client.get(URL, headers={"Authorization": header})
            self.assertEqual(res.status_code, 401, header)

    def test_valid_key_returns_minimal_brief(self) -> None:
        res = self.client.get(URL, headers={"Authorization": f"Bearer {_KEY}"})
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()

        keys = _keys(body)
        for forbidden in ("readings", "meals", "pumpEvents", "notes", "careVisits", "photos", "agentPrompt"):
            self.assertNotIn(forbidden, keys)
        self.assertNotIn("private", res.text)
        self.assertNotIn("Pump log", res.text)

        today = body["todaySoFar"]
        self.assertEqual(body["today"], DAY)
        self.assertEqual(today["glucose"]["readingCount"], 7)
        self.assertEqual(len(today["glucose"]["hypoEvents"]), 1)
        self.assertEqual(today["glucose"]["hypoEvents"][0]["minMgDl"], 58)
        # SQLite drops tzinfo, so only the HH:MM shape is stable here.
        self.assertRegex(today["glucose"]["hypoEvents"][0]["startTime"], r"^\d{2}:\d{2}$")
        self.assertTrue(today["glucose"]["overnight"]["ready"])
        self.assertEqual(body["yesterday"]["date"], "2026-03-09")
        self.assertEqual(body["injuries"][0]["bodyArea"], "Left knee")
        self.assertEqual(body["injuries"][0]["painToday"], 6)
        self.assertEqual(body["injuries"][0]["relatedActivities"], ["Sport"])

    def test_api_docs_disabled(self) -> None:
        for path in ("/docs", "/redoc", "/openapi.json"):
            self.assertEqual(self.client.get(path).status_code, 404, path)

    def test_bad_date_is_400(self) -> None:
        res = self.client.get(
            "/integrations/evening-brief?date=nope", headers={"Authorization": f"Bearer {_KEY}"}
        )
        self.assertEqual(res.status_code, 400)


if __name__ == "__main__":
    unittest.main()
