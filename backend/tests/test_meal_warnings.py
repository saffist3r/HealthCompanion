from __future__ import annotations

from app.schemas import FoodItem, Macros
from app.services.warnings import (
    estimate_calories_kcal,
    evaluate_meal_warnings,
    resolved_calories_kcal,
    sum_macros,
)


def codes(macros: Macros, **kw) -> set[str]:
    return {w.code for w in evaluate_meal_warnings(macros, **kw)}


def test_balanced_meal_has_no_warnings() -> None:
    assert codes(Macros(carbsG=30, proteinG=25, fatG=10, fiberG=8)) == set()


def test_high_and_very_high_carb_thresholds() -> None:
    assert "high_carb_meal" in codes(Macros(carbsG=45, proteinG=20, fiberG=8))
    very = codes(Macros(carbsG=75, proteinG=20, fiberG=8))
    assert "very_high_carb_meal" in very
    assert "high_carb_meal" not in very


def test_low_fiber_and_missing_protein() -> None:
    out = codes(Macros(carbsG=50, proteinG=5, fiberG=1))
    assert {"low_fiber_high_carb", "missing_protein"} <= out


def test_late_meal_and_glucose_context() -> None:
    assert "late_large_meal" in codes(Macros(carbsG=50, proteinG=20, fiberG=8), hour_local=22)
    assert "glucose_high_with_meal" in codes(Macros(carbsG=30, proteinG=20, fiberG=8), glucose_mg_dl=200)
    assert "glucose_low_with_meal" in codes(Macros(carbsG=10, proteinG=20), glucose_mg_dl=60)


def test_resucrage_skips_carb_cautions() -> None:
    out = evaluate_meal_warnings(Macros(carbsG=90), meal_type="resucrage", glucose_mg_dl=55)
    assert [w.code for w in out] == ["glucose_low_with_meal"]
    assert out[0].severity == "info"
    assert evaluate_meal_warnings(Macros(carbsG=90), meal_type="resucrage") == []


def test_custom_carb_thresholds() -> None:
    assert "high_carb_meal" in codes(Macros(carbsG=30, proteinG=20, fiberG=8), high_carb=25, very_high_carb=60)


def test_calorie_estimates() -> None:
    assert estimate_calories_kcal(10, 10, 10) == 170
    assert resolved_calories_kcal(Macros(carbsG=10, proteinG=10, fatG=10, caloriesKcal=0)) == 170
    assert resolved_calories_kcal({"carbsG": 10, "caloriesKcal": 250}) == 250


def test_sum_macros() -> None:
    items = [
        FoodItem(name="rice", macros=Macros(carbsG=40.04, proteinG=4, fatG=1)),
        FoodItem(name="chicken", macros=Macros(proteinG=30, fatG=5, caloriesKcal=200)),
    ]
    total = sum_macros(items)
    assert total.carbsG == 40.0
    assert total.proteinG == 34
    assert total.caloriesKcal == round(estimate_calories_kcal(40.04, 4, 1)) + 200
