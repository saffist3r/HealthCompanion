from __future__ import annotations

import json
import logging
import re
from typing import Any

from google import genai
from google.genai import types

from app.core.config import get_settings
from app.i18n.report_strings import ai_language_instruction, normalize_locale
from app.services.gemini_retry import model_candidates, with_gemini_retries

logger = logging.getLogger(__name__)

SYSTEM = """You are a direct, compassionate life coach reviewing someone's last week of health tracking.
They live with Type 1 diabetes. You receive structured data: glucose/CGM, meals & macros, steps & workouts,
sport matches, care visits, injuries, stress logs, mood/ADHD check-ins, caffeine, pump events.

Write an honest assessment — not harsh, not sugar-coated. Name what is going well AND what is slipping.
Connect patterns across days (sleep/mood vs glucose, stress vs eating, activity gaps, caffeine, sport load).

Rules:
- Never give medical advice, insulin dosing, or diagnosis.
- Only use facts from the JSON; do not invent data.
- Be specific with numbers when they matter (TIR %, steps, hypo count, mood trends).
- If a domain has no data, say so briefly instead of guessing.
- Respond with JSON only:
{
  "headline": string,
  "honestSummary": string,
  "wins": string[],
  "concerns": string[],
  "patterns": string[],
  "priorities": string[],
  "glucoseVerdict": string,
  "lifestyleVerdict": string,
  "moodVerdict": string
}

honestSummary: 3–5 short paragraphs, plain language, second person ("you").
wins/concerns: 3–6 bullets each. patterns: cross-day observations. priorities: 3–5 focus areas for next week.
Each verdict: one honest sentence on that domain."""


def generate_life_assessment(
    context: dict[str, Any],
    *,
    locale: str | None = "en",
) -> dict[str, Any]:
    loc = normalize_locale(locale)
    settings = get_settings()
    if not settings.gemini_configured:
        return _fallback(context, reason="Gemini is not configured", locale=loc)

    client = genai.Client(api_key=settings.gemini_api_key)
    prompt = (
        SYSTEM
        + "\n\n"
        + ai_language_instruction(loc)
        + "\n\nLast "
        + str(context.get("dayCount") or 7)
        + " days (JSON):\n"
        + json.dumps(context, ensure_ascii=False)
    )
    contents = [types.Content(role="user", parts=[types.Part.from_text(text=prompt)])]
    config = types.GenerateContentConfig(
        temperature=0.45,
        response_mime_type="application/json",
    )

    last_err: BaseException | None = None
    response = None
    for model in model_candidates(settings.gemini_model):
        try:
            response = with_gemini_retries(
                f"life-assessment:{model}",
                lambda m=model: client.models.generate_content(
                    model=m,
                    contents=contents,
                    config=config,
                ),
                attempts=4,
                base_delay_s=1.5,
            )
            if model != settings.gemini_model:
                logger.info("Life assessment succeeded with fallback model %s", model)
            break
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            logger.warning("Life assessment failed on %s: %s", model, exc)
    if response is None:
        return _fallback(context, reason=str(last_err or "Gemini unavailable"), locale=loc)

    parsed = _parse_json((response.text or "{}").strip())
    return _normalize(parsed, context, locale=loc)


def _normalize(parsed: dict[str, Any], context: dict[str, Any], *, locale: str) -> dict[str, Any]:
    def _list(key: str, limit: int = 8) -> list[str]:
        return [str(x).strip() for x in (parsed.get(key) or []) if str(x).strip()][:limit]

    period = f"{context.get('periodStart')} → {context.get('periodEnd')}"
    headline = str(parsed.get("headline") or "").strip() or f"Your last {context.get('dayCount', 7)} days · {period}"
    summary = str(parsed.get("honestSummary") or "").strip()
    if not summary:
        summary = " ".join(context.get("weeklyInsights") or []) or "Not enough tracked data for a full assessment yet."

    return {
        "headline": headline,
        "honestSummary": summary,
        "wins": _list("wins"),
        "concerns": _list("concerns"),
        "patterns": _list("patterns"),
        "priorities": _list("priorities", 6),
        "glucoseVerdict": str(parsed.get("glucoseVerdict") or "").strip(),
        "lifestyleVerdict": str(parsed.get("lifestyleVerdict") or "").strip(),
        "moodVerdict": str(parsed.get("moodVerdict") or "").strip(),
        "source": "gemini",
        "locale": locale,
    }


def _fallback(context: dict[str, Any], *, reason: str, locale: str) -> dict[str, Any]:
    totals = context.get("totals") or {}
    insights = list(context.get("weeklyInsights") or [])
    period = f"{context.get('periodStart')} → {context.get('periodEnd')}"
    return {
        "headline": f"Last {context.get('dayCount', 7)} days · {period}",
        "honestSummary": " ".join(insights[:4]) if insights else "Keep logging meals, glucose, and check-ins to unlock a richer review.",
        "wins": insights[:3],
        "concerns": [],
        "patterns": [],
        "priorities": ["Log consistently for 7 days", "Review glucose trends after meals and sport"],
        "glucoseVerdict": (
            f"Avg TIR ~{totals.get('avgTimeInRangePct')}%" if totals.get("avgTimeInRangePct") is not None else ""
        ),
        "lifestyleVerdict": (
            f"{totals.get('totalSteps', 0):,} steps · {totals.get('workoutCount', 0)} workouts"
            if totals.get("totalSteps") is not None
            else ""
        ),
        "moodVerdict": "",
        "source": "fallback",
        "locale": locale,
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
