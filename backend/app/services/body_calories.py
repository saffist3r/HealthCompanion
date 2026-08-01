"""Body composition & calorie targets (Mifflin–St Jeor)."""

from __future__ import annotations

from typing import Any, Literal

ActivityLabel = Literal["sedentary", "light", "moderate", "active", "very_active"]

ACTIVITY_FACTORS: dict[str, float] = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "very_active": 1.9,
}


def bmi(weight_kg: float, height_cm: float) -> float:
    if height_cm <= 0:
        return 0.0
    m = height_cm / 100.0
    return round(weight_kg / (m * m), 1)


def mifflin_st_jeor_bmr(*, weight_kg: float, height_cm: float, age_years: int, sex: str) -> float:
    """Resting metabolic rate (kcal/day)."""
    base = 10.0 * weight_kg + 6.25 * height_cm - 5.0 * age_years
    if (sex or "male").lower().startswith("f"):
        return round(base - 161.0)
    return round(base + 5.0)


def resolve_activity_factor(activity: str | float | None) -> float:
    if isinstance(activity, (int, float)) and activity > 0:
        return float(activity)
    key = str(activity or "light").lower().strip()
    return ACTIVITY_FACTORS.get(key, ACTIVITY_FACTORS["light"])


def calorie_targets(
    *,
    weight_kg: float,
    height_cm: float,
    age_years: int,
    sex: str = "male",
    activity: str | float = "light",
    deficit_kcal: float = 500,
) -> dict[str, Any]:
    """
    Maintenance = BMR × activity factor (TDEE).
    Deficit target = maintenance − deficit_kcal (default 500 ≈ ~0.5 kg/week).
    """
    bmr = mifflin_st_jeor_bmr(
        weight_kg=weight_kg, height_cm=height_cm, age_years=age_years, sex=sex
    )
    factor = resolve_activity_factor(activity)
    maintenance = round(bmr * factor)
    deficit = round(max(0.0, float(deficit_kcal)))
    target = max(1200, maintenance - deficit)  # floor for safety messaging
    return {
        "weightKg": round(weight_kg, 1),
        "heightCm": round(height_cm, 1),
        "ageYears": int(age_years),
        "sex": "female" if str(sex).lower().startswith("f") else "male",
        "bmi": bmi(weight_kg, height_cm),
        "bmrKcal": bmr,
        "activityFactor": factor,
        "maintenanceKcal": maintenance,
        "deficitKcal": deficit,
        "targetKcal": target,
        "formula": "Mifflin–St Jeor",
    }


def intake_vs_targets(intake_kcal: float, targets: dict[str, Any] | None) -> dict[str, Any] | None:
    if not targets:
        return None
    intake = round(float(intake_kcal or 0))
    maintenance = int(targets.get("maintenanceKcal") or 0)
    target = int(targets.get("targetKcal") or 0)
    return {
        "intakeKcal": intake,
        "maintenanceKcal": maintenance,
        "targetKcal": target,
        "vsMaintenance": intake - maintenance,
        "vsTarget": intake - target,
        "remainingToTarget": target - intake,
        "onTrack": intake <= target + 50 if target else None,
    }
