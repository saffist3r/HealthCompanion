from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.services import login_throttle
from app.services.upload_urls import signed_upload_url, verify_upload_signature

from .conftest import ADMIN, DEVICE_HEADERS


@pytest.mark.parametrize(
    "secret, ok",
    [
        ("", False),
        ("change-me-in-production", False),
        ("CHANGE_ME_LONG_RANDOM", False),
        ("short-secret", False),
        ("a" * 32, True),
    ],
)
def test_jwt_secret_validation(secret: str, ok: bool) -> None:
    problem = Settings(jwt_secret=secret, _env_file=None).jwt_secret_problem
    assert (problem is None) is ok


def test_cors_only_allows_configured_origins(client: TestClient) -> None:
    allowed = client.options(
        "/api/health",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:5173"
    denied = client.options(
        "/api/health",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in denied.headers


def test_upload_signature_roundtrip() -> None:
    url = signed_upload_url("meal.jpg", now=1000)
    assert url and url.startswith("/api/uploads/meal.jpg?exp=")
    exp = int(url.split("exp=")[1].split("&")[0])
    sig = url.split("sig=")[1]
    assert verify_upload_signature("meal.jpg", exp, sig, now=1000)
    assert not verify_upload_signature("other.jpg", exp, sig, now=1000)
    assert not verify_upload_signature("meal.jpg", exp, sig, now=exp + 1)
    assert signed_upload_url(None) is None


def test_uploads_require_valid_signature(client: TestClient, upload_dir) -> None:
    (upload_dir / "photo.jpg").write_bytes(b"\xff\xd8\xff fake jpeg")
    assert client.get("/api/uploads/photo.jpg").status_code == 422
    assert client.get("/api/uploads/photo.jpg?exp=9999999999&sig=bad").status_code == 403
    expired = int(time.time()) - 10
    url = signed_upload_url("photo.jpg", now=expired - 7 * 86400 - 60)
    assert client.get(url).status_code == 403
    ok = client.get(signed_upload_url("photo.jpg"))
    assert ok.status_code == 200
    assert ok.content.startswith(b"\xff\xd8\xff")
    assert client.get(signed_upload_url("missing.jpg")).status_code == 404


def test_uploads_reject_path_traversal(client: TestClient) -> None:
    url = signed_upload_url("../test.db")
    assert client.get(url).status_code in (403, 404)


def test_login_and_api_prefix(client: TestClient, auth_headers: dict) -> None:
    assert client.get("/api/auth/me", headers=auth_headers).json()["email"] == ADMIN["email"]
    # Legacy root path stays available for older phone builds.
    assert client.get("/auth/me", headers=auth_headers).status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    health = client.get("/api/health").json()
    assert health["ok"] is True
    assert "openaiConfigured" not in health


def test_failed_logins_are_throttled(client: TestClient, monkeypatch) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "login_max_failures", 3)
    bad = {"email": ADMIN["email"], "password": "wrong-password"}
    for _ in range(3):
        assert client.post("/api/auth/login", json=bad, headers=DEVICE_HEADERS).status_code == 401
    blocked = client.post("/api/auth/login", json=ADMIN, headers=DEVICE_HEADERS)
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0
    login_throttle.reset()
    assert client.post("/api/auth/login", json=ADMIN, headers=DEVICE_HEADERS).status_code == 200


def test_throttle_window_expires(monkeypatch) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "login_max_failures", 2)
    monkeypatch.setattr(get_settings(), "login_window_seconds", 60)
    for _ in range(2):
        login_throttle.record_failure("x@y.z", "1.2.3.4", now=0)
    assert login_throttle.retry_after_seconds("x@y.z", None, now=1) is not None
    assert login_throttle.retry_after_seconds("other@y.z", "1.2.3.4", now=1) is not None
    assert login_throttle.retry_after_seconds("x@y.z", "1.2.3.4", now=61) is None


def test_meal_photo_upload_keeps_only_image_extensions(client: TestClient, auth_headers, upload_dir, monkeypatch) -> None:
    from app.routers import meals
    from app.schemas import Macros, MealAnalysisResult

    monkeypatch.setattr(
        meals, "analyze_meal_photo", lambda **_: MealAnalysisResult(items=[], macros=Macros(), summary="", carbEstimateNote="")
    )
    res = client.post(
        "/api/meals/analyze",
        files={"photo": ("evil.html", b"<script>alert(1)</script>", "text/html")},
        headers=auth_headers,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["photoPath"].endswith(".jpg")
    assert body["photoUrl"].startswith("/api/uploads/")
    assert "sig=" in body["photoUrl"]


def test_startup_refuses_placeholder_jwt_secret(client: TestClient, monkeypatch) -> None:
    from app.main import app, settings

    monkeypatch.setattr(settings, "jwt_secret", "change-me-in-production")
    with pytest.raises(RuntimeError, match="placeholder"), TestClient(app):
        pass
