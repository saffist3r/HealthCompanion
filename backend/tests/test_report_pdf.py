"""The daily report PDF renders (guards reportlab upgrades; no Gemini key in tests)."""

from __future__ import annotations

import time
from datetime import datetime, timezone

import pytest


@pytest.fixture
def seeded_day(client, auth_headers) -> str:
    now = int(time.time() * 1000)
    readings = [
        {"value": v, "unit": "mg/dL", "timestamp": now - (40 - i) * 5 * 60_000}
        for i, v in enumerate([110, 125, 160, 210, 190, 150, 120, 95, 80, 66, 72, 100] * 3 + [130] * 4)
    ]
    assert client.post("/api/glucose/sync", json={"readings": readings}, headers=auth_headers).status_code == 200
    macros = {"carbsG": 60, "proteinG": 25, "fatG": 15, "caloriesKcal": 520}
    meal = {
        "eatenAt": now - 3 * 3_600_000,
        "mealType": "lunch",
        "items": [{"name": "Couscous", "portion": "1 plate", "macros": macros}],
        "macros": macros,
        "warnings": [],
        "source": "manual",
    }
    assert client.post("/api/meals", json=meal, headers=auth_headers).status_code == 201
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


@pytest.mark.parametrize("locale", ["en", "fr"])
def test_daily_report_pdf_renders(client, auth_headers, seeded_day, locale) -> None:
    client.put("/api/health-data/body-profile", json={"locale": locale}, headers=auth_headers)
    res = client.get(f"/api/reports/daily/pdf?date={seeded_day}", headers=auth_headers)
    assert res.status_code == 200, res.text[:300]
    assert res.headers["content-type"] == "application/pdf"
    body = res.content
    assert body.startswith(b"%PDF-") and body.rstrip().endswith(b"%%EOF")
    assert len(body) > 3_000
