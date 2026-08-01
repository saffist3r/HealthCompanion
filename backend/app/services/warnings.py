from __future__ import annotations

from app.schemas import DiabetesWarning, FoodItem, Macros


def estimate_calories_kcal(carbs_g: float, protein_g: float, fat_g: float) -> float:
    return round(carbs_g * 4 + protein_g * 4 + fat_g * 9)


def resolved_calories_kcal(m: Macros | dict) -> float:
    if isinstance(m, dict):
        stored = m.get("caloriesKcal")
        carbs = float(m.get("carbsG") or 0)
        protein = float(m.get("proteinG") or 0)
        fat = float(m.get("fatG") or 0)
    else:
        stored = m.caloriesKcal
        carbs = float(m.carbsG or 0)
        protein = float(m.proteinG or 0)
        fat = float(m.fatG or 0)
    if isinstance(stored, (int, float)) and stored > 0:
        return float(round(stored))
    return float(estimate_calories_kcal(carbs, protein, fat))


def sum_macros(items: list[FoodItem]) -> Macros:
    acc = Macros()
    for item in items:
        m = item.macros
        acc.carbsG = _r(acc.carbsG + (m.carbsG or 0))
        acc.proteinG = _r(acc.proteinG + (m.proteinG or 0))
        acc.fatG = _r(acc.fatG + (m.fatG or 0))
        acc.fiberG = _r((acc.fiberG or 0) + (m.fiberG or 0))
        acc.caloriesKcal = _r((acc.caloriesKcal or 0) + resolved_calories_kcal(m))
        acc.sugarG = _r((acc.sugarG or 0) + (m.sugarG or 0))
    return acc


def evaluate_meal_warnings(
    macros: Macros,
    *,
    hour_local: int | None = None,
    glucose_mg_dl: float | None = None,
    high_carb: float = 45.0,
    very_high_carb: float = 75.0,
    meal_type: str | None = None,
) -> list[DiabetesWarning]:
    warnings: list[DiabetesWarning] = []
    hour = hour_local if hour_local is not None else 12
    bg = glucose_mg_dl
    is_rescue = (meal_type or "").lower() == "resucrage"

    if is_rescue:
        # Resucrage is intentional carbs for hypo treatment — skip "too many carbs" cautions.
        if bg is not None and bg < 70:
            warnings.append(
                DiabetesWarning(
                    code="glucose_low_with_meal",
                    severity="info",
                    title="Resucrage while low",
                    message="Treating hypoglycemia — recheck glucose after ~15 minutes per your plan.",
                )
            )
        return warnings

    if macros.carbsG >= very_high_carb:
        warnings.append(
            DiabetesWarning(
                code="very_high_carb_meal",
                severity="alert",
                title="Very high carbs",
                message=(
                    f"This meal is ~{macros.carbsG}g carbs. Consider splitting the portion, "
                    "adding fiber/protein, or adjusting insulin with your care team’s guidance."
                ),
            )
        )
    elif macros.carbsG >= high_carb:
        warnings.append(
            DiabetesWarning(
                code="high_carb_meal",
                severity="caution",
                title="High carb meal",
                message=f"About {macros.carbsG}g carbs — watch your glucose trend for the next 2–3 hours.",
            )
        )

    if macros.carbsG >= high_carb and (macros.fiberG or 0) < 5:
        warnings.append(
            DiabetesWarning(
                code="low_fiber_high_carb",
                severity="caution",
                title="Low fiber with high carbs",
                message="Adding vegetables or whole grains may slow the glucose rise.",
            )
        )

    if macros.proteinG < 10 and macros.carbsG >= 30:
        warnings.append(
            DiabetesWarning(
                code="missing_protein",
                severity="info",
                title="Little protein",
                message="Protein can help blunt post-meal spikes when paired with carbs.",
            )
        )

    if hour >= 21 and macros.carbsG >= high_carb:
        warnings.append(
            DiabetesWarning(
                code="late_large_meal",
                severity="caution",
                title="Late large meal",
                message="Large carb meals late at night can raise overnight glucose.",
            )
        )

    if bg is not None and bg >= 180 and macros.carbsG >= 30:
        warnings.append(
            DiabetesWarning(
                code="glucose_high_with_meal",
                severity="alert",
                title="Glucose already high",
                message=(
                    f"Current glucose ~{round(bg)} mg/dL with a carb-containing meal — "
                    "consider checking again soon."
                ),
            )
        )

    if bg is not None and bg < 70:
        warnings.append(
            DiabetesWarning(
                code="glucose_low_with_meal",
                severity="alert",
                title="Glucose is low",
                message="Treat hypoglycemia per your plan before focusing on meal macros.",
            )
        )

    return warnings


def _r(n: float) -> float:
    return round(n * 10) / 10
