from __future__ import annotations

import pytest

LIST_ENDPOINTS = [
    "/api/health-data/activity",
    "/api/health-data/care-visits",
    "/api/health-data/sport-matches",
    "/api/health-data/stress-logs",
    "/api/health-data/day-checkins",
    "/api/health-data/caffeine-logs",
    "/api/health-data/body-profile",
    "/api/health-data/weight",
    "/api/health-data/injuries",
    "/api/health-data/workouts",
    "/api/glucose/history",
    "/api/meals",
    "/api/reports/dashboard",
]


@pytest.mark.parametrize("path", LIST_ENDPOINTS)
def test_read_endpoints_respond(client, auth_headers, path: str) -> None:
    res = client.get(path, headers=auth_headers)
    assert res.status_code == 200, f"{path}: {res.status_code} {res.text[:300]}"


def test_care_visit_roundtrip(client, auth_headers) -> None:
    created = client.post(
        "/api/health-data/care-visits",
        json={"date": "2026-01-02", "kind": "kine", "notes": "knee"},
        headers=auth_headers,
    )
    assert created.status_code == 200, created.text
    listed = client.get("/api/health-data/care-visits", headers=auth_headers).json()
    assert any(v.get("notes") == "knee" for v in listed["careVisits"]), listed
