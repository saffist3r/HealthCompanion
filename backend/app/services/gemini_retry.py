"""Shared retry / transient-error helpers for Gemini API calls."""

from __future__ import annotations

import logging
import time
from typing import Callable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Vision / text models to try when the primary alias is overloaded.
MEAL_MODEL_FALLBACKS = (
    "gemini-3.6-flash",
    "gemini-3-flash-preview",
    "gemini-flash-lite-latest",
    "gemini-flash-latest",
)


def is_transient_gemini_error(exc: BaseException) -> bool:
    text = f"{type(exc).__name__} {exc}".lower()
    markers = (
        "503",
        "429",
        "unavailable",
        "high demand",
        "resource_exhausted",
        "resource exhausted",
        "temporarily",
        "try again",
        "deadline exceeded",
        "overloaded",
    )
    return any(m in text for m in markers)


def with_gemini_retries(
    label: str,
    fn: Callable[[], T],
    *,
    attempts: int = 5,
    base_delay_s: float = 1.5,
) -> T:
    """Retry transient Gemini overload / quota spikes before failing."""
    last: BaseException | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            last = exc
            if not is_transient_gemini_error(exc) or i >= attempts - 1:
                raise
            delay = base_delay_s * (2**i)
            logger.warning(
                "%s transient Gemini error (attempt %s/%s): %s — retry in %.1fs",
                label,
                i + 1,
                attempts,
                exc,
                delay,
            )
            time.sleep(delay)
    assert last is not None
    raise last


def model_candidates(primary: str, fallbacks: tuple[str, ...] = MEAL_MODEL_FALLBACKS) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for m in (primary, *fallbacks):
        name = (m or "").strip()
        if name and name not in seen:
            seen.add(name)
            out.append(name)
    return out
