"""Read-only machine access for trusted automations (e.g. the agents-hub night planner).

Callers authenticate with an integration key (`Authorization: Bearer <key>`), configured on the server as
SHA-256 hashes in INTEGRATION_KEYS. Keys are read-only and only reach the endpoints in this router.
The brief is deliberately minimal: summaries and events, no raw glucose curve, meals, photos, insulin data
or care-visit notes.
"""

from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import household_device_ids
from app.routers.reports import _load_daily

router = APIRouter(prefix="/integrations", tags=["integrations"])

PARIS = ZoneInfo("Europe/Paris")

# App insights that leak data this brief deliberately leaves out (insulin delivery, care visits).
_EXCLUDED_INSIGHT_PREFIXES = ("Pump log", "Care:")


def require_integration(authorization: str | None = Header(default=None)) -> str:
    """Return the integration name for a valid key, else 401. Constant-time compare against every hash."""
    auth = authorization or ""
    raw = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    if not raw:
        raise HTTPException(status_code=401, detail="Missing integration key")
    digest = hashlib.sha256(raw.encode()).hexdigest()
    found = None
    for pair in get_settings().integration_keys.split(","):
        name, _, stored = pair.strip().partition(":")
        stored = stored.strip().lower()
        if name and len(stored) == 64 and hmac.compare_digest(stored, digest):
            found = name
    if found is None:
        raise HTTPException(status_code=401, detail="Invalid integration key")
    return found


def _pick(d: dict[str, Any] | None, keys: tuple[str, ...]) -> dict[str, Any]:
    d = d or {}
    return {k: d.get(k) for k in keys if k in d}


def _event(e: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    out = _pick(e, keys)
    if e.get("startedAt"):
        out["startTime"] = datetime.fromtimestamp(e["startedAt"] / 1000, tz=PARIS).strftime("%H:%M")
    return out


def _day_brief(daily: dict[str, Any]) -> dict[str, Any]:
    glucose = daily.get("glucose") or {}
    activity = daily.get("activity") or {}
    return {
        "date": daily.get("date"),
        "glucose": {
            **_pick(
                glucose,
                (
                    "readingCount",
                    "avgMgDl",
                    "minMgDl",
                    "maxMgDl",
                    "timeInRangePct",
                    "lowCount",
                    "highCount",
                    "hypoEventCount",
                    "hyperEventCount",
                ),
            ),
            "hypoEvents": [
                _event(e, ("startedAt", "endedAt", "minMgDl", "durationMin"))
                for e in glucose.get("hypoEvents") or []
            ],
            "hyperEvents": [
                _event(e, ("startedAt", "endedAt", "maxMgDl", "durationMin"))
                for e in glucose.get("hyperEvents") or []
            ],
            "overnight": _pick(
                daily.get("overnight"),
                ("ready", "blurb", "minMgDl", "maxMgDl", "endMgDl", "dawnRiseMgDl"),
            ),
        },
        "activity": {
            **_pick(activity, ("steps", "activeMinutes", "caloriesBurned", "energyScore")),
            "workouts": [
                _pick(w, ("name", "durationMin", "calories"))
                for w in activity.get("workouts") or []
                if isinstance(w, dict)
            ],
        },
        "sportMatches": [
            _pick(m, ("sport", "time", "result", "score", "durationMin", "intensity"))
            for m in daily.get("sportMatches") or []
        ],
        "workoutPlans": [_pick(p, ("title", "focus", "durationMin")) for p in daily.get("workoutPlans") or []],
        "checkIn": _pick(
            daily.get("dayCheckIn"),
            ("moodLabel", "wakeQualityLabel", "focusLabel", "overwhelmLabel", "sleepHours"),
        )
        or None,
        "caffeine": [_pick(c, ("drinkLabel", "caffeineMg", "time")) for c in daily.get("caffeineLogs") or []],
        "calorieBalance": daily.get("calorieBalance"),
        "insights": [
            s
            for s in (daily.get("insights") or [])
            if isinstance(s, str) and not s.startswith(_EXCLUDED_INSIGHT_PREFIXES)
        ][:12],
    }


def _injuries(daily: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for inj in daily.get("injuries") or []:
        if inj.get("status") not in ("active", "healing"):
            continue
        today_pain = inj.get("todayPain") or {}
        latest_pain = inj.get("latestPain") or {}
        out.append(
            {
                "title": inj.get("title") or inj.get("injuryTypeLabel"),
                "type": inj.get("injuryTypeLabel"),
                "bodyArea": inj.get("bodyAreaLabel") or inj.get("bodyArea"),
                "status": inj.get("status"),
                "since": inj.get("startedOn"),
                "painToday": today_pain.get("painScore"),
                "latestPain": latest_pain.get("painScore"),
                "latestPainDate": latest_pain.get("date"),
                # Activities the user linked to this injury (sport, gym, kiné…) and their exercise guidance.
                "relatedActivities": inj.get("relatedActivityLabels") or [],
                "exerciseNotes": (inj.get("exerciseNotes") or "").strip()[:300] or None,
            }
        )
    return out


@router.get("/evening-brief")
def evening_brief(
    date: str | None = Query(None, description="Paris day to plan for (YYYY-MM-DD); default today"),
    integration: str = Depends(require_integration),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Yesterday's completed day + today so far, for planning tonight's activity and sleep."""
    today = (date or "").strip() or datetime.now(PARIS).strftime("%Y-%m-%d")
    try:
        yesterday = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD") from exc
    ids = household_device_ids(db)
    today_daily = _load_daily(db, ids, today)
    yesterday_daily = _load_daily(db, ids, yesterday)
    return {
        "today": today,
        "glucoseTargets": _pick(today_daily.get("glucoseTargets"), ("tirLowMgDl", "tirHighMgDl", "tirGoalPct")),
        "yesterday": _day_brief(yesterday_daily),
        "todaySoFar": _day_brief(today_daily),
        "injuries": _injuries(today_daily),
    }
