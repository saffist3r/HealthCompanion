from __future__ import annotations

import json
import logging
import re
from typing import Any

from google import genai
from google.genai import types

from app.core.config import get_settings
from app.i18n.report_strings import (
    ai_language_instruction,
    fallback_strings,
    normalize_locale,
)

SYSTEM = """You are a health companion coach for someone living with diabetes.
Given one day's structured health data (nutrition, glucose, activity from Samsung Health,
care visits, sport matches), write a clear, encouraging daily report.

Rules:
- Never give medical advice, insulin dosing, or diagnosis.
- Be specific to the numbers provided; do not invent readings.
- Prefer practical lifestyle observations (meals timing, carbs load, steps, readiness).
- Keep language warm and direct, not clinical jargon-heavy.
- Respond with JSON only matching this schema:
{
  "headline": string,          // one short line summarizing the day
  "summary": string,           // 2-4 sentences overview
  "highlights": string[],      // 3-6 concrete positives or notable facts
  "watchouts": string[],       // 0-4 gentle cautions (carbs, low TIR, inactivity…)
  "tomorrowTips": string[]     // 2-4 actionable tips for tomorrow
}
"""

logger = logging.getLogger(__name__)


def generate_daily_ai_insights(
    daily_report: dict[str, Any],
    *,
    locale: str | None = "en",
) -> dict[str, Any]:
    """Ask Gemini for narrative insights from a daily report dict."""
    loc = normalize_locale(locale)
    settings = get_settings()
    fb = fallback_strings(loc)
    if not settings.gemini_configured:
        return _fallback_insights(daily_report, reason=fb["ai_missing"], locale=loc)

    payload = compact_report(daily_report)
    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_text(
                            text=SYSTEM
                            + "\n\n"
                            + ai_language_instruction(loc)
                            + "\n\nDay data (JSON):\n"
                            + json.dumps(payload, ensure_ascii=False)
                        )
                    ],
                )
            ],
            config=types.GenerateContentConfig(
                temperature=0.35,
                response_mime_type="application/json",
            ),
        )
        raw = (response.text or "{}").strip()
        parsed = _parse_json(raw)
        return _normalize(parsed, daily_report, locale=loc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Daily insights fell back to rule-based summary: %s", exc)
        return _fallback_insights(
            daily_report,
            reason=fb["ai_unavailable"].format(exc=exc),
            locale=loc,
        )

def compact_report(daily: dict[str, Any]) -> dict[str, Any]:
    """Compact day facts suitable for Gemini and for archived day_debriefs.facts_json."""
    nutrition = daily.get("nutrition") or {}
    glucose = daily.get("glucose") or {}
    activity = daily.get("activity") or {}
    readings = glucose.get("readings") or []
    return {
        "date": daily.get("date"),
        "meals": nutrition.get("mealCount"),
        "macros": nutrition.get("macros"),
        "glucose": {
            "avgMgDl": glucose.get("avgMgDl"),
            "minMgDl": glucose.get("minMgDl"),
            "maxMgDl": glucose.get("maxMgDl"),
            "timeInRangePct": glucose.get("timeInRangePct"),
            "lowCount": glucose.get("lowCount"),
            "highCount": glucose.get("highCount"),
            "readingCount": glucose.get("readingCount"),
            "hypoEventCount": glucose.get("hypoEventCount"),
            "hypoEvents": glucose.get("hypoEvents") or [],
            "hyperEventCount": glucose.get("hyperEventCount"),
            "hyperEvents": glucose.get("hyperEvents") or [],
            "readings": _downsample_readings(readings, max_points=96),
            "overnight": daily.get("overnight"),
        },
        "activity": {
            "steps": activity.get("steps") if activity else 0,
            "energyScore": activity.get("energyScore") if activity else None,
            "caloriesBurned": activity.get("caloriesBurned") if activity else None,
            "workouts": activity.get("workouts") if activity else [],
            "source": activity.get("source") if activity else None,
        },
        "workoutPlans": daily.get("workoutPlans") or [],
        "careVisits": daily.get("careVisits") or [],
        "sportMatches": daily.get("sportMatches") or [],
        "injuries": daily.get("injuries") or [],
        "dayCheckIn": daily.get("dayCheckIn"),
        "caffeineLogs": daily.get("caffeineLogs") or [],
        "weight": daily.get("weight"),
        "calorieTargets": daily.get("calorieTargets"),
        "calorieBalance": daily.get("calorieBalance"),
        "ruleInsights": daily.get("insights") or [],
        "warnings": daily.get("warnings") or [],
    }


def _downsample_readings(readings: list[Any], *, max_points: int = 96) -> list[dict[str, Any]]:
    if not readings or len(readings) <= max_points:
        return [
            {"timestamp": int(r.get("timestamp") or 0), "mgDl": float(r.get("mgDl") or 0)}
            for r in readings
            if isinstance(r, dict)
        ]
    step = max(1, len(readings) // max_points)
    out: list[dict[str, Any]] = []
    for i, r in enumerate(readings):
        if i % step == 0 and isinstance(r, dict):
            out.append({"timestamp": int(r.get("timestamp") or 0), "mgDl": float(r.get("mgDl") or 0)})
    if readings and isinstance(readings[-1], dict):
        last = {"timestamp": int(readings[-1].get("timestamp") or 0), "mgDl": float(readings[-1].get("mgDl") or 0)}
        if not out or out[-1]["timestamp"] != last["timestamp"]:
            out.append(last)
    return out[:max_points]



def _compact_report(daily: dict[str, Any]) -> dict[str, Any]:
    return compact_report(daily)


def _normalize(parsed: dict[str, Any], daily: dict[str, Any], *, locale: str = "en") -> dict[str, Any]:
    fb = fallback_strings(locale)
    highlights = [str(x).strip() for x in (parsed.get("highlights") or []) if str(x).strip()]
    watchouts = [str(x).strip() for x in (parsed.get("watchouts") or []) if str(x).strip()]
    tips = [str(x).strip() for x in (parsed.get("tomorrowTips") or []) if str(x).strip()]
    headline = str(parsed.get("headline") or "").strip() or fb["headline"].format(
        date=daily.get("date")
    )
    summary = str(parsed.get("summary") or "").strip()
    if not summary:
        summary = " ".join(daily.get("insights") or []) or fb["no_summary"]
    if not highlights:
        highlights = list(daily.get("insights") or [])[:5]
    return {
        "headline": headline,
        "summary": summary,
        "highlights": highlights[:8],
        "watchouts": watchouts[:6],
        "tomorrowTips": tips[:6],
        "source": "gemini",
        "locale": normalize_locale(locale),
    }


def _fallback_insights(
    daily: dict[str, Any], *, reason: str, locale: str = "en"
) -> dict[str, Any]:
    fb = fallback_strings(locale)
    insights = list(daily.get("insights") or [])
    warnings = daily.get("warnings") or []
    return {
        "headline": fb["headline"].format(date=daily.get("date")),
        "summary": " ".join(insights[:3]) if insights else fb["summary_empty"],
        "highlights": insights[:6],
        "watchouts": [
            f"{w.get('title')}: {w.get('message')}" if isinstance(w, dict) else str(w)
            for w in warnings
        ][:4],
        "tomorrowTips": [fb["tip1"], fb["tip2"]],
        "source": "fallback",
        "note": reason,
        "locale": normalize_locale(locale),
    }


def _parse_json(raw: str) -> dict[str, Any]:
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", raw)
        if not match:
            return {}
        try:
            data = json.loads(match.group(0))
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}
