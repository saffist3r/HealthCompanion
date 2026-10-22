"""Signed, expiring URLs for files in UPLOAD_DIR (meal photos).

Browsers and React Native <Image> cannot attach a Bearer header, so photo URLs
carry an HMAC signature instead of being served as public static files.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from urllib.parse import quote

from app.core.config import get_settings

UPLOADS_PATH = "/api/uploads"


def _signature(filename: str, expires: int) -> str:
    key = get_settings().jwt_secret.encode("utf-8")
    msg = f"uploads:{filename}:{expires}".encode()
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


def signed_upload_url(filename: str | None, *, now: float | None = None) -> str | None:
    """Relative URL (``/api/uploads/<file>?exp=…&sig=…``) clients prefix with the API origin."""
    if not filename:
        return None
    ttl = get_settings().upload_url_ttl_minutes * 60
    expires = int((now if now is not None else time.time()) + ttl)
    return f"{UPLOADS_PATH}/{quote(filename)}?exp={expires}&sig={_signature(filename, expires)}"


def verify_upload_signature(filename: str, expires: int, sig: str, *, now: float | None = None) -> bool:
    if expires < (now if now is not None else time.time()):
        return False
    return hmac.compare_digest(_signature(filename, expires), sig or "")
