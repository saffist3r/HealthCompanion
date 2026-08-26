from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from app.services.gemini_insights import compact_report
from app.services.reports import build_weekly_report, to_date_key


def rolling_date_keys(*, end_date: str | None = None, days: int = 7) -> tuple[str, str, list[str]]:
    end = datetime.strptime(end_date or to_date_key(datetime.now()), "%Y-%m-%d")
    span = max(1, min(int(days), 14))
    keys = [(end - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(span - 1, -1, -1)]
    return keys[0], keys[-1], keys


def build_life_assessment_context(daily_days: list[dict[str, Any]]) -> dict[str, Any]:
    if not daily_days:
        raise ValueError("No daily data for life assessment")
    period_start = daily_days[0]["date"]
    period_end = daily_days[-1]["date"]
    weekly = build_weekly_report(week_start=period_start, week_end=period_end, days=daily_days)
    return {
        "periodStart": period_start,
        "periodEnd": period_end,
        "dayCount": len(daily_days),
        "days": [compact_report(d) for d in daily_days],
        "totals": weekly.get("totals") or {},
        "weeklyInsights": weekly.get("insights") or [],
        "hypoEvents": weekly.get("hypoEvents") or [],
        "workouts": weekly.get("workouts") or [],
        "careVisits": weekly.get("careVisits") or [],
        "sportMatches": weekly.get("sportMatches") or [],
        "stressLogs": weekly.get("stressLogs") or [],
        "dayCheckIns": weekly.get("dayCheckIns") or [],
        "caffeineLogs": weekly.get("caffeineLogs") or [],
    }
