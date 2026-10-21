"""Deterministic diabetes pattern digests for the Understanding page.

Rule thresholds + ranked evidence (no statistical engine). Feeds Gemini synthesis.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Any

from sqlalchemy.orm import Session

from app.models import Meal, PumpLogEvent, StressLog
from app.services.diabetes_insights import (
    _carbs,
    _combine_dt,
    _readings_between,
    _tir_bounds,
    _story_blurb,
)
from app.services.gemini_insights import compact_report
from app.services.reports import build_weekly_report, to_date_key

BOLUS_KIND = "insulin_delivered"
BOLUS_PAD_MIN = 90
LATE_BOLUS_MIN = 15
EARLY_BOLUS_MIN = -20  # bolus more than 20 min before eat
HIGH_PEAK_PER_CARB = 2.5  # mg/dL rise per gram carbs (rough heuristic)
HIGH_DELTA_MG = 80.0
SLOW_RETURN_MIN = 150
STRESS_HIGH_SCORE = 60
STRESS_FOLLOW_HOURS = 3.0


def understanding_date_keys(*, end_date: str | None = None, days: int = 14) -> tuple[str, str, list[str]]:
    end = datetime.strptime(end_date or to_date_key(datetime.now()), "%Y-%m-%d")
    span = max(1, min(int(days), 30))
    keys = [(end - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(span - 1, -1, -1)]
    return keys[0], keys[-1], keys


def build_understanding_signals(
    db: Session,
    *,
    device_ids: list[str],
    daily_days: list[dict[str, Any]],
) -> dict[str, Any]:
    if not daily_days:
        raise ValueError("No daily data for understanding signals")

    period_start = daily_days[0]["date"]
    period_end = daily_days[-1]["date"]
    weekly = build_weekly_report(week_start=period_start, week_end=period_end, days=daily_days)
    totals = weekly.get("totals") or {}

    # One CGM pull for the whole window — avoids N queries per meal/stress/chart
    low, high = _tir_bounds(db)
    start_dt = datetime.strptime(period_start, "%Y-%m-%d").replace(tzinfo=timezone.utc) - timedelta(
        hours=1
    )
    end_dt = datetime.strptime(period_end, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(
        days=1, hours=4
    )
    cgm_cache = _readings_between(
        db,
        device_ids,
        int(start_dt.timestamp() * 1000),
        int(end_dt.timestamp() * 1000),
    )

    meal_glucose = _meal_glucose_digest(
        db, device_ids, period_start, period_end, cgm_cache=cgm_cache, tir_bounds=(low, high)
    )
    bolus_timing = _bolus_timing_digest(db, device_ids, meal_glucose["meals"])
    meal_examples = _enrich_meal_charts_cached(
        meal_glucose["examples"], cgm_cache, tir_bounds=(low, high)
    )
    bolus_timing["examples"] = _enrich_meal_charts_cached(
        bolus_timing.get("examples") or [],
        cgm_cache,
        tir_bounds=(low, high),
        meals_lookup=meal_glucose["meals"],
    )
    stress_glucose = _stress_glucose_digest(
        db,
        device_ids,
        daily_days,
        period_start,
        period_end,
        cgm_cache=cgm_cache,
        tir_bounds=(low, high),
    )
    coverage = _coverage_gaps(daily_days)
    lifestyle = _lifestyle_digest(daily_days, weekly)
    linked_patterns = _build_linked_patterns(
        meal_glucose["summary"],
        bolus_timing,
        stress_glucose,
        coverage,
        lifestyle,
        daily_days,
    )
    day_charts = _day_overview_charts(daily_days)
    big_picture = _glucose_big_picture(daily_days)
    period_stats = {
        "dayCount": len(daily_days),
        "periodStart": period_start,
        "periodEnd": period_end,
        "avgTimeInRangePct": totals.get("avgTimeInRangePct"),
        "mealCount": totals.get("mealCount") or 0,
        "hypoEventCount": len(weekly.get("hypoEvents") or []),
        "stressHighCount": totals.get("stressHighCount") or totals.get("stressHigh") or 0,
        "totalSteps": totals.get("totalSteps"),
        "workoutCount": totals.get("workoutCount") or 0,
        "caffeineDrinkCount": totals.get("caffeineDrinkCount") or 0,
        "sportMatchCount": totals.get("sportMatchCount") or 0,
        "careVisitCount": totals.get("careVisitCount") or 0,
        "dayCheckInCount": totals.get("dayCheckInCount") or 0,
        **big_picture,
    }

    return {
        "periodStats": period_stats,
        "mealGlucose": meal_glucose["summary"],
        "mealExamples": meal_examples,
        "bolusTiming": bolus_timing,
        "stressGlucose": stress_glucose,
        "coverageGaps": coverage,
        "lifestyle": lifestyle,
        "linkedPatterns": linked_patterns,
        "dayCharts": day_charts,
        "weeklyInsights": (weekly.get("insights") or [])[:12],
        "plotTwists": (weekly.get("plotTwists") or [])[:8],
        "sportMatches": (weekly.get("sportMatches") or [])[:10],
        "careVisits": (weekly.get("careVisits") or [])[:8],
        "workouts": (weekly.get("workouts") or [])[:10],
        "dayCheckIns": (weekly.get("dayCheckIns") or [])[:10],
        "caffeineLogs": (weekly.get("caffeineLogs") or [])[:12],
        "hypoEvents": (weekly.get("hypoEvents") or [])[:12],
        "stressLogs": (weekly.get("stressLogs") or [])[:12],
        # Keep daysSlim tiny for Gemini — last 5 days, no reading arrays
        "daysSlim": [compact_report(d) for d in daily_days[-5:]],
    }


def _downsample_series(points: list[dict[str, Any]], max_points: int = 36) -> list[dict[str, Any]]:
    if len(points) <= max_points:
        return points
    step = max(1, len(points) // max_points)
    sampled = points[::step]
    if sampled[-1] is not points[-1]:
        sampled.append(points[-1])
    return sampled[: max_points + 1]


def _slice_cgm(
    cgm: list[dict[str, Any]], start_ms: int, end_ms: int
) -> list[dict[str, Any]]:
    return [p for p in cgm if start_ms <= p["timestamp"] <= end_ms]


def _story_from_points(
    points: list[dict[str, Any]],
    *,
    eaten_at_ms: int,
    low: float,
    high: float,
    window_hours: float = 3.0,
) -> dict[str, Any]:
    end_ms = eaten_at_ms + int(window_hours * 3600 * 1000)
    window = _slice_cgm(points, eaten_at_ms - 10 * 60 * 1000, end_ms)
    in_window = [p for p in window if p["timestamp"] >= eaten_at_ms]
    if not in_window:
        return {"ready": False, "reason": "waiting_for_glucose"}
    baseline = min(window, key=lambda p: abs(p["timestamp"] - eaten_at_ms)) if window else in_window[0]
    peak = max(in_window, key=lambda p: p["mgDl"])
    time_to_peak_min = max(0, round((peak["timestamp"] - eaten_at_ms) / 60000))
    delta = round((peak["mgDl"] - baseline["mgDl"]) * 10) / 10
    return_to_range_min: int | None = None
    for p in in_window:
        if p["timestamp"] < peak["timestamp"]:
            continue
        if low <= p["mgDl"] <= high:
            return_to_range_min = max(0, round((p["timestamp"] - eaten_at_ms) / 60000))
            break
    still_high = peak["mgDl"] > high and return_to_range_min is None
    return {
        "ready": True,
        "deltaMgDl": delta,
        "timeToPeakMin": time_to_peak_min,
        "returnToRangeMin": return_to_range_min,
        "stillAboveRange": still_high,
        "peakMgDl": peak["mgDl"],
        "baselineMgDl": baseline["mgDl"],
        "blurb": _story_blurb(delta, time_to_peak_min, return_to_range_min, still_high),
    }


def _chart_from_cache(
    cgm: list[dict[str, Any]], eaten_at_ms: int, *, hours: float = 3.0
) -> list[dict[str, Any]]:
    start = eaten_at_ms - 15 * 60 * 1000
    end = eaten_at_ms + int(hours * 3600 * 1000)
    raw = _slice_cgm(cgm, start, end)
    series = [{"tMin": round((p["timestamp"] - eaten_at_ms) / 60000), "mgDl": p["mgDl"]} for p in raw]
    return _downsample_series(series)


def _enrich_meal_charts_cached(
    examples: list[dict[str, Any]],
    cgm: list[dict[str, Any]],
    *,
    tir_bounds: tuple[float, float],
    meals_lookup: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    _ = tir_bounds
    by_id = {m["id"]: m for m in (meals_lookup or [])}
    out: list[dict[str, Any]] = []
    for ex in examples[:6]:
        row = dict(ex)
        eaten = row.get("eatenAt") or (by_id.get(row.get("id") or "") or {}).get("eatenAt")
        if eaten:
            row["eatenAt"] = eaten
            row["chartSeries"] = _chart_from_cache(cgm, int(eaten))
            if row.get("lagMin") is not None:
                row["bolusMarkerMin"] = int(row["lagMin"])
        else:
            row["chartSeries"] = []
        out.append(row)
    return out


def _day_overview_charts(daily_days: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-day TIR / meal count / hypo count for overview charts."""
    out: list[dict[str, Any]] = []
    for d in daily_days:
        g = d.get("glucose") or {}
        nut = d.get("nutrition") or {}
        out.append(
            {
                "date": d.get("date"),
                "tirPct": g.get("timeInRangePct"),
                "avgMgDl": g.get("avgMgDl"),
                "mealCount": nut.get("mealCount") or 0,
                "hypoCount": len(g.get("hypoEvents") or []),
                "highCount": g.get("highCount") or 0,
            }
        )
    return out


def _glucose_big_picture(daily_days: list[dict[str, Any]]) -> dict[str, Any]:
    """Window mean glucose + GMI (estimated A1c from CGM mean).

    GMI (%) = 3.31 + 0.02392 × mean glucose (mg/dL) — Bergenstal et al. / ADA.
    Weighted by per-day reading counts when available.
    """
    weighted_sum = 0.0
    weight = 0
    day_avgs: list[float] = []
    for d in daily_days:
        g = d.get("glucose") or {}
        avg = g.get("avgMgDl")
        if avg is None:
            continue
        avg_f = float(avg)
        day_avgs.append(avg_f)
        n = int(g.get("readingCount") or 0)
        w = max(n, 1)
        weighted_sum += avg_f * w
        weight += w

    if weight <= 0:
        return {
            "meanGlucoseMgDl": None,
            "meanGlucoseMmol": None,
            "estimatedA1cPct": None,
            "estimatedA1cMethod": "GMI",
            "glucoseReadingWeight": 0,
        }

    mean_mg = round(weighted_sum / weight, 1)
    mean_mmol = round(mean_mg / 18.0, 2)
    # Glucose Management Indicator ≈ estimated A1c from CGM mean
    gmi = round(3.31 + 0.02392 * mean_mg, 2)
    return {
        "meanGlucoseMgDl": mean_mg,
        "meanGlucoseMmol": mean_mmol,
        "estimatedA1cPct": gmi,
        "estimatedA1cMethod": "GMI",
        "glucoseReadingWeight": weight,
        "daysWithGlucose": len(day_avgs),
    }


def _lifestyle_digest(
    daily_days: list[dict[str, Any]], weekly: dict[str, Any]
) -> dict[str, Any]:
    """Aggregate every non-glucose domain the app tracks."""
    totals = weekly.get("totals") or {}
    injuries: list[dict[str, Any]] = []
    pain_scores: list[float] = []
    weight_rows: list[dict[str, Any]] = []
    low_step_volatile = 0
    sport_days_with_hypo = 0
    caffeine_high_days = 0
    mood_low_low_tir = 0

    for d in daily_days:
        g = d.get("glucose") or {}
        tir = g.get("timeInRangePct")
        hypos = len(g.get("hypoEvents") or [])
        steps = int((d.get("activity") or {}).get("steps") or 0)
        volatile = (tir is not None and tir < 55) or hypos >= 1
        if volatile and steps < 3000 and (g.get("readingCount") or 0) >= 20:
            low_step_volatile += 1
        if (d.get("sportMatches") or []) and hypos:
            sport_days_with_hypo += 1
        caf = d.get("caffeineLogs") or []
        caf_mg = sum(int(c.get("caffeineMg") or 0) for c in caf)
        if caf_mg >= 200 and tir is not None and tir < 60:
            caffeine_high_days += 1
        check = d.get("dayCheckIn")
        if check and check.get("mood") in ("terrible", "low") and tir is not None and tir < 55:
            mood_low_low_tir += 1
        for inj in d.get("injuries") or []:
            if not isinstance(inj, dict):
                continue
            injuries.append(
                {
                    "date": d.get("date"),
                    "title": inj.get("title") or inj.get("area"),
                    "area": inj.get("area"),
                    "status": inj.get("status"),
                    "todayPain": (inj.get("todayPain") or {}).get("painScore")
                    if isinstance(inj.get("todayPain"), dict)
                    else inj.get("painScore"),
                }
            )
            tp = inj.get("todayPain") if isinstance(inj.get("todayPain"), dict) else None
            score = (tp or {}).get("painScore") if tp else inj.get("painScore")
            if score is not None:
                try:
                    pain_scores.append(float(score))
                except (TypeError, ValueError):
                    pass
        w = d.get("weight")
        if isinstance(w, dict) and w.get("weightKg") is not None:
            weight_rows.append({"date": d.get("date"), "weightKg": w.get("weightKg")})

    # Dedupe injuries by title+area keeping latest
    seen_inj: dict[str, dict[str, Any]] = {}
    for inj in injuries:
        key = f"{inj.get('title')}|{inj.get('area')}"
        seen_inj[key] = inj

    return {
        "activity": {
            "totalSteps": totals.get("totalSteps") or 0,
            "workoutCount": totals.get("workoutCount") or 0,
            "workoutMinutes": totals.get("workoutMinutes") or 0,
            "activeCalories": totals.get("activeCalories"),
            "lowStepVolatileDays": low_step_volatile,
            "recentWorkouts": (weekly.get("workouts") or [])[:8],
        },
        "sports": {
            "matchCount": totals.get("sportMatchCount") or 0,
            "padelWins": totals.get("padelWins") or 0,
            "padelLosses": totals.get("padelLosses") or 0,
            "gymSessionCount": totals.get("gymSessionCount") or 0,
            "gymMinutes": totals.get("gymMinutes") or 0,
            "sportDaysWithHypo": sport_days_with_hypo,
            "recent": (weekly.get("sportMatches") or [])[:8],
        },
        "care": {
            "visitCount": totals.get("careVisitCount") or 0,
            "recent": (weekly.get("careVisits") or [])[:8],
        },
        "caffeine": {
            "drinkCount": totals.get("caffeineDrinkCount") or 0,
            "mgTotal": totals.get("caffeineMgTotal") or totals.get("caffeineMg") or 0,
            "highCaffeineLowTirDays": caffeine_high_days,
            "recent": (weekly.get("caffeineLogs") or [])[:10],
        },
        "checkIns": {
            "count": totals.get("dayCheckInCount") or 0,
            "moodLowCount": totals.get("moodLowCount") or 0,
            "wakeRoughCount": totals.get("wakeRoughCount") or 0,
            "focusLowCount": totals.get("focusLowCount") or 0,
            "overwhelmHighCount": totals.get("overwhelmHighCount") or 0,
            "moodLowLowTirDays": mood_low_low_tir,
            "recent": (weekly.get("dayCheckIns") or [])[:8],
        },
        "injuries": {
            "uniqueCount": len(seen_inj),
            "painLogCount": len(pain_scores),
            "avgPainScore": round(sum(pain_scores) / len(pain_scores), 1) if pain_scores else None,
            "recent": list(seen_inj.values())[:8],
        },
        "weight": {
            "entries": len(weight_rows),
            "latest": weight_rows[-1] if weight_rows else None,
            "first": weight_rows[0] if weight_rows else None,
        },
    }


def _build_linked_patterns(
    meal_summary: dict[str, Any],
    bolus: dict[str, Any],
    stress: dict[str, Any],
    coverage: dict[str, Any],
    lifestyle: dict[str, Any],
    daily_days: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Candidate associations for Gemini medical verification."""
    links: list[dict[str, Any]] = []

    if meal_summary.get("highPeakPerCarbCount"):
        links.append(
            {
                "id": "est-peak-per-carb",
                "category": "estimation",
                "claim": (
                    "Meals with high postprandial rise relative to logged carbs may reflect "
                    "underestimated carbohydrates or delayed insulin action."
                ),
                "observed": {
                    "highPeakPerCarbCount": meal_summary.get("highPeakPerCarbCount"),
                    "flaggedMeals": meal_summary.get("flaggedMeals"),
                    "avgDeltaMgDl": meal_summary.get("avgDeltaMgDl"),
                },
            }
        )

    if (
        bolus.get("lateCount")
        and bolus.get("lateAvgDeltaMgDl") is not None
        and bolus.get("onTimeAvgDeltaMgDl") is not None
        and float(bolus["lateAvgDeltaMgDl"]) > float(bolus["onTimeAvgDeltaMgDl"]) + 10
    ):
        links.append(
            {
                "id": "timing-late-bolus-higher-peak",
                "category": "timing",
                "claim": (
                    "Bolusing more than ~15 minutes after starting a meal is associated with "
                    "higher post-meal glucose peaks than bolusing nearer mealtime."
                ),
                "observed": {
                    "lateCount": bolus.get("lateCount"),
                    "latePct": bolus.get("latePct"),
                    "lateAvgDeltaMgDl": bolus.get("lateAvgDeltaMgDl"),
                    "onTimeAvgDeltaMgDl": bolus.get("onTimeAvgDeltaMgDl"),
                },
            }
        )
    elif bolus.get("lateCount"):
        links.append(
            {
                "id": "timing-late-bolus-frequency",
                "category": "timing",
                "claim": (
                    "Delayed meal boluses are common in this window; late insulin relative to "
                    "carbohydrate absorption can worsen postprandial hyperglycemia."
                ),
                "observed": {
                    "lateCount": bolus.get("lateCount"),
                    "latePct": bolus.get("latePct"),
                    "avgLagMin": bolus.get("avgLagMin"),
                },
            }
        )

    if stress.get("elevatedStressLogs") and (stress.get("followUpHighCount") or 0) >= 1:
        links.append(
            {
                "id": "stress-follow-hyperglycemia",
                "category": "stress",
                "claim": (
                    "Elevated psychological stress is followed by higher glucose / reduced TIR "
                    "in the subsequent hours (stress hyperglycemia / counter-regulatory hormones)."
                ),
                "observed": {
                    "elevatedStressLogs": stress.get("elevatedStressLogs"),
                    "followUpHighCount": stress.get("followUpHighCount"),
                    "avgFollowUpTirPct": stress.get("avgFollowUpTirPct"),
                    "stressLinkedHypoEpisodes": stress.get("stressLinkedHypoEpisodes"),
                },
            }
        )

    if stress.get("stressLinkedHypoEpisodes"):
        links.append(
            {
                "id": "stress-near-hypo",
                "category": "stress",
                "claim": (
                    "Stress logs appear near hypoglycemic episodes; acute stress can coexist with "
                    "or follow hypoglycemia and recovery behaviors."
                ),
                "observed": {
                    "stressLinkedHypoEpisodes": stress.get("stressLinkedHypoEpisodes"),
                },
            }
        )

    sports = lifestyle.get("sports") or {}
    if sports.get("sportDaysWithHypo"):
        links.append(
            {
                "id": "sport-hypo",
                "category": "lifestyle",
                "claim": (
                    "Sport / intense activity days coincide with hypoglycemia — exercise increases "
                    "insulin sensitivity and glucose uptake."
                ),
                "observed": {
                    "sportDaysWithHypo": sports.get("sportDaysWithHypo"),
                    "matchCount": sports.get("matchCount"),
                    "gymSessionCount": sports.get("gymSessionCount"),
                },
            }
        )

    activity = lifestyle.get("activity") or {}
    if activity.get("lowStepVolatileDays"):
        links.append(
            {
                "id": "sedentary-volatile",
                "category": "lifestyle",
                "claim": (
                    "Low-step days with volatile / low TIR may reflect reduced activity-related "
                    "glucose disposal (sedentary hyperglycemia risk)."
                ),
                "observed": {
                    "lowStepVolatileDays": activity.get("lowStepVolatileDays"),
                    "totalSteps": activity.get("totalSteps"),
                },
            }
        )

    caffeine = lifestyle.get("caffeine") or {}
    if caffeine.get("highCaffeineLowTirDays"):
        links.append(
            {
                "id": "caffeine-tir",
                "category": "lifestyle",
                "claim": (
                    "Higher caffeine intake days show lower TIR; caffeine can raise catecholamines "
                    "and blunt insulin sensitivity in some people with T1D."
                ),
                "observed": {
                    "highCaffeineLowTirDays": caffeine.get("highCaffeineLowTirDays"),
                    "mgTotal": caffeine.get("mgTotal"),
                    "drinkCount": caffeine.get("drinkCount"),
                },
            }
        )

    check_ins = lifestyle.get("checkIns") or {}
    if check_ins.get("moodLowLowTirDays"):
        links.append(
            {
                "id": "mood-tir",
                "category": "lifestyle",
                "claim": (
                    "Low-mood check-ins coincide with lower TIR — mood, sleep, and self-care "
                    "often travel with glucose outcomes (bidirectional)."
                ),
                "observed": {
                    "moodLowLowTirDays": check_ins.get("moodLowLowTirDays"),
                    "moodLowCount": check_ins.get("moodLowCount"),
                    "overwhelmHighCount": check_ins.get("overwhelmHighCount"),
                },
            }
        )

    injuries = lifestyle.get("injuries") or {}
    if injuries.get("avgPainScore") is not None and float(injuries["avgPainScore"]) >= 5:
        links.append(
            {
                "id": "pain-stress-glucose",
                "category": "lifestyle",
                "claim": (
                    "Elevated injury pain can raise stress hormones and disrupt activity/sleep, "
                    "indirectly affecting glucose variability."
                ),
                "observed": {
                    "avgPainScore": injuries.get("avgPainScore"),
                    "painLogCount": injuries.get("painLogCount"),
                    "uniqueCount": injuries.get("uniqueCount"),
                },
            }
        )

    if coverage.get("volatileNoMealsDays"):
        links.append(
            {
                "id": "logging-gap-volatile",
                "category": "logging",
                "claim": (
                    "Days with volatile CGM but no meal logs make food-related causes hard to "
                    "separate from stress, activity, or insulin timing."
                ),
                "observed": {
                    "volatileNoMealsDays": coverage.get("volatileNoMealsDays"),
                    "gapDays": coverage.get("gapDays"),
                },
            }
        )

    # Keep day count in observed for context (unused but available)
    _ = len(daily_days)
    return links[:12]


def _meal_glucose_digest(
    db: Session,
    device_ids: list[str],
    period_start: str,
    period_end: str,
    *,
    cgm_cache: list[dict[str, Any]],
    tir_bounds: tuple[float, float],
) -> dict[str, Any]:
    low, high = tir_bounds
    start_dt = datetime.strptime(period_start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    end_dt = datetime.strptime(period_end, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)
    q = db.query(Meal).filter(Meal.eaten_at >= start_dt, Meal.eaten_at < end_dt)
    if device_ids:
        q = q.filter(Meal.device_id.in_(device_ids))
    meals = q.order_by(Meal.eaten_at.desc()).limit(48).all()
    meals = list(reversed(meals))

    rows: list[dict[str, Any]] = []
    for m in meals:
        eaten_ms = int(m.eaten_at.timestamp() * 1000)
        carbs = _carbs(m)
        story = _story_from_points(cgm_cache, eaten_at_ms=eaten_ms, low=low, high=high)
        if not story.get("ready"):
            continue
        delta = float(story.get("deltaMgDl") or 0)
        peak_per_carb = round(delta / carbs, 2) if carbs >= 8 else None
        flags: list[str] = []
        if peak_per_carb is not None and peak_per_carb >= HIGH_PEAK_PER_CARB and delta >= 50:
            flags.append("high_peak_per_carb")
        if delta >= HIGH_DELTA_MG:
            flags.append("steep_rise")
        rtr = story.get("returnToRangeMin")
        if story.get("stillAboveRange") or (isinstance(rtr, int) and rtr >= SLOW_RETURN_MIN):
            flags.append("slow_return")
        rows.append(
            {
                "id": m.id,
                "date": to_date_key(m.eaten_at),
                "mealType": m.meal_type,
                "carbsG": round(carbs, 1),
                "deltaMgDl": delta,
                "timeToPeakMin": story.get("timeToPeakMin"),
                "returnToRangeMin": rtr,
                "stillAboveRange": bool(story.get("stillAboveRange")),
                "peakPerCarb": peak_per_carb,
                "flags": flags,
                "summary": (m.ai_summary or "")[:120],
                "eatenAt": eaten_ms,
            }
        )

    deltas = [r["deltaMgDl"] for r in rows]
    flagged = [r for r in rows if r["flags"]]
    examples = sorted(
        flagged or rows,
        key=lambda r: (len(r["flags"]), r["deltaMgDl"]),
        reverse=True,
    )[:8]

    return {
        "meals": rows,
        "examples": examples,
        "summary": {
            "analyzedMeals": len(rows),
            "flaggedMeals": len(flagged),
            "avgDeltaMgDl": round(sum(deltas) / len(deltas), 1) if deltas else None,
            "medianDeltaMgDl": round(median(deltas), 1) if deltas else None,
            "highPeakPerCarbCount": sum(1 for r in rows if "high_peak_per_carb" in r["flags"]),
            "steepRiseCount": sum(1 for r in rows if "steep_rise" in r["flags"]),
            "slowReturnCount": sum(1 for r in rows if "slow_return" in r["flags"]),
        },
    }


def _bolus_timing_digest(
    db: Session,
    device_ids: list[str],
    meal_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    if not meal_rows:
        return {
            "pairedMeals": 0,
            "lateCount": 0,
            "earlyCount": 0,
            "missingCount": 0,
            "latePct": None,
            "avgLagMin": None,
            "lateAvgDeltaMgDl": None,
            "onTimeAvgDeltaMgDl": None,
            "examples": [],
            "note": "No analyzed meals in window",
        }

    start_ms = min(m["eatenAt"] for m in meal_rows) - BOLUS_PAD_MIN * 60 * 1000
    end_ms = max(m["eatenAt"] for m in meal_rows) + BOLUS_PAD_MIN * 60 * 1000
    start_dt = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc)
    end_dt = datetime.fromtimestamp(end_ms / 1000, tz=timezone.utc)

    q = db.query(PumpLogEvent).filter(
        PumpLogEvent.kind == BOLUS_KIND,
        PumpLogEvent.timestamp >= start_dt,
        PumpLogEvent.timestamp <= end_dt,
    )
    if device_ids:
        q = q.filter(PumpLogEvent.device_id.in_(device_ids))
    boluses = [
        {
            "at": int(p.timestamp.timestamp() * 1000),
            "units": p.units,
            "message": (p.message or "")[:80],
        }
        for p in q.order_by(PumpLogEvent.timestamp.asc()).all()
    ]

    paired: list[dict[str, Any]] = []
    late_deltas: list[float] = []
    ontime_deltas: list[float] = []
    late = early = missing = 0

    for meal in meal_rows:
        eaten = meal["eatenAt"]
        window = [
            b
            for b in boluses
            if abs(b["at"] - eaten) <= BOLUS_PAD_MIN * 60 * 1000
        ]
        if not window:
            missing += 1
            paired.append(
                {
                    **{
                        k: meal[k]
                        for k in ("id", "date", "mealType", "carbsG", "deltaMgDl", "eatenAt")
                    },
                    "lagMin": None,
                    "timing": "missing",
                    "bolusUnits": None,
                }
            )
            continue
        # Prefer bolus closest to meal start
        best = min(window, key=lambda b: abs(b["at"] - eaten))
        lag_min = round((best["at"] - eaten) / 60000)
        if lag_min > LATE_BOLUS_MIN:
            timing = "late"
            late += 1
            late_deltas.append(float(meal["deltaMgDl"]))
        elif lag_min < EARLY_BOLUS_MIN:
            timing = "early"
            early += 1
            ontime_deltas.append(float(meal["deltaMgDl"]))
        else:
            timing = "on_time"
            ontime_deltas.append(float(meal["deltaMgDl"]))
        paired.append(
            {
                **{
                    k: meal[k]
                    for k in ("id", "date", "mealType", "carbsG", "deltaMgDl", "eatenAt")
                },
                "lagMin": lag_min,
                "timing": timing,
                "bolusUnits": best.get("units"),
            }
        )

    lags = [p["lagMin"] for p in paired if p["lagMin"] is not None]
    with_bolus = late + early + sum(1 for p in paired if p["timing"] == "on_time")
    late_examples = sorted(
        [p for p in paired if p["timing"] == "late"],
        key=lambda p: p.get("deltaMgDl") or 0,
        reverse=True,
    )[:5]

    return {
        "pairedMeals": len(paired),
        "withBolus": with_bolus,
        "lateCount": late,
        "earlyCount": early,
        "missingCount": missing,
        "latePct": round(100 * late / with_bolus, 1) if with_bolus else None,
        "avgLagMin": round(sum(lags) / len(lags), 1) if lags else None,
        "lateAvgDeltaMgDl": round(sum(late_deltas) / len(late_deltas), 1) if late_deltas else None,
        "onTimeAvgDeltaMgDl": (
            round(sum(ontime_deltas) / len(ontime_deltas), 1) if ontime_deltas else None
        ),
        "bolusEventCount": len(boluses),
        "examples": late_examples
        or sorted(paired, key=lambda p: abs(p.get("lagMin") or 999))[:5],
    }


def _stress_glucose_digest(
    db: Session,
    device_ids: list[str],
    daily_days: list[dict[str, Any]],
    period_start: str,
    period_end: str,
    *,
    cgm_cache: list[dict[str, Any]],
    tir_bounds: tuple[float, float],
) -> dict[str, Any]:
    low, high = tir_bounds
    day_keys = [d["date"] for d in daily_days]
    _ = (period_start, period_end, device_ids)

    q = db.query(StressLog).filter(StressLog.date.in_(day_keys))
    if device_ids and hasattr(StressLog, "device_id"):
        q = q.filter(StressLog.device_id.in_(device_ids))
    stress_rows = q.all()

    elevated: list[dict[str, Any]] = []
    for s in stress_rows:
        score = float(s.score) if s.score is not None else None
        level = (s.level or "").lower()
        is_high = level == "high" or (score is not None and score >= STRESS_HIGH_SCORE)
        if not is_high:
            continue
        ts = _combine_dt(s.date, s.time)
        if ts is None:
            continue
        end_ms = ts + int(STRESS_FOLLOW_HOURS * 3600 * 1000)
        points = _slice_cgm(cgm_cache, ts, end_ms)
        if not points:
            elevated.append(
                {
                    "date": s.date,
                    "time": s.time,
                    "level": s.level,
                    "score": score,
                    "followUpTirPct": None,
                    "followUpHigh": False,
                    "followUpLow": False,
                    "note": "no_cgm",
                    "chartSeries": [],
                }
            )
            continue
        mg = [p["mgDl"] for p in points]
        in_range = sum(1 for v in mg if low <= v <= high)
        tir = round(100 * in_range / len(mg), 1)
        series = _downsample_series(
            [{"tMin": round((p["timestamp"] - ts) / 60000), "mgDl": p["mgDl"]} for p in points]
        )
        elevated.append(
            {
                "date": s.date,
                "time": s.time,
                "level": s.level,
                "score": score,
                "followUpTirPct": tir,
                "followUpHigh": any(v > high for v in mg),
                "followUpLow": any(v < low for v in mg),
                "readingCount": len(mg),
                "chartSeries": series,
                "at": ts,
            }
        )

    # Fast proxy: same-day stress + hypo (no per-episode DB fan-out)
    stress_linked_episodes = 0
    episode_examples: list[dict[str, Any]] = []
    stress_by_day: dict[str, list[dict[str, Any]]] = {}
    for s in stress_rows:
        stress_by_day.setdefault(s.date, []).append(
            {"level": s.level, "score": s.score, "time": s.time}
        )
    for day in daily_days:
        day_stress = stress_by_day.get(day["date"] or "", [])
        if not day_stress:
            continue
        for h in (day.get("glucose") or {}).get("hypoEvents") or []:
            stress_linked_episodes += 1
            if len(episode_examples) < 5:
                episode_examples.append(
                    {
                        "kind": "hypo",
                        "date": day["date"],
                        "startedAt": h.get("startedAt"),
                        "durationMin": h.get("durationMin"),
                        "stressNearby": day_stress[:3],
                    }
                )

    follow_tirs = [e["followUpTirPct"] for e in elevated if e.get("followUpTirPct") is not None]
    return {
        "elevatedStressLogs": len(elevated),
        "followUpHighCount": sum(1 for e in elevated if e.get("followUpHigh")),
        "followUpLowCount": sum(1 for e in elevated if e.get("followUpLow")),
        "avgFollowUpTirPct": round(sum(follow_tirs) / len(follow_tirs), 1) if follow_tirs else None,
        "stressLinkedHypoEpisodes": stress_linked_episodes,
        "examples": elevated[:6],
        "episodeExamples": episode_examples,
        "periodStart": period_start,
        "periodEnd": period_end,
    }


def _coverage_gaps(daily_days: list[dict[str, Any]]) -> dict[str, Any]:
    gaps: list[dict[str, Any]] = []
    volatile_no_meals = 0
    no_stress_volatile = 0
    for d in daily_days:
        g = d.get("glucose") or {}
        nut = d.get("nutrition") or {}
        meals = int(nut.get("mealCount") or 0)
        tir = g.get("timeInRangePct")
        hypos = len(g.get("hypoEvents") or [])
        readings = int(g.get("readingCount") or 0)
        stress_logs = d.get("stressLogs") or []
        volatile = readings >= 20 and (
            (tir is not None and tir < 55) or hypos >= 1 or (g.get("highCount") or 0) >= 8
        )
        reasons: list[str] = []
        if volatile and meals == 0:
            volatile_no_meals += 1
            reasons.append("volatile_glucose_no_meals")
        if volatile and not stress_logs:
            no_stress_volatile += 1
            reasons.append("volatile_no_stress_log")
        if reasons:
            gaps.append({"date": d["date"], "tirPct": tir, "mealCount": meals, "reasons": reasons})

    return {
        "gapDays": len(gaps),
        "volatileNoMealsDays": volatile_no_meals,
        "volatileNoStressDays": no_stress_volatile,
        "examples": gaps[:8],
    }
