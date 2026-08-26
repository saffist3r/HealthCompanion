from __future__ import annotations

import json
import logging
import re
from typing import Any

from google import genai
from google.genai import types

from app.core.config import get_settings
from app.schemas import FoodItem, Macros, MealAnalysisResult
from app.services.gemini_retry import (
    is_transient_gemini_error,
    model_candidates,
    with_gemini_retries,
)
from app.services.warnings import evaluate_meal_warnings, sum_macros

logger = logging.getLogger(__name__)

SYSTEM = """You are a nutrition assistant for people with diabetes.
Analyze a meal photo and estimate food items and macronutrients.
Be conservative with carb estimates when unsure — note uncertainty.
If the meal looks like a hypo treatment / quick sugar rescue (juice, glucose tabs, sweets taken alone), set mealTypeGuess to "resucrage".
Never give medical advice or insulin dosing; suggestions are lifestyle/nutrition only.
Respond with JSON only matching this schema:
{
  "items": [{"name": string, "portion": string, "macros": {"carbsG": number, "proteinG": number, "fatG": number, "fiberG": number, "caloriesKcal": number, "sugarG": number}, "confidence": number}],
  "mealTypeGuess": "breakfast"|"lunch"|"dinner"|"snack"|"resucrage"|"other",
  "summary": string,
  "carbEstimateNote": string,
  "suggestions": string[]
}"""


def analyze_meal_photo(
    *,
    image_bytes: bytes,
    mime_type: str,
    glucose_mg_dl: float | None = None,
    hour_local: int | None = None,
    notes: str | None = None,
) -> MealAnalysisResult:
    settings = get_settings()
    if not settings.gemini_configured:
        raise RuntimeError("GEMINI_API_KEY is not configured on the server")

    client = genai.Client(api_key=settings.gemini_api_key)
    user_bits = ["Estimate the meal in this photo."]
    if notes:
        user_bits.append(f"User notes: {notes}")
    if glucose_mg_dl is not None:
        user_bits.append(f"Latest glucose ~{round(glucose_mg_dl)} mg/dL")

    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(text=SYSTEM + "\n\n" + "\n".join(user_bits)),
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type or "image/jpeg"),
            ],
        )
    ]
    config = types.GenerateContentConfig(
        temperature=0.2,
        response_mime_type="application/json",
    )

    last_err: BaseException | None = None
    response = None
    for model in model_candidates(settings.gemini_model):
        try:
            response = with_gemini_retries(
                f"meal-analyze:{model}",
                lambda m=model: client.models.generate_content(
                    model=m,
                    contents=contents,
                    config=config,
                ),
                attempts=4,
                base_delay_s=1.2,
            )
            if model != settings.gemini_model:
                logger.info("Meal analyze succeeded with fallback model %s", model)
            break
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            if is_transient_gemini_error(exc):
                logger.warning("Meal analyze model %s overloaded: %s — trying next", model, exc)
                continue
            # Non-transient (e.g. 404 deprecated model): try next candidate
            msg = str(exc).lower()
            if "404" in msg or "not found" in msg or "no longer available" in msg:
                logger.warning("Meal analyze model %s unavailable: %s — trying next", model, exc)
                continue
            raise
    if response is None:
        assert last_err is not None
        raise last_err

    raw = (response.text or "{}").strip()
    parsed = _parse_json(raw)
    items = [_normalize_item(i) for i in (parsed.get("items") or [])]
    macros = sum_macros(items)
    warnings = evaluate_meal_warnings(
        macros,
        hour_local=hour_local,
        glucose_mg_dl=glucose_mg_dl,
        high_carb=settings.high_meal_carb_g,
        very_high_carb=settings.very_high_meal_carb_g,
    )

    return MealAnalysisResult(
        items=items,
        macros=macros,
        mealTypeGuess=parsed.get("mealTypeGuess"),
        summary=parsed.get("summary") or "Meal analyzed.",
        carbEstimateNote=parsed.get("carbEstimateNote")
        or f"Estimated ~{macros.carbsG}g carbohydrates. Photo estimates can be off by 20–40%.",
        suggestions=list(parsed.get("suggestions") or [])[:6],
        warnings=warnings,
    )


def _parse_json(raw: str) -> dict[str, Any]:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", raw)
        if not match:
            raise RuntimeError("Gemini returned invalid JSON")
        return json.loads(match.group(0))


def _normalize_item(item: dict[str, Any]) -> FoodItem:
    macros = item.get("macros") or {}
    conf = item.get("confidence")
    return FoodItem(
        name=str(item.get("name") or "Food")[:120],
        portion=(str(item["portion"])[:80] if item.get("portion") else None),
        confidence=min(1.0, max(0.0, float(conf))) if isinstance(conf, (int, float)) else None,
        macros=_normalize_macros(macros),
    )


def _normalize_macros(m: dict[str, Any]) -> Macros:
    def n(key: str) -> float:
        v = m.get(key)
        return float(v) if isinstance(v, (int, float)) and v == v else 0.0

    carbs = max(0.0, n("carbsG"))
    protein = max(0.0, n("proteinG"))
    fat = max(0.0, n("fatG"))
    kcal = max(0.0, n("caloriesKcal"))
    if kcal <= 0 and (carbs or protein or fat):
        kcal = carbs * 4 + protein * 4 + fat * 9

    return Macros(
        carbsG=carbs,
        proteinG=protein,
        fatG=fat,
        fiberG=max(0.0, n("fiberG")),
        caloriesKcal=kcal,
        sugarG=max(0.0, n("sugarG")),
    )
