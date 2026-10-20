"""In-memory throttle for failed logins.

Counts failures per email and per client IP inside a sliding window. State is
per process, so with N uvicorn workers the effective limit is up to N times
LOGIN_MAX_FAILURES — still enough to make password guessing impractical.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from app.core.config import get_settings

_lock = threading.Lock()
_failures: dict[str, deque[float]] = defaultdict(deque)


def _keys(email: str, ip: str | None) -> list[str]:
    keys = [f"email:{email}"]
    if ip:
        keys.append(f"ip:{ip}")
    return keys


def _prune(bucket: deque[float], cutoff: float) -> None:
    while bucket and bucket[0] < cutoff:
        bucket.popleft()


def retry_after_seconds(email: str, ip: str | None, *, now: float | None = None) -> int | None:
    """Seconds until another attempt is allowed, or None when not throttled."""
    settings = get_settings()
    now = now if now is not None else time.monotonic()
    cutoff = now - settings.login_window_seconds
    wait = None
    with _lock:
        for key in _keys(email, ip):
            bucket = _failures.get(key)
            if not bucket:
                continue
            _prune(bucket, cutoff)
            if len(bucket) >= settings.login_max_failures:
                remaining = int(bucket[0] - cutoff) + 1
                wait = max(wait or 0, remaining)
    return wait


def record_failure(email: str, ip: str | None, *, now: float | None = None) -> None:
    now = now if now is not None else time.monotonic()
    with _lock:
        for key in _keys(email, ip):
            _failures[key].append(now)


def record_success(email: str) -> None:
    with _lock:
        _failures.pop(f"email:{email}", None)


def reset() -> None:
    with _lock:
        _failures.clear()
