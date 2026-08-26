from __future__ import annotations

import json
import logging
import re
from typing import Any

from google import genai
from google.genai import types

from app.core.config import get_settings
from app.schemas import WorkoutExercise, WorkoutPlanDraft
from app.services.gemini_retry import (
    is_transient_gemini_error,
    model_candidates,
    with_gemini_retries,
)

logger = logging.getLogger(__name__)

SYSTEM = """You are a fitness assistant for someone living with Type 1 diabetes.
Suggest a practical workout plan based on recent activity, sport sessions, and any open injuries.

Rules:
- Never give medical advice, insulin dosing, or physiotherapy diagnosis.
- If open injuries are listed, avoid aggravating those areas and suggest safer alternatives.
- Prefer clear, gym-friendly exercises with sets/reps or duration.
- Keep the plan realistic for one session (typically 30–60 minutes unless the user asks otherwise).
- Respond with JSON only matching this schema:
{
  "title": string,
  "focus": string,
  "durationMin": number,
  "summary": string,
  "disclaimer": string,
  "exercises": [
    {
      "name": string,
      "sets": number | null,
      "reps": string | null,
      "durationMin": number | null,
      "restSec": number | null,
      "targetArea": string | null,
      "notes": string | null
    }
  ]
}"""


def generate_workout_plan(context: dict[str, Any]) -> WorkoutPlanDraft:
    settings = get_settings()
    if not settings.gemini_configured:
        raise RuntimeError("GEMINI_API_KEY is not configured on the server")

    client = genai.Client(api_key=settings.gemini_api_key)
    user_bits = [
        "Build a workout plan for today based on this context (JSON):",
        json.dumps(context, ensure_ascii=False),
    ]
    if context.get("userNote"):
        user_bits.append(f"User preference: {context['userNote']}")

    contents = [
        types.Content(
            role="user",
            parts=[types.Part.from_text(text=SYSTEM + "\n\n" + "\n".join(user_bits))],
        )
    ]
    config = types.GenerateContentConfig(
        temperature=0.35,
        response_mime_type="application/json",
    )

    last_err: BaseException | None = None
    response = None
    for model in model_candidates(settings.gemini_model):
        try:
            response = with_gemini_retries(
                f"workout-generate:{model}",
                lambda m=model: client.models.generate_content(
                    model=m,
                    contents=contents,
                    config=config,
                ),
                attempts=4,
                base_delay_s=1.2,
            )
            if model != settings.gemini_model:
                logger.info("Workout generate succeeded with fallback model %s", model)
            break
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            if is_transient_gemini_error(exc):
                logger.warning("Workout generate model %s overloaded: %s — trying next", model, exc)
                continue
            msg = str(exc).lower()
            if "404" in msg or "not found" in msg or "no longer available" in msg:
                logger.warning("Workout generate model %s unavailable: %s — trying next", model, exc)
                continue
            raise
    if response is None:
        assert last_err is not None
        raise last_err

    raw = (response.text or "{}").strip()
    parsed = _parse_json(raw)
    exercises = [_normalize_exercise(e) for e in (parsed.get("exercises") or [])]
    if not exercises:
        raise RuntimeError("Gemini returned no exercises")

    return WorkoutPlanDraft(
        title=str(parsed.get("title") or "Workout plan")[:120],
        focus=(str(parsed["focus"])[:120] if parsed.get("focus") else None),
        durationMin=_num(parsed.get("durationMin")),
        summary=str(parsed.get("summary") or "Suggested session based on your recent activity.")[:500],
        exercises=exercises[:12],
        basedOn=context.get("basedOnSummary"),
        disclaimer=str(parsed.get("disclaimer") or "Not medical advice. Adjust for how you feel today.")[:300],
    )


def _parse_json(raw: str) -> dict[str, Any]:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", raw)
        if not match:
            raise RuntimeError("Gemini returned invalid JSON")
        return json.loads(match.group(0))


def _num(v: Any) -> int | None:
    if isinstance(v, (int, float)) and v == v and v > 0:
        return int(round(v))
    return None


def _normalize_exercise(item: dict[str, Any]) -> WorkoutExercise:
    sets = item.get("sets")
    sets_i = int(sets) if isinstance(sets, (int, float)) and sets > 0 else None
    dur = _num(item.get("durationMin"))
    rest = item.get("restSec")
    rest_i = int(rest) if isinstance(rest, (int, float)) and rest >= 0 else None
    return WorkoutExercise(
        name=str(item.get("name") or "Exercise")[:120],
        sets=sets_i,
        reps=(str(item["reps"])[:40] if item.get("reps") else None),
        durationMin=dur,
        restSec=rest_i,
        targetArea=(str(item["targetArea"])[:80] if item.get("targetArea") else None),
        notes=(str(item["notes"])[:200] if item.get("notes") else None),
    )
