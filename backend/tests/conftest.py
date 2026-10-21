from __future__ import annotations

import hashlib
import os
import secrets
import tempfile
from pathlib import Path

# Configure the app before anything imports app.core.config (settings are cached).
_TMP = Path(tempfile.mkdtemp(prefix="hc-tests-"))
_INTEGRATION_KEY = "hc_test_" + secrets.token_hex(16)
os.environ.update(
    {
        "DATABASE_URL": f"sqlite:///{_TMP / 'test.db'}",
        "UPLOAD_DIR": str(_TMP / "uploads"),
        "JWT_SECRET": "test-secret-" + "x" * 40,
        "ADMIN_EMAIL": "admin@example.com",
        "ADMIN_PASSWORD": "admin-password",
        "GEMINI_API_KEY": "",
        "CORS_ORIGINS": "http://localhost:5173",
        "API_DOCS_ENABLED": "false",
        "TEST_INTEGRATION_KEY": _INTEGRATION_KEY,
        "INTEGRATION_KEYS": f"agents-hub:{hashlib.sha256(_INTEGRATION_KEY.encode()).hexdigest()}",
    }
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.services import login_throttle  # noqa: E402

ADMIN = {"email": "admin@example.com", "password": "admin-password"}
DEVICE_HEADERS = {"X-Device-Id": "test-device-0001"}


@pytest.fixture(scope="session")
def client() -> TestClient:
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_throttle() -> None:
    login_throttle.reset()


@pytest.fixture
def auth_headers(client: TestClient) -> dict[str, str]:
    res = client.post("/api/auth/login", json=ADMIN, headers=DEVICE_HEADERS)
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['accessToken']}", **DEVICE_HEADERS}


@pytest.fixture
def upload_dir() -> Path:
    path = Path(os.environ["UPLOAD_DIR"]).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path
