from __future__ import annotations

import json
import re
from typing import Any

from google import genai
from google.genai import types

from app.core.config import get_settings

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


def generate_daily_ai_insights(daily_report: dict[str, Any]) -> dict[str, Any]:
    """Ask Gemini for narrative insights from a daily report dict."""
    settings = get_settings()
    if not settings.gemini_configured:
        return _fallback_insights(daily_report, reason="AI is not configured on the server.")

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
        return _normalize(parsed, daily_report)
    except Exception as exc:  # noqa: BLE001
        return _fallback_insights(daily_report, reason=f"AI insights unavailable ({exc}).")


def compact_report(daily: dict[str, Any]) -> dict[str, Any]:
    """Compact day facts suitable for Gemini and for archived day_debriefs.facts_json."""
    nutrition = daily.get("nutrition") or {}
    glucose = daily.get("glucose") or {}
    activity = daily.get("activity") or {}
    return {
        "date": daily.get("date"),
        "meals": nutrition.get("mealCount"),
        "macros": nutrition.get("macros"),
        "glucose": {
            "avgMgDl": glucose.get("avgMgDl"),
            "timeInRangePct": glucose.get("timeInRangePct"),
            "lowCount": glucose.get("lowCount"),
            "highCount": glucose.get("highCount"),
            "readingCount": glucose.get("readingCount"),
            "hypoEventCount": glucose.get("hypoEventCount"),
            "hypoEvents": glucose.get("hypoEvents") or [],
            "minMgDl": glucose.get("minMgDl"),
        },
        "activity": {
            "steps": activity.get("steps") if activity else 0,
            "energyScore": activity.get("energyScore") if activity else None,
            "caloriesBurned": activity.get("caloriesBurned") if activity else None,
            "workouts": activity.get("workouts") if activity else [],
            "source": activity.get("source") if activity else None,
        },
        "careVisits": daily.get("careVisits") or [],
        "sportMatches": daily.get("sportMatches") or [],
        "injuries": daily.get("injuries") or [],
        "weight": daily.get("weight"),
        "calorieTargets": daily.get("calorieTargets"),
        "calorieBalance": daily.get("calorieBalance"),
        "ruleInsights": daily.get("insights") or [],
        "warnings": daily.get("warnings") or [],
    }


def _compact_report(daily: dict[str, Any]) -> dict[str, Any]:
    return compact_report(daily)


def _normalize(parsed: dict[str, Any], daily: dict[str, Any]) -> dict[str, Any]:
    highlights = [str(x).strip() for x in (parsed.get("highlights") or []) if str(x).strip()]
    watchouts = [str(x).strip() for x in (parsed.get("watchouts") or []) if str(x).strip()]
    tips = [str(x).strip() for x in (parsed.get("tomorrowTips") or []) if str(x).strip()]
    headline = str(parsed.get("headline") or "").strip() or f"Day overview · {daily.get('date')}"
    summary = str(parsed.get("summary") or "").strip()
    if not summary:
        summary = " ".join(daily.get("insights") or []) or "No detailed summary available."
    if not highlights:
        highlights = list(daily.get("insights") or [])[:5]
    return {
        "headline": headline,
        "summary": summary,
        "highlights": highlights[:8],
        "watchouts": watchouts[:6],
        "tomorrowTips": tips[:6],
        "source": "gemini",
    }


def _fallback_insights(daily: dict[str, Any], *, reason: str) -> dict[str, Any]:
    insights = list(daily.get("insights") or [])
    warnings = daily.get("warnings") or []
    return {
        "headline": f"Day overview · {daily.get('date')}",
        "summary": " ".join(insights[:3]) if insights else "Limited data logged for this day.",
        "highlights": insights[:6],
        "watchouts": [
            f"{w.get('title')}: {w.get('message')}" if isinstance(w, dict) else str(w)
            for w in warnings
        ][:4],
        "tomorrowTips": [
            "Log meals with the phone camera for better carb context.",
            "Open Activity and sync Samsung Health so steps appear in reports.",
        ],
        "source": "fallback",
        "note": reason,
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
