from __future__ import annotations

from fastapi import HTTPException


def http_exc_from_gemini(exc: Exception) -> HTTPException:
    msg = str(exc)
    lower = msg.lower()
    if "429" in msg or "resource_exhausted" in lower or "quota" in lower:
        return HTTPException(
            status_code=429,
            detail="AI is rate-limited right now. Wait a minute and try again.",
        )
    if (
        "503" in msg
        or "unavailable" in lower
        or "high demand" in lower
        or "overloaded" in lower
        or "try again" in lower
    ):
        return HTTPException(
            status_code=503,
            detail="AI is busy right now. Wait a few seconds and try again.",
        )
    if "api key" in lower or "not configured" in lower:
        return HTTPException(status_code=503, detail=msg)
    return HTTPException(status_code=500, detail=msg)
